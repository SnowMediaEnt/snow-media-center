// Plex client — PIN sign-in (plex.tv/link), server discovery, library browse,
// and stream-URL building. The plex.tv + PMS APIs don't send CORS headers, so
// on native we use CapacitorHttp; web falls back to fetch (will CORS-fail — the
// installed Android app is the supported path, same as the Xtream client).

import { kidsAllowsLibrary, kidsAllowsPlex, kidsLevel, kidsRatingQuery } from '@/lib/kidsFilter';

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

// Identical GETs already on the wire share one request. Nothing else joins
// them up: the settle screen and Home (when the 9 s cap lets Home in early)
// asked for the same hubs and section rows at the same moment, and each
// paid for its own request and parse. POSTs never share.
const _reqPending = new Map<string, Promise<unknown>>();

function plexReq<T>(method: 'GET' | 'POST', url: string, token?: string, timeoutMs = 20000): Promise<T> {
  if (method !== 'GET') return plexReqRaw<T>(method, url, token, timeoutMs);
  const key = `${url}|${token ?? ''}`;
  const pending = _reqPending.get(key);
  if (pending) return pending as Promise<T>;
  const p = plexReqRaw<T>(method, url, token, timeoutMs);
  _reqPending.set(key, p);
  const clear = () => { if (_reqPending.get(key) === p) _reqPending.delete(key); };
  p.then(clear, clear);
  return p;
}

