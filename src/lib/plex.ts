// Plex client — PIN sign-in (plex.tv/link), server discovery, library browse,
// and stream-URL building. The plex.tv + PMS APIs don't send CORS headers, so
// on native we use CapacitorHttp; web falls back to fetch (will CORS-fail — the
// installed Android app is the supported path, same as the Xtream client).

const PLEX_TOKEN_KEY = 'snow-plex-token-v1';
const PLEX_CLIENT_ID_KEY = 'snow-plex-client-id-v1';
const PLEX_SERVER_KEY = 'snow-plex-server-v1';

export const PLEX_PRODUCT = 'Snow Media Center';
export const PLEX_VERSION = '1.0';
export const PLEX_DEVICE = 'Android TV';

/** Stable per-install client identifier (required by every Plex call). */
export function getPlexClientId(): string {
  try {
    let id = localStorage.getItem(PLEX_CLIENT_ID_KEY);
    if (!id) {
      const rnd = (globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2)));
      id = `smc-${rnd}`;
      localStorage.setItem(PLEX_CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return 'smc-plex-fallback';
  }
}

const plexHeaders = (token?: string): Record<string, string> => {
  const h: Record<string, string> = {
    'X-Plex-Product': PLEX_PRODUCT,
    'X-Plex-Version': PLEX_VERSION,
    'X-Plex-Client-Identifier': getPlexClientId(),
    'X-Plex-Device': PLEX_DEVICE,
    'X-Plex-Device-Name': PLEX_PRODUCT,
    'X-Plex-Platform': 'Android',
    'Accept': 'application/json',
  };
  if (token) h['X-Plex-Token'] = token;
  return h;
};

async function plexReq<T>(method: 'GET' | 'POST', url: string, token?: string, timeoutMs = 20000): Promise<T> {
  const headers = plexHeaders(token);
  let native = false;
  let CapacitorHttpRef: typeof import('@capacitor/core').CapacitorHttp | null = null;
  try {
    const mod = await import('@capacitor/core');
    native = !!mod.Capacitor.isNativePlatform?.();
    CapacitorHttpRef = mod.CapacitorHttp;
  } catch { /* no @capacitor/core on web */ }
  if (native && CapacitorHttpRef) {
    // Native path: any error propagates — do NOT fall through to WebView fetch.
    const res = await CapacitorHttpRef.request({
      method, url, headers,
      connectTimeout: Math.min(timeoutMs, 15000),
      readTimeout: timeoutMs,
    });
    if (res.status >= 200 && res.status < 300) {
      return (typeof res.data === 'string' ? JSON.parse(res.data || '{}') : res.data) as T;
    }
    throw new Error(`Plex HTTP ${res.status}`);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method, headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Plex HTTP ${r.status}`);
    const txt = await r.text();
    return (txt ? JSON.parse(txt) : {}) as T;
  } finally {
    clearTimeout(t);
  }
}

// ── PIN sign-in ────────────────────────────────────────────────────────────

export interface PlexPin { id: number; code: string; }

export async function requestPlexPin(): Promise<PlexPin> {
  const data = await plexReq<{ id: number; code: string }>('POST', 'https://plex.tv/api/v2/pins');
  return { id: data.id, code: data.code };
}

/** Poll a PIN; returns the account authToken once the user has linked, else null. */
export async function checkPlexPin(id: number): Promise<string | null> {
  const data = await plexReq<{ authToken?: string | null }>('GET', `https://plex.tv/api/v2/pins/${id}`);
  return data?.authToken || null;
}

// ── token persistence ──────────────────────────────────────────────────────

export async function loadPlexToken(): Promise<string | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PLEX_TOKEN_KEY });
    if (value) return value;
  } catch { /* not native */ }
  try { return localStorage.getItem(PLEX_TOKEN_KEY); } catch { return null; }
}
export async function savePlexToken(token: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PLEX_TOKEN_KEY, value: token });
  } catch { /* not native */ }
  try { localStorage.setItem(PLEX_TOKEN_KEY, token); } catch { /* ignore */ }
}
export async function clearPlexToken(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: PLEX_TOKEN_KEY });
    await Preferences.remove({ key: PLEX_SERVER_KEY });
  } catch { /* not native */ }
  try { localStorage.removeItem(PLEX_TOKEN_KEY); localStorage.removeItem(PLEX_SERVER_KEY); } catch { /* ignore */ }
}

