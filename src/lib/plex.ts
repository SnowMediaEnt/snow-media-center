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
  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform?.()) {
      const res = await CapacitorHttp.request({
        method, url, headers,
        connectTimeout: Math.min(timeoutMs, 15000),
        readTimeout: timeoutMs,
      } as unknown as Record<string, unknown>);
      if (res.status >= 200 && res.status < 300) {
        return (typeof res.data === 'string' ? JSON.parse(res.data || '{}') : res.data) as T;
      }
      throw new Error(`Plex HTTP ${res.status}`);
    }
  } catch (e) {
    if (e instanceof Error && /Plex HTTP \d/.test(e.message)) throw e;
    // otherwise fall through to fetch (non-native)
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
  const data = await plexReq<{ id: number; code: string }>('POST', 'https://plex.tv/api/v2/pins?strong=true');
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

/** Probe a server's connections (local → remote → relay) and return the first reachable base URL. */
export async function pickPlexConnection(server: PlexServer): Promise<string | null> {
  const ordered = [...server.connections].sort(
    (a, b) => (Number(b.local) - Number(a.local)) || (Number(a.relay) - Number(b.relay)),
  );
  for (const c of ordered) {
    if (!c.uri) continue;
    try {
      await plexReq('GET', `${c.uri}/identity`, server.accessToken, 6000);
      return c.uri;
    } catch { /* try next connection */ }
  }
  return null;
}

export interface PlexSavedServer { base: string; token: string; name: string; }

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
}
export async function getPlexLibraryItems(base: string, token: string, sectionKey: string): Promise<PlexItem[]> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<Record<string, unknown>> } }>('GET', `${base}/library/sections/${sectionKey}/all`, token);
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
  }));
}

// ── images + stream URLs ───────────────────────────────────────────────────

export function plexImageUrl(base: string, path: string | undefined, token: string): string | undefined {
  if (!path) return undefined;
  return `${base}${path}?X-Plex-Token=${encodeURIComponent(token)}`;
}

/** Resolve the direct-play part for a movie (its original file on the server). */
export async function getPlexPart(base: string, token: string, ratingKey: string): Promise<{ partKey?: string; container?: string }> {
  const data = await plexReq<{ MediaContainer?: { Metadata?: Array<{ Media?: Array<{ Part?: Array<{ key?: string; container?: string }> }> }> } }>(
    'GET', `${base}/library/metadata/${ratingKey}`, token,
  );
  const part = data?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0];
  return { partKey: part?.key, container: part?.container };
}

export function plexDirectUrl(base: string, partKey: string, token: string): string {
  return `${base}${partKey}?X-Plex-Token=${encodeURIComponent(token)}`;
}

/** HLS transcode fallback — offloads decoding to the Plex server (any codec). */
export function plexTranscodeUrl(base: string, ratingKey: string, token: string): string {
  const path = encodeURIComponent(`/library/metadata/${ratingKey}`);
  const cid = encodeURIComponent(getPlexClientId());
  return `${base}/video/:/transcode/universal/start.m3u8`
    + `?path=${path}&protocol=hls&fastSeek=1&directPlay=0&directStream=1`
    + `&mediaIndex=0&partIndex=0&X-Plex-Client-Identifier=${cid}&X-Plex-Token=${encodeURIComponent(token)}`;
}