async function plexReqRaw<T>(method: 'GET' | 'POST', url: string, token?: string, timeoutMs = 20000): Promise<T> {
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
    //
    // responseType 'text': left to itself CapacitorHttp parses the JSON on the
    // Java side, serialises the result back across the bridge, and the WebView
    // parses it again. A hundred-item rail is 200–600 KB, so that was two
    // full parses of every rail on the box's slowest thread. One parse, here.
    const res = await CapacitorHttpRef.request({
      method, url, headers,
      connectTimeout: Math.min(timeoutMs, 15000),
      readTimeout: timeoutMs,
      responseType: 'text',
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

/** Fetch the signed-in Plex account (username/email). Returns null on ANY failure.
 *  Memoised per token for the session: Settings asked plex.tv again every
 *  time the menu cursor landed on it. A failure is not remembered. */
const _accountMemo = new Map<string, Promise<{ username?: string; email?: string; uuid?: string } | null>>();
export function getPlexAccount(token: string): Promise<{ username?: string; email?: string; uuid?: string } | null> {
  const hit = _accountMemo.get(token);
  if (hit) return hit;
  const p = fetchPlexAccount(token);
  _accountMemo.set(token, p);
  void p.then((r) => { if (!r && _accountMemo.get(token) === p) _accountMemo.delete(token); });
  return p;
}
async function fetchPlexAccount(token: string): Promise<{ username?: string; email?: string; uuid?: string } | null> {
  try {
    const data = await plexReq<{ username?: string; email?: string; title?: string; uuid?: string }>('GET', 'https://plex.tv/api/v2/user', token, 8000);
    if (!data) return null;
    return {
      username: (data.username || data.title) as string | undefined,
      email: data.email as string | undefined,
      uuid: data.uuid ? String(data.uuid) : undefined,
    };
  } catch {
    return null;
  }
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

/** All Plex Media Servers the account can reach. Each carries its OWN accessToken.
 *  A good answer is reused for five minutes: the idle connection upgrade and
 *  the relay escape each asked plex.tv for the same list on every Plex open. */
const SERVERS_TTL_MS = 5 * 60 * 1000;
const _serversMemo = new Map<string, { at: number; list: PlexServer[] }>();
export async function getPlexServers(token: string, opts?: { fresh?: boolean }): Promise<PlexServer[]> {
  const hit = _serversMemo.get(token);
  // `fresh`: a full rediscovery (sign-in, Retry after "unreachable") must see
  // connections plex.tv published since — e.g. Remote Access just turned on.
  if (!opts?.fresh && hit && Date.now() - hit.at < SERVERS_TTL_MS) return hit.list;
  const list = await fetchPlexServers(token);
  if (list.length) _serversMemo.set(token, { at: Date.now(), list });
  return list;
}
async function fetchPlexServers(token: string): Promise<PlexServer[]> {
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
export type PlexRoute = 'lan' | 'direct' | 'relay';

/** Human label for the Help menu / buffering card, e.g. "Direct · https". */
export function plexRouteLabel(route: PlexRoute | undefined, base: string): string {
  const secure = base.slice(0, 6).toLowerCase() === 'https:';
  const proto = secure ? 'https' : 'http (unencrypted)';
  if (route === 'lan') return `Home network · ${proto}`;
  if (route === 'direct') return `Direct to server · ${proto}`;
  if (route === 'relay') return 'Plex Relay (speed-capped by Plex)';
  return `Unknown route · ${proto}`;
}

// Set by PlexSection while a stream is on screen. Background probes read it and
// stand down: nothing the app does in the background is worth competing with
// playback for a Fire TV's small socket pool.
let _playbackActive = false;
export function setPlexPlaybackActive(v: boolean) { _playbackActive = v; }
export function isPlexPlaybackActive(): boolean { return _playbackActive; }

/** Route of a base URL we already trust, read straight off the server's own
 *  connection list — no probing, no network. Lets a record saved before routes
 *  were tracked learn its route without a round-trip, so the background upgrade
 *  stops re-running on every single launch. */
export function plexRouteOf(server: PlexServer, base: string): PlexRoute | null {
  const norm = (u: string) => u.replace(/\/+$/, '').toLowerCase();
  const want = norm(base);
  for (const c of server.connections) {
    if (norm(c.uri) !== want) continue;
    return c.relay ? 'relay' : c.local ? 'lan' : 'direct';
  }
  return null;
}

export async function pickPlexConnection(
  server: PlexServer,
  timeoutMs = 3500,
  opts?: { httpsOnly?: boolean; noRelay?: boolean },
): Promise<string | null> {
  const r = await pickPlexConnectionDetailed(server, timeoutMs, opts);
  return r ? r.base : null;
}

/** Same probe as pickPlexConnection, but also says WHICH kind of path won so
 *  the app can tell a relay-capped stream from a genuinely slow one, and keep
 *  looking for a direct path while stuck on the relay. */
export async function pickPlexConnectionDetailed(
  server: PlexServer,
  timeoutMs = 3500,
  opts?: { httpsOnly?: boolean; noRelay?: boolean },
): Promise<{ base: string; route: PlexRoute } | null> {
  const httpsOnly = !!opts?.httpsOnly;
  const noRelay = !!opts?.noRelay;
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
    if (noRelay && c.relay) continue;
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
  const routeOf = (c: Candidate): PlexRoute => (c.priority === 1 ? 'lan' : c.priority === 2 ? 'direct' : 'relay');

  return new Promise<{ base: string; route: PlexRoute } | null>((resolve) => {
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
        resolve(best ? { base: best.url, route: routeOf(best) } : null);
        return;
      }
      if (best && cannotBeat()) {
        settled = true;
        resolve({ base: best.url, route: routeOf(best) });
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

/** Returns the PMS machineIdentifier at `base`, or null if it did not report
 *  one. Callers use it to prove the cached base is still the SAME server —
 *  /identity answers without a token, so a bare "it responded" proves only
 *  that some Plex server is listening, not that it is ours or that our token
 *  works on it. */
export async function getPlexIdentity(base: string, token: string): Promise<string | null> {
  const data = await plexReq<{ MediaContainer?: { machineIdentifier?: string } }>(
    'GET', `${base}/identity`, token, 5000,
  );
  return data?.MediaContainer?.machineIdentifier ?? null;
}

export interface PlexSavedServer { base: string; token: string; name: string; clientIdentifier?: string; owned?: boolean; route?: PlexRoute; }

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
/** The server's movie and TV libraries. Reused for five minutes per server:
 *  every Plex open asked for them again before the settle screen could end,
 *  and the content bar asks too. */
const LIBS_TTL_MS = 5 * 60 * 1000;
const _libsMemo = new Map<string, { at: number; list: PlexLibrary[] }>();
export async function getPlexLibraries(base: string, token: string, opts?: { fresh?: boolean }): Promise<PlexLibrary[]> {
  const key = `${base}|${token}`;
  const hit = _libsMemo.get(key);
  // `fresh`: Plex's own connect-time load. It is the request a dead token
  // first fails on (the /identity check needs no token), and that failure is
  // what triggers the token repair, so it must really go to the server.
  if (!opts?.fresh && hit && Date.now() - hit.at < LIBS_TTL_MS) return kidsLibraries(hit.list);
  const list = await fetchPlexLibraries(base, token);
  _libsMemo.set(key, { at: Date.now(), list });
  return kidsLibraries(list);
}
/** A Kids profile never sees an adult library (see kidsFilter). */
const kidsLibraries = (list: PlexLibrary[]): PlexLibrary[] =>
  kidsLevel() ? list.filter((l) => kidsAllowsLibrary(l.title)) : list;
/** The certificate filter a Kids profile adds to a library listing, joined
 *  onto a query string ('' for everyone else). */
const withKids = (query: string): string => {
  const k = kidsRatingQuery();
  return !k ? query : query ? `${query}&${k}` : k;
};
/** Drops what a Kids profile may not see (a no-op for everyone else). */
export const kidsOnly = (items: PlexItem[]): PlexItem[] => (kidsLevel() ? items.filter((it) => kidsAllowsPlex(it)) : items);
async function fetchPlexLibraries(base: string, token: string): Promise<PlexLibrary[]> {
  const data = await plexReq<{ MediaContainer?: { Directory?: Array<Record<string, unknown>> } }>('GET', `${base}/library/sections`, token);
  const dirs = data?.MediaContainer?.Directory || [];
  // Dedupe by section key: shared/provider servers can return the SAME
  // section more than once in /library/sections (one Directory per share
  // path), which made the Settings tab list repeat libraries "endlessly"
  // and duplicated the tab bar. Keep the first occurrence.
  const seen = new Set<string>();
  const out: PlexLibrary[] = [];
  for (const d of dirs) {
    if (d.type !== 'movie' && d.type !== 'show') continue;
    const key = String(d.key);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, title: String(d.title || 'Library'), type: String(d.type) });
  }
  return out;
}

export interface PlexItem {
  ratingKey: string; title: string; type: string;
  thumb?: string; art?: string; year?: number; summary?: string; duration?: number;
  videoResolution?: string;
  /** Section this item belongs to. ALWAYS a string — Plex sends a JSON number
   *  and every key in this file is normalised through String(), so comparing
   *  a raw number against a libKey string would silently never match. */
  librarySectionID?: string;
  /** Resume position in ms. Present on Continue Watching items. */
  viewOffset?: number;
  /** Episode context (Continue Watching on a TV section returns episodes). */
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  /** 0..10, audience rating when Plex has one, else the critic rating. */
  rating?: number;
  /** "PG-13", "TV-MA" … */
  contentRating?: string;
  genres?: string[];
  /** Plays on this server's account, where a list sends it (Home's Popular). */
  viewCount?: number;
  /** When it was last played, ms since epoch (Continue Watching's order). */
  lastViewedAt?: number;
}

/** Rating, certificate and genres as Plex sends them on LIST payloads, so
 *  the browse screen can describe the highlighted title without a metadata
 *  round-trip. Any of them may be missing; the strip hides what is absent. */
function itemExtras(m: Record<string, unknown>): Pick<PlexItem, 'rating' | 'contentRating' | 'genres'> {
  const ar = typeof m.audienceRating === 'number' ? m.audienceRating : undefined;
  const cr = typeof m.rating === 'number' ? m.rating : undefined;
  const g = Array.isArray(m.Genre)
    ? (m.Genre as Array<Record<string, unknown>>).map((x) => String(x.tag || '')).filter(Boolean)
    : [];
  return {
    rating: ar ?? cr,
    contentRating: typeof m.contentRating === 'string' && m.contentRating ? m.contentRating : undefined,
    genres: g.length ? g.slice(0, 3) : undefined,
  };
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
  const kids = withKids('');
  const url = `${base}/library/sections/${sectionKey}/all?${kids ? `${kids}&` : ''}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`;
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
      ...itemExtras(m),
    })).filter((it) => !kidsLevel() || kidsAllowsPlex(it)),
    totalSize,
  };
}

// ── images + stream URLs ───────────────────────────────────────────────────

export function plexImageUrl(base: string, path: string | undefined, token: string): string | undefined {
  if (!path) return undefined;
  // Already-absolute URL (e.g. the demo catalog's poster-proxy links) — pass
  // it through untouched; there is nothing to sign or prefix.
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
}


/** Resolve the direct-play part for a movie (its original file on the server). */
export async function getPlexPart(base: string, token: string, ratingKey: string): Promise<{ partKey?: string; container?: string; audioCodec?: string; bitrateKbps?: number }> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<{ Media?: Array<{ audioCodec?: string; bitrate?: number; Part?: Array<{ key?: string; container?: string }> }> }> } }>(
    'GET', `${base}/library/metadata/${ratingKey}`, token,
  );
  const media0 = data?.MediaContainer?.Metadata?.[0]?.Media?.[0];
  const part = media0?.Part?.[0];
  // Media.bitrate is the whole file's average, in kbps.
  const kbps = Number(media0?.bitrate);
  return { partKey: part?.key, container: part?.container, audioCodec: media0?.audioCodec, bitrateKbps: kbps > 0 ? kbps : undefined };
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
  // A new transcode session for every start. Without one the server keys the
  // session on the client id alone, so a quality change could be handed the
  // old session (the previous quality, or one it is still tearing down).
  const session = `smc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // audioCodec=aac + maxAudioChannels=6 force Plex to re-encode audio to AAC
  // (up to 5.1) instead of direct-streaming the original — needed for Fire TV
  // devices that reject offloaded EAC3/AC3 / trigger DECODER_INIT_FAILED.
  let url = `${base}/video/:/transcode/universal/start.m3u8`
    + `?path=${path}&protocol=hls&fastSeek=1&directPlay=0&directStream=1`
    + `&audioCodec=aac&maxAudioChannels=6`
    + `&session=${session}&X-Plex-Session-Identifier=${session}&videoQuality=100&autoAdjustQuality=0`
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

/** The box a rail/grid poster is drawn in (see PlexPosterTile). The settle
 *  screen preloads at exactly this size so the tiles hit the browser cache. */
export const POSTER_TILE_W = 140;
export const POSTER_TILE_H = 210;

export function plexPhotoTranscodeUrl(base: string, path: string, token: string, w: number, h: number): string {
  // Already-absolute URL (demo catalog poster-proxy links) — nothing for the
  // Plex photo transcoder to do; hand it back unchanged.
  if (/^https?:\/\//i.test(path)) return path;
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
/** Data-URI posters are big; bound the cache instead of growing all session. */
const IMG_CACHE_MAX = 200;
const capImgCache = () => {
  while (_imgCache.size >= IMG_CACHE_MAX) {
    const first = _imgCache.keys().next().value;
    if (first === undefined) break;
    _imgCache.delete(first);
  }
};
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
// While `imageFocusMode` is true there are two admission tiers: `priority`
// entries (detail poster/backdrop) start first, then `exempt` entries (detail
// secondaries — cast, seasons, episodes, filmography — which MUST load during
// focus because no priority image may be mounted on steps like 'seasons').
// Plain browse images park in the queue and resume once focus is released.
// In-flight requests are never cancelled (CapacitorHttp can't cancel).
const MAX_IMG_CONCURRENCY = 4;
let _imgInflight = 0;
const _imgWaiters: Array<{ resolve: () => void; priority: boolean; exempt: boolean }> = [];

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
      const w = _imgWaiters.pop();
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
  for (let i = 0; i < _imgWaiters.length; i++) if (_imgWaiters[i].priority) return i;   // poster/backdrop first
  for (let i = 0; i < _imgWaiters.length; i++) if (_imgWaiters[i].exempt) return i;     // detail secondaries next
  // Newest first: the tiles under the highlight asked last. First-in first-out
  // served every poster the viewer had already scrolled past before them.
  if (!imageFocusMode) return _imgWaiters.length - 1;                                   // browse only when focus is off
  return -1;
}

function acquireImgSlot(priority: boolean, exempt = false): Promise<void> {
  const canStart = _imgInflight < MAX_IMG_CONCURRENCY && (!imageFocusMode || priority || exempt);
  if (canStart) {
    _imgInflight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => { _imgWaiters.push({ resolve, priority, exempt }); });
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
export async function plexFetchImageDataUri(url: string, priority = false, exempt = false): Promise<string> {
  const cached = _imgCache.get(url);
  if (cached) return cached;
  const pending = _imgPending.get(url);
  if (pending) return pending;
  const p = (async (): Promise<string> => {
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
    const myEpoch = _imgEpoch;
    await acquireImgSlot(priority, exempt);
    if (myEpoch !== _imgEpoch) {
      releaseImgSlot();
      throw new Error('stale-conn');
    }
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
      capImgCache();
      _imgCache.set(url, data);
      return data;
    } finally {
      releaseImgSlot();
    }
  })();
  _imgPending.set(url, p);
  p.finally(() => { _imgPending.delete(url); }).catch(() => { /* swallow: caller sees the rejection */ });
  return p;
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
  return kidsOnly(items.map((m) => ({
    ratingKey: String(m.ratingKey ?? ''),
    title: String(m.title || m.grandparentTitle || ''),
    type: String(m.type || 'movie'),
    // An episode's own thumb is a still from the episode; on a poster tile
    // (Continue Watching, Recently Aired) the show's poster is what reads, as
    // it does in the Plex app. The episode list uses its own mapping and
    // keeps the stills.
    thumb: m.type === 'episode'
      ? ((m.grandparentThumb as string | undefined) || (m.parentThumb as string | undefined) || (m.thumb as string | undefined))
      : ((m.thumb as string | undefined) || (m.grandparentThumb as string | undefined)),
    art: (m.art as string | undefined) || (m.type === 'episode' ? (m.grandparentArt as string | undefined) : undefined),
    year: m.year as number | undefined,
    summary: m.summary as string | undefined,
    duration: m.duration as number | undefined,
    videoResolution: mediaRes(m),
    ...itemExtras(m),
    librarySectionID: m.librarySectionID != null ? String(m.librarySectionID) : undefined,
    viewOffset: typeof m.viewOffset === 'number' ? m.viewOffset : undefined,
    grandparentTitle: m.grandparentTitle as string | undefined,
    parentIndex: typeof m.parentIndex === 'number' ? m.parentIndex : undefined,
    index: typeof m.index === 'number' ? m.index : undefined,
    viewCount: typeof m.viewCount === 'number' ? m.viewCount : undefined,
    // Plex sends seconds.
    lastViewedAt: typeof m.lastViewedAt === 'number' ? m.lastViewedAt * 1000 : undefined,
  })));
}

/** Titles Plex considers related to one item — the content bar's "for you"
 *  row. Plex answers with several hubs (Similar, Same director …); they are
 *  flattened, deduped and capped. Episodes are skipped in favour of shows. */
export async function getPlexRelated(base: string, token: string, ratingKey: string, limit = 10): Promise<PlexItem[]> {
  const data = await plexReq<{ MediaContainer?: { Hub?: Array<{ Metadata?: Array<Record<string, unknown>> }> } }>(
    'GET', `${base}/hubs/metadata/${encodeURIComponent(ratingKey)}/related?count=${limit}&excludeFields=summary`, token, 8000,
  );
  const hubs = data?.MediaContainer?.Hub ?? [];
  const seen = new Set<string>([String(ratingKey)]);
  const out: PlexItem[] = [];
  for (const h of hubs) {
    for (const it of mapMetadata(h.Metadata ?? [])) {
      if (it.type !== 'movie' && it.type !== 'show') continue;
      if (seen.has(it.ratingKey)) continue;
      seen.add(it.ratingKey);
      out.push(it);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** What a rail needs from a list payload, and nothing else. Cast, crew,
 *  countries, collections and GUIDs are most of a movie's list entry and no
 *  rail shows any of them; the server drops them when asked, which halves
 *  the response on a big library and the JSON parse on a small box. Genre,
 *  Media (the 4K badge) and summary (the detail page's first paint) stay. */
export const RAIL_FIELDS = 'includeGuids=0&excludeElements=Director,Writer,Role,Producer,Country,Collection,Label,Guid,Chapter,Marker';
/** A rail that has not answered in this long shows as empty rather than
 *  holding the screen: on a relay hop the default 20 s is what "Plex is
 *  frozen" looks like. */
export const RAIL_TIMEOUT_MS = 10000;

/** Fetch a hub (On Deck, Recently Added, etc.) by path. */
export async function getPlexHub(base: string, token: string, path: string): Promise<PlexItem[]> {
  const sep = path.includes('?') ? '&' : '?';
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', `${base}${path}${sep}${RAIL_FIELDS}`, token, RAIL_TIMEOUT_MS);
  const items = data?.MediaContainer?.Metadata || [];
  return mapMetadata(items).filter((it) => it.type === 'movie' || it.type === 'show' || it.type === 'episode');
}

/**
 * Home's Recently Added: movies and shows together, newest first, as the
 * server lists them. The server names a TV addition by its season (or by a
 * lone episode), and those were dropped, which left the rail all films. Each
 * is folded into its show instead, once, where its newest addition sits. The
 * show inherits no certificate from a season, so a Kids profile sees it only
 * when an episode carried one it allows (kidsOnly, in mapMetadata).
 */
export async function getPlexRecentlyAdded(base: string, token: string, size = 100): Promise<PlexItem[]> {
  const url = `${base}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${size}&${RAIL_FIELDS}`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', url, token, RAIL_TIMEOUT_MS);
  return foldRecentlyAdded(data?.MediaContainer?.Metadata || []);
}

/** The folding half of getPlexRecentlyAdded (exported for tests). */
export function foldRecentlyAdded(list: Array<Record<string, unknown>>): PlexItem[] {
  const asShow = (m: Record<string, unknown>): Record<string, unknown> | null => {
    if (m.type === 'season') {
      if (m.parentRatingKey == null) return null;
      return {
        ratingKey: m.parentRatingKey, type: 'show', title: m.parentTitle,
        thumb: m.parentThumb || m.thumb, art: m.art, year: m.parentYear,
        librarySectionID: m.librarySectionID,
      };
    }
    if (m.type === 'episode') {
      if (m.grandparentRatingKey == null) return null;
      return {
        ratingKey: m.grandparentRatingKey, type: 'show', title: m.grandparentTitle,
        thumb: m.grandparentThumb || m.parentThumb || m.thumb, art: m.grandparentArt || m.art,
        // An episode normally carries its show's certificate.
        contentRating: m.contentRating,
        librarySectionID: m.librarySectionID,
      };
    }
    return m;
  };
  const seen = new Set<string>();
  const out: PlexItem[] = [];
  const folded = list.map(asShow).filter((m): m is Record<string, unknown> => !!m);
  for (const it of mapMetadata(folded)) {
    if (it.type !== 'movie' && it.type !== 'show') continue;
    if (!it.ratingKey || !it.title || seen.has(it.ratingKey)) continue;
    seen.add(it.ratingKey);
    out.push(it);
  }
  return out;
}

// ── library rows + facets ─────────────────────────────────────────────────
//
// Everything below drives the row-based library view. Every request is served
// by the Plex server, so a 4000-title library costs the same as a 40-title one.
//
// The API details here were each verified against python-plexapi and Kometa
// rather than guessed, because several of them are counter-intuitive:
//   • /onDeck has a CAPITAL D. Lowercase 404s.
//   • On a SHOW section the bare field name resolves to the SHOW's field, so
//     `originallyAvailableAt` is the series premiere, not the episode air
//     date. Recently-Aired must say `episode.originallyAvailableAt`.
//   • `unwatched` does not exist for the show libtype. The show-level field is
//     `unwatchedLeaves`. Sending `unwatched` to a TV section either errors or
//     silently falls back to `episode.unwatched`, which matches nearly every
//     show and makes the row useless.
//   • `firstCharacter` is NOT a query param on /all — it is its own path.
//     Plex ignores unknown query params, so getting this wrong returns the
//     whole unfiltered library while looking like it worked.

/** Plex libtype numbers. 1 movie, 2 show, 4 episode. */
export const PLEX_TYPE = { movie: 1, show: 2, episode: 4 } as const;

export interface PlexSortOption { key: string; title: string; defaultDirection?: string }
export interface PlexFilterOption { filter: string; key: string; title: string; filterType?: string }
export interface PlexSectionMeta {
  totalSize: number;
  sorts: PlexSortOption[];
  filters: PlexFilterOption[];
}

/** A row of items from a section, by raw query string (no leading ?). */
export async function getPlexSectionRow(
  base: string,
  token: string,
  sectionKey: string,
  query: string,
  limit = 15,
): Promise<PlexItem[]> {
  query = withKids(query);
  const sep = query ? '&' : '';
  const url = `${base}/library/sections/${sectionKey}/all?${query}${sep}${RAIL_FIELDS}`
    + `&X-Plex-Container-Start=0&X-Plex-Container-Size=${limit}`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', url, token, RAIL_TIMEOUT_MS);
  const items = data?.MediaContainer?.Metadata || [];
  return mapMetadata(items).filter((it) => it.type === 'movie' || it.type === 'show' || it.type === 'episode');
}

/** Continue Watching for ONE section. Capital D in onDeck is mandatory. */
export async function getPlexSectionOnDeck(
  base: string,
  token: string,
  sectionKey: string,
): Promise<PlexItem[]> {
  // Trimmed like every rail (RAIL_FIELDS), and on the rail timeout.
  const url = `${base}/library/sections/${sectionKey}/onDeck?${RAIL_FIELDS}&X-Plex-Container-Start=0&X-Plex-Container-Size=20`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', url, token, RAIL_TIMEOUT_MS);
  const items = data?.MediaContainer?.Metadata || [];
  // This endpoint declares no Container-Start/Size, so the response length is
  // whatever the server feels like. Cap it here.
  return mapMetadata(items)
    .filter((it) => it.type === 'movie' || it.type === 'show' || it.type === 'episode')
    .slice(0, 20);
}

/**
 * The section's own sort + filter vocabulary, and its true item count.
 *
 * Container-Size=0 returns zero rows but a real totalSize, so this doubles as
 * the free "Browse all N" count. Deliberately NOT /library/sections/{k}/filters
 * or /sorts: Plex's own docs say not to use those, and both are admin-token
 * only — a user browsing a SHARED library would get 401.
 */
// Sort options, filter lists and genre/year values change when the server
// owner edits a library, not while someone browses. Each library visit asked
// for all of them again (and Discover asked for the same genre lists), so a
// good answer is kept for twenty minutes.
const FACET_TTL_MS = 20 * 60 * 1000;
const _facetMemo = new Map<string, { at: number; value: unknown }>();
async function facetMemo<T>(key: string, load: () => Promise<T>, keep: (v: T) => boolean): Promise<T> {
  const hit = _facetMemo.get(key);
  if (hit && Date.now() - hit.at < FACET_TTL_MS) return hit.value as T;
  const value = await load();
  if (keep(value)) _facetMemo.set(key, { at: Date.now(), value });
  return value;
}

export function getPlexSectionMeta(base: string, token: string, sectionKey: string): Promise<PlexSectionMeta> {
  return facetMemo(`${base}|meta|${sectionKey}`, () => fetchPlexSectionMeta(base, token, sectionKey),
    (m) => !!m && (m.sorts.length > 0 || m.filters.length > 0));
}
async function fetchPlexSectionMeta(
  base: string,
  token: string,
  sectionKey: string,
): Promise<PlexSectionMeta> {
  const url = `${base}/library/sections/${sectionKey}/all?includeMeta=1&includeAdvanced=1`
    + `&X-Plex-Container-Start=0&X-Plex-Container-Size=0`;
  const data = await plexReq<{
    MediaContainer?: {
      totalSize?: number; size?: number;
      Meta?: unknown;
    };
  }>('GET', url, token);
  const c = data?.MediaContainer;
  const totalSize = Number(c?.totalSize ?? c?.size ?? 0) || 0;

  // Meta arrives as an object on some server versions and a one-element array
  // on others. Normalise both.
  const rawMeta = c?.Meta;
  const meta = (Array.isArray(rawMeta) ? rawMeta[0] : rawMeta) as
    | { Type?: Array<{ type?: string; Sort?: unknown; Filter?: unknown }> }
    | undefined;
  const types = meta?.Type || [];
  const t = types.find((x) => x?.type === 'movie' || x?.type === 'show') || types[0];

  const sorts: PlexSortOption[] = (Array.isArray(t?.Sort) ? t!.Sort : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => x?.key && x?.title)
    .map((x) => ({
      key: String(x.key),
      title: String(x.title),
      defaultDirection: x.defaultDirection ? String(x.defaultDirection) : undefined,
    }));

  const filters: PlexFilterOption[] = (Array.isArray(t?.Filter) ? t!.Filter : [])
    .map((x) => x as Record<string, unknown>)
    .filter((x) => x?.filter && x?.key && x?.title)
    .map((x) => ({
      filter: String(x.filter),
      key: String(x.key),
      title: String(x.title),
      filterType: x.filterType ? String(x.filterType) : undefined,
    }));

  return { totalSize, sorts, filters };
}

export interface PlexFilterValue { key: string; title: string }

/**
 * The selectable values for one filter (genres, years, content ratings…).
 * `keyPath` comes from PlexSectionMeta.filters[].key and is server-relative.
 */
export function getPlexFilterValues(base: string, token: string, keyPath: string): Promise<PlexFilterValue[]> {
  const path = keyPath.startsWith('/') ? keyPath : `/${keyPath}`;
  return facetMemo(`${base}|values|${path}`, () => fetchPlexFilterValues(base, token, path), (v) => v.length > 0);
}
async function fetchPlexFilterValues(
  base: string,
  token: string,
  keyPath: string,
): Promise<PlexFilterValue[]> {
  const path = keyPath.startsWith('/') ? keyPath : `/${keyPath}`;
  const data = await plexReq<{ MediaContainer?: { Directory?: Array<Record<string, unknown>> } }>(
    'GET', `${base}${path}`, token,
  );
  const dirs = data?.MediaContainer?.Directory || [];
  return dirs
    .filter((d) => d?.key != null && d?.title != null)
    .map((d) => ({ key: String(d.key), title: String(d.title) }));
}

/**
 * Items whose title starts with `letter`. This has its OWN path — applying a
 * letter as a query param on /all is silently ignored and returns everything.
 */
export async function getPlexByFirstCharacter(
  base: string,
  token: string,
  sectionKey: string,
  letter: string,
  query = '',
  start = 0,
  size = 60,
): Promise<PlexLibraryPage> {
  query = withKids(query);
  const sep = query ? '&' : '';
  const url = `${base}/library/sections/${sectionKey}/firstCharacter/${encodeURIComponent(letter)}`
    + `?${query}${sep}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>>; totalSize?: number; size?: number } }>('GET', url, token);
  const c = data?.MediaContainer;
  const items = c?.Metadata || [];
  const totalSize = Number(c?.totalSize ?? c?.size ?? items.length) || items.length;
  return { items: mapMetadata(items), totalSize };
}