// ── server discovery ───────────────────────────────────────────────────────

export interface PlexConnection {
  uri: string; local: boolean; relay: boolean; protocol: string; address: string; port: number;
}
export interface PlexServer {
  name: string; clientIdentifier: string; accessToken?: string; owned: boolean; connections: PlexConnection[];
}

/** All Plex Media Servers the account can reach. Each carries its OWN accessToken. */
export async function getPlexServers(token: string): Promise<PlexServer[]> {
  const data = await plexReq<Array<Record<string, unknown>>>('GET', 'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', token);
  return (data || [])
    .filter((d) => String(d.provides || '').includes('server'))
    .map((d) => ({
      name: String(d.name || 'Plex Server'),
      clientIdentifier: String(d.clientIdentifier || ''),
      accessToken: (d.accessToken as string) || token,
      owned: !!d.owned,
      connections: (((d.connections as Array<Record<string, unknown>>) || [])).map((c) => ({
        uri: String(c.uri || ''),
        local: !!c.local,
        relay: !!c.relay,
        protocol: String(c.protocol || 'https'),
        address: String(c.address || ''),
        port: Number(c.port || 0),
      })),
    }));
}

/** Reject docker-internal / link-local / CGNAT IPs that a PMS may advertise
 *  but which are unreachable from a Fire TV on a normal LAN. Waiting the full
 *  SocketTimeout on these drowns the https candidate. */
function isDeadIp(addr: string): boolean {
  if (!addr) return false;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(addr)) return true;   // docker-internal
  if (/^169\.254\./.test(addr)) return true;                     // link-local
  if (/^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(addr)) return true; // CGNAT
  return false;
}

/** Probe ALL of a server's connections in parallel (LAN, remote, relay, plus
 *  plain http://ip:port fallbacks) and return the best reachable base URL.
 *  Priority: local non-relay > remote non-relay > relay. Chrome-66-safe
 *  (no Promise.any/allSettled). */
export async function pickPlexConnection(
  server: PlexServer,
  timeoutMs = 3500,
  opts?: { httpsOnly?: boolean },
): Promise<string | null> {
  const httpsOnly = !!opts?.httpsOnly;
  interface Candidate { url: string; priority: number; timeoutMs: number; }
  const seen: Record<string, boolean> = {};
  const candidates: Candidate[] = [];
  const isHttps = (u: string) => u.slice(0, 6).toLowerCase() === 'https:';
  const push = (url: string | undefined, priority: number) => {
    if (!url || seen[url]) return;
    if (httpsOnly && !isHttps(url)) return;
    seen[url] = true;
    // Local candidates get an even shorter probe window — a live LAN PMS
    // answers /identity in <300ms; anything slower is the docker/CGNAT tarpit.
    const t = priority === 1 ? Math.min(2500, timeoutMs) : timeoutMs;
    candidates.push({ url, priority, timeoutMs: t });
  };
  for (const c of server.connections) {
    const prio = c.relay ? 3 : c.local ? 1 : 2;
    // Skip dead IP families both in the plex.direct dashed-IP hostname AND
    // the raw address field.
    const hostMatch = /^https?:\/\/(\d+)-(\d+)-(\d+)-(\d+)\./i.exec(c.uri || '');
    const dashedIp = hostMatch ? `${hostMatch[1]}.${hostMatch[2]}.${hostMatch[3]}.${hostMatch[4]}` : '';
    if (dashedIp && isDeadIp(dashedIp)) { /* skip */ } else { push(c.uri, prio); }
    if (!httpsOnly && !c.relay && c.address && c.port && !isDeadIp(c.address)) {
      push(`http://${c.address}:${c.port}`, prio);
    }
  }
  if (candidates.length === 0) return null;

  return new Promise<string | null>((resolve) => {
    let pending = candidates.length;
    let best: Candidate | null = null;
    let settled = false;
    interface Pend { priority: number; }
    const pendList: Pend[] = candidates.map((c) => ({ priority: c.priority }));
    const cannotBeat = (): boolean => {
      if (!best) return false;
      for (const p of pendList) {
        if (p.priority < best.priority) return false;
        if (p.priority === best.priority && !isHttps(best.url)) return false; // could still upgrade http→https at same tier
      }
      return true;
    };
    const maybeFinish = (force = false) => {
      if (settled) return;
      if (pending === 0 || force) {
        settled = true;
        resolve(best ? best.url : null);
        return;
      }
      if (best && cannotBeat()) {
        settled = true;
        resolve(best.url);
      }
    };
    const maxT = Math.max(...candidates.map((c) => c.timeoutMs));
    const timer = window.setTimeout(() => maybeFinish(true), maxT + 1000);
    candidates.forEach((cand, idx) => {
      plexReq('GET', `${cand.url}/identity`, server.accessToken, cand.timeoutMs)
        .then(() => {
          if (
            !best
            || cand.priority < best.priority
            || (cand.priority === best.priority && !isHttps(best.url) && isHttps(cand.url))
          ) {
            best = cand;
          }
        })
        .catch(() => { /* unreachable candidate */ })
        .then(() => {
          pending -= 1;
          pendList[idx].priority = 999; // mark settled
          if (pending === 0) window.clearTimeout(timer);
          maybeFinish();
        });
    });
  });
}

