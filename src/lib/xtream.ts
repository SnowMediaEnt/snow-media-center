// Xtream Codes API client.
// - Uses CapacitorHttp on native to bypass CORS, falls back to fetch on web.
// - Credentials are persisted via @capacitor/preferences (with a localStorage fallback).
// - Login is hardcoded to two servers (SERVERS below); the form only collects
//   username + password and we probe servers in order to pick the working host.

export interface XtreamServer {
  label: string;
  host: string; // no trailing slash
}

// EDIT THESE to add / change servers. Order = probe order.
export const SERVERS: XtreamServer[] = [
  { label: 'Dstreams', host: 'http://dstreams.xyz:8080' },
  { label: 'Vibez',    host: 'http://strmz.xyz' },
];

export interface XtreamCreds {
  host: string;
  username: string;
  password: string;
  output: 'm3u8' | 'ts';
  serverLabel?: string;
}

export interface XtreamCategory {
  category_id: string;
  category_name: string;
  parent_id?: number;
}

export interface XtreamLiveStream {
  num?: number;
  name: string;
  stream_type?: string;
  stream_id: number;
  stream_icon?: string;
  epg_channel_id?: string;
  added?: string;
  category_id?: string;
  custom_sid?: string;
  tv_archive?: number;
  direct_source?: string;
  tv_archive_duration?: number;
}

export interface XtreamVodStream {
  num?: number;
  name: string;
  stream_id: number;
  stream_icon?: string;
  rating?: string | number;
  rating_5based?: number;
  year?: string;
  added?: string;
  category_id?: string;
  container_extension?: string; // mp4 / mkv / avi
}

export interface XtreamVodInfo {
  info?: {
    movie_image?: string;
    cover_big?: string;
    plot?: string;
    genre?: string;
    releasedate?: string;
    rating?: string | number;
    duration?: string;
    cast?: string;
    director?: string;
  };
  movie_data?: {
    stream_id: number;
    name: string;
    container_extension: string;
  };
}

export interface XtreamSeries {
  num?: number;
  name: string;
  series_id: number;
  cover?: string;
  plot?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string | number;
  category_id?: string;
}

export interface XtreamEpisode {
  id: string;
  episode_num: number | string;
  title: string;
  container_extension: string;
  info?: {
    plot?: string;
    duration?: string;
    movie_image?: string;
    rating?: string | number;
    releasedate?: string;
  };
}

export interface XtreamSeriesInfo {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string | number;
    cast?: string;
    director?: string;
  };
  seasons?: Array<{ season_number: number; name?: string; cover?: string; episode_count?: number }>;
  episodes?: Record<string, XtreamEpisode[]>; // keyed by season number
}

export interface XtreamEpgEntry {
  id?: string;
  epg_id?: string;
  title: string;        // base64
  lang?: string;
  start: string;
  end: string;
  description?: string; // base64
  channel_id?: string;
  start_timestamp?: string;
  stop_timestamp?: string;
}

const CREDS_KEY = 'snow-livetv-creds-v1';
const FAVS_KEY = 'snow-livetv-favs-v1';
const LAST_CHANNEL_KEY = 'snow-livetv-last-channel-v1';
const VOLUME_KEY = 'snow-livetv-volume-v1';

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '');

export const normalizeCreds = (c: XtreamCreds): XtreamCreds => ({
  ...c,
  host: stripTrailingSlash(c.host.trim()),
  username: c.username.trim(),
  password: c.password.trim(),
  output: c.output || 'm3u8',
});

// --- credential persistence -------------------------------------------------

export async function loadCreds(): Promise<XtreamCreds | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: CREDS_KEY });
    if (value) return JSON.parse(value);
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export async function saveCreds(creds: XtreamCreds): Promise<void> {
  const json = JSON.stringify(normalizeCreds(creds));
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: CREDS_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(CREDS_KEY, json); } catch { /* ignore */ }
}

export async function clearCreds(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: CREDS_KEY });
  } catch { /* not native */ }
  try { localStorage.removeItem(CREDS_KEY); } catch { /* ignore */ }
}

// --- favorites + last channel + volume --------------------------------------

export function loadFavorites(): Set<number> {
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    if (raw) return new Set<number>(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set<number>();
}

export function saveFavorites(s: Set<number>): void {
  try { localStorage.setItem(FAVS_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

export function loadLastChannelId(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHANNEL_KEY);
    return raw ? Number(raw) || null : null;
  } catch { return null; }
}

export function saveLastChannelId(id: number): void {
  try { localStorage.setItem(LAST_CHANNEL_KEY, String(id)); } catch { /* ignore */ }
}

export function loadVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
  } catch { return 0.8; }
}

export function saveVolume(v: number): void {
  try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* ignore */ }
}

// --- HTTP transport ---------------------------------------------------------

async function httpGetJson<T>(url: string, timeoutMs = 20000): Promise<T> {
  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform?.()) {
      const res = await CapacitorHttp.get({
        url,
        headers: { Accept: 'application/json' },
        connectTimeout: Math.min(timeoutMs, 15000),
        readTimeout: timeoutMs,
      } as any);
      if (res.status >= 200 && res.status < 300) {
        return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
      }
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    if (!(e instanceof Error) || !/Capacitor/i.test(e.message)) {
      // real error — surface below via fetch fallback
    }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<T>;
  } finally {
    clearTimeout(t);
  }
}

// --- API endpoints ----------------------------------------------------------

const buildBase = (c: XtreamCreds, params: Record<string, string | number>) => {
  const url = new URL(`${c.host}/player_api.php`);
  url.searchParams.set('username', c.username);
  url.searchParams.set('password', c.password);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return url.toString();
};