/** Filtered/sorted page of a section — the grid's server-side query. */
export async function getPlexLibraryQuery(
  base: string,
  token: string,
  sectionKey: string,
  query: string,
  start = 0,
  size = 60,
): Promise<PlexLibraryPage> {
  query = withKids(query);
  const sep = query ? '&' : '';
  // The same trim as the rails: a 120-title page without the cast, crew and
  // collection lists is about half the size and half the parse.
  const url = `${base}/library/sections/${sectionKey}/all?${query}${sep}${RAIL_FIELDS}`
    + `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`;
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>>; totalSize?: number; size?: number } }>('GET', url, token);
  const c = data?.MediaContainer;
  const items = c?.Metadata || [];
  const totalSize = Number(c?.totalSize ?? c?.size ?? items.length) || items.length;
  return { items: mapMetadata(items), totalSize };
}

/** Universal search across all libraries. Returns movies + shows only. */
export async function searchPlex(base: string, token: string, query: string): Promise<PlexItem[]> {
  const url = `${base}/hubs/search?query=${encodeURIComponent(query)}&limit=30&${RAIL_FIELDS}`;
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
  /** The file to play (Media[0].Part[0].key). Play uses it instead of asking
   *  the server for the same metadata again. */
  partKey?: string;
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
    partKey: firstPartKey(m),
  };
}