export async function getPlexIdentity(base: string, token: string): Promise<void> {
  await plexReq('GET', `${base}/identity`, token, 5000);
}

export interface PlexSavedServer { base: string; token: string; name: string; clientIdentifier?: string; }

export async function savePlexServer(s: PlexSavedServer): Promise<void> {
  const json = JSON.stringify(s);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PLEX_SERVER_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(PLEX_SERVER_KEY, json); } catch { /* ignore */ }
}
export async function loadPlexServer(): Promise<PlexSavedServer | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PLEX_SERVER_KEY });
    if (value) return JSON.parse(value) as PlexSavedServer;
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(PLEX_SERVER_KEY);
    if (raw) return JSON.parse(raw) as PlexSavedServer;
  } catch { /* ignore */ }
  return null;
}

// ── libraries + items ──────────────────────────────────────────────────────

export interface PlexLibrary { key: string; title: string; type: string; } // type: 'movie' | 'show'
export async function getPlexLibraries(base: string, token: string): Promise<PlexLibrary[]> {
  const data = await plexReq<{ MediaContainer?: { Directory?: Array<Record<string, unknown>> } }>('GET', `${base}/library/sections`, token);
  const dirs = data?.MediaContainer?.Directory || [];
  return dirs
    .filter((d) => d.type === 'movie' || d.type === 'show')
    .map((d) => ({ key: String(d.key), title: String(d.title || 'Library'), type: String(d.type) }));
}

export interface PlexItem {
  ratingKey: string; title: string; type: string;
  thumb?: string; art?: string; year?: number; summary?: string; duration?: number;
  videoResolution?: string;
}

/** Extract videoResolution from Media[0] if present. */
function mediaRes(m: Record<string, unknown>): string | undefined {
  const media = m.Media as Array<Record<string, unknown>> | undefined;
  const r = media?.[0]?.videoResolution;
  return r ? String(r) : undefined;
}

/** Human label for videoResolution: '4k'→'4K'; '1080'→'1080p'; else uppercase. */
export function resolutionLabel(res?: string): string {
  if (!res) return '';
  const s = String(res).trim().toLowerCase();
  if (!s) return '';
  if (s === '4k') return '4K';
  if (/^\d+$/.test(s)) return `${s}p`;
  return s.toUpperCase();
}

export interface PlexLibraryPage {
  items: PlexItem[];
  totalSize: number;
}