export async function authenticate(c: XtreamCreds): Promise<any> {
  return httpGetJson(buildBase(c, {}), 15000);
}

export interface AuthProbeResult {
  ok: boolean;
  server?: XtreamServer;
  creds?: XtreamCreds;
  info?: any;
  error?: string;
}

/** Try each SERVER in order; return the first that authenticates. */
export async function authenticateAny(
  username: string,
  password: string,
  onProgress?: (server: XtreamServer) => void,
): Promise<AuthProbeResult> {
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) return { ok: false, error: 'Missing username or password' };

  let lastErr: string | undefined;
  for (const server of SERVERS) {
    onProgress?.(server);
    const creds = normalizeCreds({
      host: server.host,
      username: u,
      password: p,
      output: 'm3u8',
      serverLabel: server.label,
    });
    try {
      const info: any = await authenticate(creds);
      const ui = info?.user_info;
      const auth = ui?.auth;
      const status = String(ui?.status || '').toLowerCase();
      const authed = auth === 1 || auth === '1' || auth === true;
      const disabled = status === 'disabled' || status === 'expired' || status === 'banned';
      if (authed && !disabled) {
        return { ok: true, server, creds, info };
      }
      lastErr = `Server ${server.label} rejected the login.`;
    } catch (e) {
      lastErr = `Server ${server.label} unreachable.`;
    }
  }
  return { ok: false, error: lastErr || 'Invalid username or password' };
}

// --- Live -------------------------------------------------------------------

export async function getLiveCategories(c: XtreamCreds): Promise<XtreamCategory[]> {
  return httpGetJson<XtreamCategory[]>(buildBase(c, { action: 'get_live_categories' }));
}

export async function getLiveStreams(c: XtreamCreds, categoryId?: string): Promise<XtreamLiveStream[]> {
  const params: Record<string, string | number> = { action: 'get_live_streams' };
  if (categoryId) params.category_id = categoryId;
  return httpGetJson<XtreamLiveStream[]>(buildBase(c, params));
}

export async function getShortEpg(
  c: XtreamCreds,
  streamId: number,
  limit = 10,
): Promise<{ epg_listings: XtreamEpgEntry[] }> {
  return httpGetJson(buildBase(c, { action: 'get_short_epg', stream_id: streamId, limit }));
}

export function buildLiveStreamUrl(c: XtreamCreds, streamId: number): string {
  const ext = c.output === 'ts' ? 'ts' : 'm3u8';
  return `${c.host}/live/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${streamId}.${ext}`;
}

// --- Movies (VOD) -----------------------------------------------------------

export async function getVodCategories(c: XtreamCreds): Promise<XtreamCategory[]> {
  return httpGetJson<XtreamCategory[]>(buildBase(c, { action: 'get_vod_categories' }));
}

export async function getVodStreams(c: XtreamCreds, categoryId?: string): Promise<XtreamVodStream[]> {
  const params: Record<string, string | number> = { action: 'get_vod_streams' };
  if (categoryId) params.category_id = categoryId;
  return httpGetJson<XtreamVodStream[]>(buildBase(c, params));
}

export async function getVodInfo(c: XtreamCreds, vodId: number): Promise<XtreamVodInfo> {
  return httpGetJson<XtreamVodInfo>(buildBase(c, { action: 'get_vod_info', vod_id: vodId }));
}

export function buildMovieUrl(c: XtreamCreds, streamId: number, ext = 'mp4'): string {
  const safeExt = (ext || 'mp4').replace(/^\./, '');
  return `${c.host}/movie/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${streamId}.${safeExt}`;
}

// --- Series -----------------------------------------------------------------

export async function getSeriesCategories(c: XtreamCreds): Promise<XtreamCategory[]> {
  return httpGetJson<XtreamCategory[]>(buildBase(c, { action: 'get_series_categories' }));
}

export async function getSeries(c: XtreamCreds, categoryId?: string): Promise<XtreamSeries[]> {
  const params: Record<string, string | number> = { action: 'get_series' };
  if (categoryId) params.category_id = categoryId;
  return httpGetJson<XtreamSeries[]>(buildBase(c, params));
}

export async function getSeriesInfo(c: XtreamCreds, seriesId: number): Promise<XtreamSeriesInfo> {
  return httpGetJson<XtreamSeriesInfo>(buildBase(c, { action: 'get_series_info', series_id: seriesId }));
}

export function buildEpisodeUrl(c: XtreamCreds, episodeId: string | number, ext = 'mp4'): string {
  const safeExt = (ext || 'mp4').replace(/^\./, '');
  return `${c.host}/series/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${episodeId}.${safeExt}`;
}

// --- EPG helpers ------------------------------------------------------------

export function decodeEpgText(b64?: string): string {
  if (!b64) return '';
  try {
    return decodeURIComponent(
      atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
  } catch {
    return b64;
  }
}

export function parseEpgTime(s: string | undefined): number {
  if (!s) return 0;
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000) return asNum * 1000;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export interface EpgNowNext {
  now?: { title: string; start: number; end: number; description?: string };
  next?: { title: string; start: number; end: number; description?: string };
}

export function pickNowNext(entries: XtreamEpgEntry[]): EpgNowNext {
  const now = Date.now();
  const decoded = entries
    .map(e => ({
      title: decodeEpgText(e.title),
      description: decodeEpgText(e.description),
      start: parseEpgTime(e.start_timestamp || e.start),
      end: parseEpgTime(e.stop_timestamp || e.end),
    }))
    .filter(e => e.end > 0 && e.start > 0)
    .sort((a, b) => a.start - b.start);
  const current = decoded.find(e => e.start <= now && now < e.end);
  const next = decoded.find(e => e.start > now);
  return { now: current, next };
}