/** Media[0].Part[0].key of a metadata entry, when the payload carries it. */
function firstPartKey(m: Record<string, unknown>): string | undefined {
  const media = Array.isArray(m.Media) ? (m.Media as Array<Record<string, unknown>>)[0] : undefined;
  const part = media && Array.isArray(media.Part) ? (media.Part as Array<Record<string, unknown>>)[0] : undefined;
  return part?.key ? String(part.key) : undefined;
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
  /** See PlexMetadata.partKey. */
  partKey?: string;
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
    partKey: firstPartKey(e),
  }));
}

// ── playback progress on the server ────────────────────────────────────────

/** Tell the server what is playing and where, as the Plex apps do. The server
 *  keeps resume points and On Deck per Plex ACCOUNT, so this is only sent
 *  when the box is signed in with the viewer's own Plex account — never with
 *  the shared provider account, where it would mix everyone's viewing (see
 *  plexProgress for the per-viewer copy every box keeps). Never throws. */
export async function reportPlexTimeline(
  base: string, token: string, ratingKey: string,
  state: 'playing' | 'paused' | 'stopped', timeSec: number, durationSec: number,
): Promise<void> {
  if (!base || !ratingKey || !(durationSec > 0)) return;
  const q = `ratingKey=${encodeURIComponent(ratingKey)}`
    + `&key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`
    + `&identifier=com.plexapp.plugins.library`
    + `&state=${state}`
    + `&time=${Math.max(0, Math.round(timeSec * 1000))}`
    + `&duration=${Math.round(durationSec * 1000)}`;
  try { await plexReq('GET', `${base}/:/timeline?${q}`, token, 8000); } catch { /* the next report will do */ }
}