export async function getPlexLibraryItems(
  base: string,
  token: string,
  sectionKey: string,
  start = 0,
  size = 120,
): Promise<PlexLibraryPage> {
  const url = `${base}/library/sections/${sectionKey}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>>; totalSize?: number; size?: number } }>('GET', url, token);
  const container = data?.MediaContainer;
  const items = container?.Metadata || [];
  const totalSize = Number(container?.totalSize ?? container?.size ?? items.length) || items.length;
  return {
    items: items.map((m) => ({
      ratingKey: String(m.ratingKey),
      title: String(m.title || ''),
      type: String(m.type || 'movie'),
      thumb: m.thumb as string | undefined,
      art: m.art as string | undefined,
      year: m.year as number | undefined,
      summary: m.summary as string | undefined,
      duration: m.duration as number | undefined,
      videoResolution: mediaRes(m),
    })),
    totalSize,
  };
}

// ── images + stream URLs ───────────────────────────────────────────────────

export function plexImageUrl(base: string, path: string | undefined, token: string): string | undefined {
  if (!path) return undefined;
  return `${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
}

/** Resolve the direct-play part for a movie (its original file on the server). */
export async function getPlexPart(base: string, token: string, ratingKey: string): Promise<{ partKey?: string; container?: string; audioCodec?: string }> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<{ Media?: Array<{ audioCodec?: string; Part?: Array<{ key?: string; container?: string }> }> }> } }>(
    'GET', `${base}/library/metadata/${ratingKey}`, token,
  );
  const media0 = data?.MediaContainer?.Metadata?.[0]?.Media?.[0];
  const part = media0?.Part?.[0];
  return { partKey: part?.key, container: part?.container, audioCodec: media0?.audioCodec };
}

export function plexDirectUrl(base: string, partKey: string, token: string): string {
  return `${base}${partKey}?X-Plex-Token=${encodeURIComponent(token)}`;
}

/** Codecs the Media3 decoder + Fire TV audio path can direct-play reliably.
 *  Anything else (ac3/eac3/dts/truehd/…) gets silently deselected by ExoPlayer
 *  and the file plays with zero audio — force a Plex server-side transcode. */
const SUPPORTED_DIRECT_AUDIO_CODECS: string[] = ['aac', 'mp3', 'mp2', 'flac', 'opus', 'vorbis', 'pcm'];
export function isDirectAudioCodec(codec: string | undefined | null): boolean {
  if (!codec) return true; // unknown → assume ok, let normal error path handle it
  return SUPPORTED_DIRECT_AUDIO_CODECS.indexOf(String(codec).toLowerCase()) >= 0;
}


/** HLS transcode fallback — offloads decoding to the Plex server (any codec).
 *  Optional `opts` clamp video bitrate/resolution so the user can pick a
 *  lower-bandwidth ladder ("Play at 1080p · 8 Mbps" etc.) without leaving
 *  the app. When omitted, behaves exactly like the pre-opts version. */
export function plexTranscodeUrl(
  base: string,
  ratingKey: string,
  token: string,
  opts?: { maxVideoBitrateKbps?: number; videoResolution?: string },
): string {
  const path = encodeURIComponent(`/library/metadata/${ratingKey}`);
  const cid = encodeURIComponent(getPlexClientId());
  // audioCodec=aac + maxAudioChannels=6 force Plex to re-encode audio to AAC
  // (up to 5.1) instead of direct-streaming the original — needed for Fire TV
  // devices that reject offloaded EAC3/AC3 / trigger DECODER_INIT_FAILED.
  let url = `${base}/video/:/transcode/universal/start.m3u8`
    + `?path=${path}&protocol=hls&fastSeek=1&directPlay=0&directStream=1`
    + `&audioCodec=aac&maxAudioChannels=6`
    + `&mediaIndex=0&partIndex=0&X-Plex-Client-Identifier=${cid}&X-Plex-Token=${encodeURIComponent(token)}`;
  if (opts?.maxVideoBitrateKbps) url += `&maxVideoBitrate=${opts.maxVideoBitrateKbps}`;
  if (opts?.videoResolution) url += `&videoResolution=${encodeURIComponent(opts.videoResolution)}`;
  return url;
}