// ── episode playback: markers and what comes next ─────────────────────────

/** A stretch of an episode Plex has marked, in seconds. */
export interface PlexMarker { type: string; start: number; end: number }

/** What the player needs about the title on screen: whether it is an
 *  episode, where its intro and credits are (Plex's own markers — present
 *  when the server's intro/credits detection has run) and, for an episode,
 *  where it sits in its show. */
export interface PlexPlayInfo {
  ratingKey: string;
  kind: 'movie' | 'episode';
  title: string;
  librarySectionID?: string;
  index?: number;
  seasonIndex?: number;
  seasonKey?: string;
  showKey?: string;
  showTitle?: string;
  showThumb?: string;
  /** seconds */
  duration?: number;
  markers: PlexMarker[];
}

/** Details and markers for a movie or an episode; null for anything else. */
export async function getPlexPlayInfo(base: string, token: string, ratingKey: string): Promise<PlexPlayInfo | null> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>(
    // Not RAIL_FIELDS: that trim excludes Marker, the one element wanted here.
    'GET', `${base}/library/metadata/${ratingKey}?includeMarkers=1&includeGuids=0&excludeElements=Director,Writer,Role,Producer,Country,Collection,Label,Guid,Chapter,Genre`, token, RAIL_TIMEOUT_MS,
  );
  const m = data?.MediaContainer?.Metadata?.[0];
  if (!m || (m.type !== 'episode' && m.type !== 'movie')) return null;
  const markers = (Array.isArray(m.Marker) ? (m.Marker as Array<Record<string, unknown>>) : [])
    .map((k) => ({
      type: String(k.type || ''),
      start: Number(k.startTimeOffset) / 1000,
      end: Number(k.endTimeOffset) / 1000,
    }))
    .filter((k) => k.type && Number.isFinite(k.start) && Number.isFinite(k.end) && k.end > k.start);
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown) => (v != null && v !== '' ? String(v) : undefined);
  return {
    ratingKey: String(m.ratingKey ?? ratingKey),
    kind: m.type === 'episode' ? 'episode' : 'movie',
    title: String(m.title ?? ''),
    librarySectionID: str(m.librarySectionID),
    index: num(m.index),
    seasonIndex: num(m.parentIndex),
    seasonKey: str(m.parentRatingKey),
    showKey: str(m.grandparentRatingKey),
    showTitle: str(m.grandparentTitle),
    showThumb: str(m.grandparentThumb),
    duration: typeof m.duration === 'number' ? m.duration / 1000 : undefined,
    markers,
  };
}

/** The episode after this one: the next in its season, else the first of the
 *  next season. Null at the end of the show. */
export async function getNextPlexEpisode(
  base: string, token: string, info: PlexPlayInfo,
): Promise<(PlexEpisode & { seasonIndex?: number }) | null> {
  if (info.kind !== 'episode') return null;
  const byIndex = <T extends { index?: number }>(list: T[]) =>
    list.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (info.seasonKey) {
    const eps = byIndex(await getPlexEpisodes(base, token, info.seasonKey));
    const at = eps.findIndex((e) => e.ratingKey === info.ratingKey);
    const next = at >= 0 ? eps[at + 1] : eps.find((e) => (e.index ?? 0) > (info.index ?? 0));
    if (next) return { ...next, seasonIndex: info.seasonIndex };
  }
  if (!info.showKey) return null;
  const seasons = byIndex(await getPlexSeasons(base, token, info.showKey));
  const nextSeason = seasons.find((s) => (s.index ?? 0) > (info.seasonIndex ?? 0));
  if (!nextSeason) return null;
  const first = byIndex(await getPlexEpisodes(base, token, nextSeason.ratingKey))[0];
  return first ? { ...first, seasonIndex: nextSeason.index } : null;
}

/** Titles on a library section featuring the given actor. */
export async function getPlexActorItems(
  base: string,
  token: string,
  sectionKey: string,
  actorId: string,
): Promise<PlexItem[]> {
  const url = `${base}/library/sections/${sectionKey}/all?${withKids(`actor=${encodeURIComponent(actorId)}`)}`
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
    ...itemExtras(m),
  })).filter((it) => !kidsLevel() || kidsAllowsPlex(it));
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
/** The cached rail however old it is, for painting while a fresh copy loads.
 *  getCachedHub's five minutes decide when to refetch; they no longer decide
 *  whether the viewer sees a spinner in place of rails already in memory. */