/** User-selectable quality presets. `original` means direct-play — no transcode. */
export interface PlexQualityPreset {
  key: string;
  label: string;
  maxVideoBitrateKbps?: number;
  videoResolution?: string;
}
export const PLEX_QUALITY_PRESETS: PlexQualityPreset[] = [
  { key: 'original', label: 'Original (direct)' },
  { key: '1080-20', label: '1080p · 20 Mbps', maxVideoBitrateKbps: 20000, videoResolution: '1920x1080' },
  { key: '1080-12', label: '1080p · 12 Mbps', maxVideoBitrateKbps: 12000, videoResolution: '1920x1080' },
  { key: '1080-8',  label: '1080p · 8 Mbps',  maxVideoBitrateKbps: 8000,  videoResolution: '1920x1080' },
  { key: '720-4',   label: '720p · 4 Mbps',   maxVideoBitrateKbps: 4000,  videoResolution: '1280x720' },
  { key: '720-3',   label: '720p · 3 Mbps',   maxVideoBitrateKbps: 3000,  videoResolution: '1280x720' },
  { key: '480-2',   label: '480p · 2 Mbps',   maxVideoBitrateKbps: 2000,  videoResolution: '854x480' },
];

const PLEX_QUALITY_KEY = 'snow-plex-quality-v1';

export async function loadPlexQuality(): Promise<string> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PLEX_QUALITY_KEY });
    if (value) return value;
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(PLEX_QUALITY_KEY);
    if (raw) return raw;
  } catch { /* ignore */ }
  return 'original';
}

export async function savePlexQuality(key: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PLEX_QUALITY_KEY, value: key });
  } catch { /* not native */ }
  try { localStorage.setItem(PLEX_QUALITY_KEY, key); } catch { /* ignore */ }
}


// ── image loading via CapacitorHttp (avoids mixed-content on http PMS) ─────

export function plexPhotoTranscodeUrl(base: string, path: string, token: string, w: number, h: number): string {
  // No upscale — we render posters at a fixed on-screen box; asking Plex to
  // upscale wastes server time and produces bigger payloads that pressure the
  // Fire TV JS heap.
  return `${base}/photo/:/transcode?width=${w}&height=${h}&minSize=1`
    + `&url=${encodeURIComponent(path)}&X-Plex-Token=${encodeURIComponent(token)}`;
}

/** Signed direct image URL (no photo transcode) — used for absolute Plex asset URLs. */
export function plexTokenizedUrl(url: string, token: string): string {
  const sep = url.indexOf('?') >= 0 ? '&' : '?';
  return `${url}${sep}X-Plex-Token=${encodeURIComponent(token)}`;
}

const _imgCache: Map<string, string> = new Map();
// Dedup concurrent identical fetches (warm-up race vs rail mounts).
const _imgPending: Map<string, Promise<string>> = new Map();

// Epoch: bumped when the underlying Plex base URL migrates (http→https).
// Any queued waiter whose epoch is stale releases its slot and throws
// 'stale-conn' instead of firing an http request that would 404/mixed-content.
let _imgEpoch = 0;
export function bumpPlexImageEpoch(): void { _imgEpoch += 1; }

// Concurrency gate for the CapacitorHttp data-URI fallback path — keeps at
// most MAX_IMG_CONCURRENCY bridge round-trips in flight so we don't spike the
// JS heap with base64 payloads. Chrome-66-safe (plain arrays / promises).
//
// Focus mode: when a detail page is open we want it to own ALL image bandwidth.
// While `imageFocusMode` is true, ONLY entries registered with `priority: true`
// start; non-priority waiters park in the FIFO queue and resume once focus is
// released. In-flight requests are never cancelled (CapacitorHttp can't cancel).
const MAX_IMG_CONCURRENCY = 4;
let _imgInflight = 0;
const _imgWaiters: Array<{ resolve: () => void; priority: boolean }> = [];

let imageFocusMode = false;
export function isPlexImageFocusOn(): boolean { return imageFocusMode; }
export function setPlexImageFocus(on: boolean): void {
  const next = !!on;
  if (imageFocusMode === next) return;
  imageFocusMode = next;
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('plex-image-focus', { detail: { on: next } }));
    }
  } catch { /* ignore */ }
  if (!next) {
    // Release parked waiters up to the concurrency cap.
    while (_imgInflight < MAX_IMG_CONCURRENCY && _imgWaiters.length > 0) {
      const w = _imgWaiters.shift();
      if (!w) break;
      _imgInflight += 1;
      w.resolve();
    }
  }
}
export function onPlexImageFocusChange(cb: (on: boolean) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ on: boolean }>).detail;
    cb(!!detail?.on);
  };
  if (typeof window === 'undefined') return () => { /* no-op */ };
  window.addEventListener('plex-image-focus', handler);
  return () => window.removeEventListener('plex-image-focus', handler);
}

function pickNextWaiterIdx(): number {
  for (let i = 0; i < _imgWaiters.length; i++) {
    if (!imageFocusMode || _imgWaiters[i].priority) return i;
  }
  return -1;
}

function acquireImgSlot(priority: boolean): Promise<void> {
  const canStart = _imgInflight < MAX_IMG_CONCURRENCY && (!imageFocusMode || priority);
  if (canStart) {
    _imgInflight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => { _imgWaiters.push({ resolve, priority }); });
}
function releaseImgSlot(): void {
  const idx = pickNextWaiterIdx();
  if (idx >= 0) {
    const w = _imgWaiters.splice(idx, 1)[0];
    // Slot count stays the same — transferring in-flight ownership.
    w.resolve();
  } else {
    _imgInflight = Math.max(0, _imgInflight - 1);
  }
}

/** Fetch a Plex image and return a data URI. On native uses CapacitorHttp
 *  (bypasses WebView mixed-content). On web returns the URL as-is. */
export async function plexFetchImageDataUri(url: string, priority = false): Promise<string> {
  const cached = _imgCache.get(url);
  if (cached) return cached;
  let native = false;
  let CapacitorHttpRef: typeof import('@capacitor/core').CapacitorHttp | null = null;
  try {
    const mod = await import('@capacitor/core');
    native = !!mod.Capacitor.isNativePlatform?.();
    CapacitorHttpRef = mod.CapacitorHttp;
  } catch { /* web */ }
  if (!native || !CapacitorHttpRef) {
    _imgCache.set(url, url);
    return url;
  }
  await acquireImgSlot(priority);
  try {
    const headers = plexHeaders();
    const res = await CapacitorHttpRef.request({
      method: 'GET',
      url,
      headers,
      responseType: 'blob',
      connectTimeout: 15000,
      readTimeout: 20000,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`Plex image HTTP ${res.status}`);
    const b64 = typeof res.data === 'string' ? res.data : '';
    const data = `data:image/jpeg;base64,${b64}`;
    _imgCache.set(url, data);
    return data;
  } finally {
    releaseImgSlot();
  }
}

/** Preload a batch of https image URLs via `new Image()`. Never rejects.
 *  Resolves when all requests settle OR when `timeoutMs` elapses (whichever
 *  comes first). http:// URLs are skipped — they'd be blocked by mixed-content
 *  and are handled elsewhere via the CapacitorHttp data-URI path. */
export function preloadImages(urls: string[], timeoutMs: number): Promise<void> {
  const usable: string[] = [];
  for (const u of urls) { if (typeof u === 'string' && /^https:\/\//i.test(u)) usable.push(u); }
  if (usable.length === 0 || typeof Image === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  const loaders = usable.map((u) => new Promise<void>((resolve) => {
    try {
      const img = new Image();
      const done = () => resolve();
      img.onload = done;
      img.onerror = done;
      img.src = u;
    } catch { resolve(); }
  }));
  const all = Promise.all(loaders).then(() => undefined).catch(() => undefined);
  const timer = new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, timeoutMs)));
  return Promise.race([all, timer]);
}

// ── hubs + search ─────────────────────────────────────────────────────────

function mapMetadata(items: Array<Record<string, unknown>>): PlexItem[] {
  return items.map((m) => ({
    ratingKey: String(m.ratingKey ?? ''),
    title: String(m.title || m.grandparentTitle || ''),
    type: String(m.type || 'movie'),
    thumb: (m.thumb as string | undefined) || (m.grandparentThumb as string | undefined),
    art: m.art as string | undefined,
    year: m.year as number | undefined,
    summary: m.summary as string | undefined,
    duration: m.duration as number | undefined,
    videoResolution: mediaRes(m),
  }));
}

/** Fetch a hub (On Deck, Recently Added, etc.) by path. */
export async function getPlexHub(base: string, token: string, path: string): Promise<PlexItem[]> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', `${base}${path}`, token);
  const items = data?.MediaContainer?.Metadata || [];
  return mapMetadata(items).filter((it) => it.type === 'movie' || it.type === 'show' || it.type === 'episode');
}