export function getCachedHubStale(base: string, path: string): PlexItem[] | null {
  return _hubCache.get(`${base}|${path}`)?.items ?? null;
}
/** The cached rail if it is younger than `maxAgeMs`. */
export function getCachedHubWithin(base: string, path: string, maxAgeMs: number): PlexItem[] | null {
  const e = _hubCache.get(`${base}|${path}`);
  return e && Date.now() - e.ts < maxAgeMs ? e.items : null;
}
// Bumped by clearPlexCaches (sign-out). Loaders that cache their answer even
// when the viewer has moved on pass the epoch they started under, so an
// answer for the previous account that lands after a sign-out is dropped
// instead of refilling the cache the next account reads.
let _hubEpoch = 0;
export function getHubEpoch(): number { return _hubEpoch; }
export function setCachedHub(base: string, path: string, items: PlexItem[], epoch?: number): void {
  if (epoch !== undefined && epoch !== _hubEpoch) return;
  _hubCache.set(`${base}|${path}`, { items, ts: Date.now() });
}

/** The same server reached by a new address (the idle upgrade from http to
 *  https, the relay escape): every rail and page cached under the old base is
 *  still right, because ratingKeys belong to the server, not the address.
 *  Copy the entries across so the swap does not refetch Home under the
 *  viewer's cursor. */