/** Universal search across all libraries. Returns movies + shows only. */
export async function searchPlex(base: string, token: string, query: string): Promise<PlexItem[]> {
  const url = `${base}/hubs/search?query=${encodeURIComponent(query)}&limit=30`;
  const data = await plexReq<{ MediaContainer?: { Hub?: Array<{ Metadata?: Array<Record<string, unknown>> }> } }>('GET', url, token);
  const hubs = data?.MediaContainer?.Hub || [];
  const out: PlexItem[] = [];
  for (const h of hubs) {
    if (!h.Metadata) continue;
    for (const it of mapMetadata(h.Metadata)) {
      if (it.type === 'movie' || it.type === 'show') out.push(it);
    }
  }
  return out;
}

// ── hidden library persistence ────────────────────────────────────────────

const PLEX_HIDDEN_KEY = 'snow-plex-hidden-libs-v1';

export async function loadHiddenPlexLibs(): Promise<string[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PLEX_HIDDEN_KEY });
    if (value) return JSON.parse(value) as string[];
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(PLEX_HIDDEN_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

export async function saveHiddenPlexLibs(keys: string[]): Promise<void> {
  const json = JSON.stringify(keys);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PLEX_HIDDEN_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(PLEX_HIDDEN_KEY, json); } catch { /* ignore */ }
}

// ── detail metadata + episodes ────────────────────────────────────────────

export interface PlexPerson { id?: string; tag: string; role?: string; thumb?: string; }
export interface PlexMediaTech {
  videoResolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
}

export interface PlexMetadata {
  ratingKey: string;
  title: string;
  type: string;                 // 'movie' | 'show' | 'season' | 'episode'
  year?: number;
  summary?: string;
  /** ms */
  duration?: number;
  contentRating?: string;
  studio?: string;
  /** 0..10 */
  audienceRating?: number;
  /** 0..10 (critics) */
  rating?: number;
  genres: string[];
  cast: PlexPerson[];
  directors: string[];
  art?: string;
  thumb?: string;
  /** Resume position, ms */
  viewOffset?: number;
  media?: PlexMediaTech;
  librarySectionID?: string;
}

export async function getPlexMetadata(base: string, token: string, ratingKey: string): Promise<PlexMetadata> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>(
    'GET', `${base}/library/metadata/${ratingKey}?includeExtras=0`, token,
  );
  const m = data?.MediaContainer?.Metadata?.[0] ?? {};
  const asArr = (v: unknown): Array<Record<string, unknown>> => Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
  const genres = asArr(m.Genre).map((g) => String(g.tag || '')).filter(Boolean);
  const cast: PlexPerson[] = asArr(m.Role).slice(0, 20).map((r) => ({
    id: r.id != null ? String(r.id) : undefined,
    tag: String(r.tag || ''),
    role: r.role ? String(r.role) : undefined,
    thumb: r.thumb ? String(r.thumb) : undefined,
  }));
  const directors = asArr(m.Director).map((d) => String(d.tag || '')).filter(Boolean);
  const mediaArr = asArr(m.Media);
  const media0 = mediaArr[0] as Record<string, unknown> | undefined;
  const media: PlexMediaTech | undefined = media0 ? {
    videoResolution: media0.videoResolution as string | undefined,
    videoCodec: media0.videoCodec as string | undefined,
    audioCodec: media0.audioCodec as string | undefined,
    audioChannels: media0.audioChannels as number | undefined,
  } : undefined;
  return {
    ratingKey: String(m.ratingKey ?? ratingKey),
    title: String(m.title ?? ''),
    type: String(m.type ?? 'movie'),
    year: m.year as number | undefined,
    summary: m.summary as string | undefined,
    duration: m.duration as number | undefined,
    contentRating: m.contentRating as string | undefined,
    studio: m.studio as string | undefined,
    audienceRating: m.audienceRating as number | undefined,
    rating: m.rating as number | undefined,
    genres, cast, directors,
    art: m.art as string | undefined,
    thumb: m.thumb as string | undefined,
    viewOffset: m.viewOffset as number | undefined,
    media,
    librarySectionID: m.librarySectionID != null ? String(m.librarySectionID) : undefined,
  };
}