export function rekeyPlexCaches(oldBase: string, newBase: string): void {
  if (!oldBase || !newBase || oldBase === newBase) return;
  const prefix = `${oldBase}|`;
  for (const [k, v] of Array.from(_hubCache.entries())) {
    if (k.startsWith(prefix)) _hubCache.set(`${newBase}|${k.slice(prefix.length)}`, v);
  }
  for (const [k, v] of Array.from(_libraryCache.entries())) {
    if (k.startsWith(prefix)) _libraryCache.set(`${newBase}|${k.slice(prefix.length)}`, v);
  }
  for (const [k, v] of Array.from(_libsMemo.entries())) {
    if (k.startsWith(prefix)) _libsMemo.set(`${newBase}|${k.slice(prefix.length)}`, v);
  }
  for (const [k, v] of Array.from(_facetMemo.entries())) {
    if (k.startsWith(prefix)) _facetMemo.set(`${newBase}|${k.slice(prefix.length)}`, v);
  }
}

/** Wipe ALL in-memory catalog caches (hub rails + library pages). Called on
 *  sign-out so the next Plex account never sees the previous account's rows
 *  when both reach the same server base URL. */
export function clearPlexCaches(): void {
  _hubEpoch += 1;
  _libraryCache.clear();
  _hubCache.clear();
  _accountMemo.clear();
  _serversMemo.clear();
  _libsMemo.clear();
  _facetMemo.clear();
  // The seasonal rows kept across launches (plexSeasonal.ts).
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('smc-season-v1:')) localStorage.removeItem(k);
    }
  } catch { /* storage unavailable */ }
}