export interface PlexSeason {
  ratingKey: string;
  title: string;
  index?: number;
  thumb?: string;
  leafCount?: number;
}
export async function getPlexSeasons(base: string, token: string, showKey: string): Promise<PlexSeason[]> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>(
    'GET', `${base}/library/metadata/${showKey}/children`, token,
  );
  const items = data?.MediaContainer?.Metadata || [];
  return items
    .filter((s) => String(s.type || '') === 'season')
    .map((s) => ({
      ratingKey: String(s.ratingKey ?? ''),
      title: String(s.title || `Season ${s.index ?? ''}`),
      index: s.index as number | undefined,
      thumb: s.thumb as string | undefined,
      leafCount: s.leafCount as number | undefined,
    }));
}

export interface PlexEpisode {
  ratingKey: string;
  title: string;
  index?: number;
  thumb?: string;
  /** ms */
  duration?: number;
  summary?: string;
}
export async function getPlexEpisodes(base: string, token: string, seasonKey: string): Promise<PlexEpisode[]> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>(
    'GET', `${base}/library/metadata/${seasonKey}/children`, token,
  );
  const items = data?.MediaContainer?.Metadata || [];
  return items.map((e) => ({
    ratingKey: String(e.ratingKey ?? ''),
    title: String(e.title || ''),
    index: e.index as number | undefined,
    thumb: e.thumb as string | undefined,
    duration: e.duration as number | undefined,
    summary: e.summary as string | undefined,
  }));
}

/** Titles on a library section featuring the given actor. */
export async function getPlexActorItems(
  base: string,
  token: string,
  sectionKey: string,
  actorId: string,
): Promise<PlexItem[]> {
  const url = `${base}/library/sections/${sectionKey}/all?actor=${encodeURIComponent(actorId)}`
    + `&X-Plex-Container-Start=0&X-Plex-Container-Size=60`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', url, token);
  const items = data?.MediaContainer?.Metadata || [];
  return items.map((m) => ({
    ratingKey: String(m.ratingKey),
    title: String(m.title || ''),
    type: String(m.type || 'movie'),
    thumb: m.thumb as string | undefined,
    art: m.art as string | undefined,
    year: m.year as number | undefined,
    summary: m.summary as string | undefined,
    duration: m.duration as number | undefined,
    videoResolution: mediaRes(m),
  }));
}

// ── module-level caches ────────────────────────────────────────────────────

const LIB_TTL_MS = 20 * 60 * 1000;
const HUB_TTL_MS = 5 * 60 * 1000;

interface LibraryCacheEntry {
  items: PlexItem[];
  totalSize: number;
  ts: number;
  complete: boolean;
}
const _libraryCache: Map<string, LibraryCacheEntry> = new Map();

export function libraryCacheKey(base: string, sectionKey: string): string {
  return `${base}|${sectionKey}`;
}
export function getCachedLibrary(base: string, sectionKey: string): LibraryCacheEntry | null {
  const e = _libraryCache.get(libraryCacheKey(base, sectionKey));
  if (!e) return null;
  return e;
}
export function isLibraryCacheFresh(entry: LibraryCacheEntry): boolean {
  return Date.now() - entry.ts < LIB_TTL_MS;
}
export function setCachedLibrary(
  base: string,
  sectionKey: string,
  items: PlexItem[],
  totalSize: number,
  complete: boolean,
): void {
  _libraryCache.set(libraryCacheKey(base, sectionKey), { items, totalSize, ts: Date.now(), complete });
}

interface HubCacheEntry { items: PlexItem[]; ts: number; }
const _hubCache: Map<string, HubCacheEntry> = new Map();

export function getCachedHub(base: string, path: string): PlexItem[] | null {
  const key = `${base}|${path}`;
  const e = _hubCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts >= HUB_TTL_MS) return null;
  return e.items;
}
export function setCachedHub(base: string, path: string, items: PlexItem[]): void {
  _hubCache.set(`${base}|${path}`, { items, ts: Date.now() });
}
