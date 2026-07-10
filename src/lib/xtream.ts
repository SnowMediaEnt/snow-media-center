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
  { label: 'Dreamstreams', host: 'http://dstreams.xyz:8080' },
  { label: 'Vibez',    host: 'https://strmz.xyz' },
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
const PLAYER_ACCOUNT_KEY = 'snow-player-account-v1';

const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '');

// --- Xtream user_info (typed, partial — server returns extra fields too) ----

export interface XtreamUserInfo {
  username?: string;
  password?: string;
  auth?: number | string | boolean;
  status?: string;          // 'Active' | 'Expired' | 'Disabled' | 'Banned' | 'Trial'
  exp_date?: string | number | null; // unix seconds (string most often) — null on lifetime lines
  is_trial?: string | number | boolean;
  active_cons?: string | number;
  created_at?: string | number;
  max_connections?: string | number;
  allowed_output_formats?: string[];
  message?: string;
}

// --- Local Player Account record -------------------------------------------

export interface PlayerAccount {
  serverLabel: string;
  host: string;
  username: string;
  password: string;
  output: 'm3u8' | 'ts';
  expDate: number | null;       // unix seconds
  status: string;               // raw status string from panel
  isTrial: boolean;
  maxConnections: number | null;
  activeCons: number | null;
  createdAt: number | null;     // unix seconds
  lastCheckedAt: number;        // ms epoch
}

const toNumberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
};

export const buildPlayerAccount = (
  server: XtreamServer,
  creds: XtreamCreds,
  ui: XtreamUserInfo | undefined,
): PlayerAccount => ({
  serverLabel: server.label,
  host: creds.host,
  username: creds.username,
  password: creds.password,
  output: creds.output,
  expDate: toNumberOrNull(ui?.exp_date),
  status: String(ui?.status ?? ''),
  isTrial: toBool(ui?.is_trial),
  maxConnections: toNumberOrNull(ui?.max_connections),
  activeCons: toNumberOrNull(ui?.active_cons),
  createdAt: toNumberOrNull(ui?.created_at),
  lastCheckedAt: Date.now(),
});


export async function loadPlayerAccount(): Promise<PlayerAccount | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: PLAYER_ACCOUNT_KEY });
    if (value) return JSON.parse(value) as PlayerAccount;
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(PLAYER_ACCOUNT_KEY);
    if (raw) return JSON.parse(raw) as PlayerAccount;
  } catch { /* ignore */ }
  return null;
}

export async function savePlayerAccount(acc: PlayerAccount): Promise<void> {
  const json = JSON.stringify(acc);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: PLAYER_ACCOUNT_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(PLAYER_ACCOUNT_KEY, json); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); } catch { /* ignore */ }
}

export async function clearPlayerAccount(): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: PLAYER_ACCOUNT_KEY });
  } catch { /* not native */ }
  try { localStorage.removeItem(PLAYER_ACCOUNT_KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); } catch { /* ignore */ }
}

// --- saved accounts (multi-account switcher) --------------------------------

const SAVED_ACCOUNTS_KEY = 'snow-livetv-saved-accounts-v1';
export const SAVED_ACCOUNTS_REFRESH_EVENT = 'savedAccountsRefresh';

export interface SavedAccount {
  id: string;
  serverLabel: string;
  host: string;
  username: string;
  password: string;
  output: 'm3u8' | 'ts';
  addedAt: number;
}

export const savedAccountId = (host: string, username: string): string =>
  `${host.trim().toLowerCase().replace(/\/+$/, '')}::${username.trim().toLowerCase()}`;

export async function loadSavedAccounts(): Promise<SavedAccount[]> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: SAVED_ACCOUNTS_KEY });
    if (value) return JSON.parse(value) as SavedAccount[];
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (raw) return JSON.parse(raw) as SavedAccount[];
  } catch { /* ignore */ }
  return [];
}

export async function saveSavedAccounts(list: SavedAccount[]): Promise<void> {
  const json = JSON.stringify(list);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: SAVED_ACCOUNTS_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(SAVED_ACCOUNTS_KEY, json); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(SAVED_ACCOUNTS_REFRESH_EVENT)); } catch { /* ignore */ }
}

export async function upsertSavedAccount(acc: SavedAccount): Promise<void> {
  const list = await loadSavedAccounts();
  const idx = list.findIndex(a => a.id === acc.id);
  if (idx >= 0) list[idx] = acc;
  else list.push(acc);
  await saveSavedAccounts(list);
}

export async function removeSavedAccount(id: string): Promise<void> {
  const list = await loadSavedAccounts();
  await saveSavedAccounts(list.filter(a => a.id !== id));
}

/** Convert a unix-seconds exp_date to ms epoch (or null). */
export function expDateToMs(expDate: number | null | undefined): number | null {
  if (expDate === null || expDate === undefined) return null;
  if (!Number.isFinite(expDate) || expDate <= 0) return null;
  return Math.floor(expDate) * 1000;
}

/** Whole days until the player account expires. Negative = expired. */
export function daysUntilExp(account: Pick<PlayerAccount, 'expDate'> | null | undefined): number | null {
  const ms = expDateToMs(account?.expDate ?? null);
  if (ms === null) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((ms - today.getTime()) / 86400000);
}

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
  // Fallback: recover from the redundant player-account store. signOut clears
  // both keys, so this never resurrects a deliberately signed-out user.
  try {
    const acc = await loadPlayerAccount();
    if (acc?.host && acc?.username && acc?.password) {
      const c = normalizeCreds({
        host: acc.host,
        username: acc.username,
        password: acc.password,
        output: acc.output ?? 'm3u8',
        serverLabel: acc.serverLabel,
      });
      void saveCreds(c);
      return c;
    }
  } catch { /* ignore */ }
  return null;
}

export async function saveCreds(creds: XtreamCreds): Promise<void> {
  const normalized = normalizeCreds(creds);
  const json = JSON.stringify(normalized);
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: CREDS_KEY, value: json });
  } catch { /* not native */ }
  try { localStorage.setItem(CREDS_KEY, json); } catch { /* ignore */ }
  // Diagnostic: read back and confirm the write is durable.
  try {
    const back = await loadCreds();
    if (!back || back.host !== normalized.host || back.username !== normalized.username) {
      console.warn('[xtream] saveCreds readback mismatch');
      try {
        const [{ trackEvent }, { isNativePlatform }] = await Promise.all([
          import('@/lib/analytics'),
          import('@/utils/platform'),
        ]);
        trackEvent('creds_save_failed', 'player', { native: isNativePlatform() });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
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

// v2 favorites: store enough metadata to render the Favorites list without
// having loaded every channel from the server.
export interface FavChannel {
  stream_id: number;
  name: string;
  num?: number;
  stream_icon?: string;
  category_id?: string;
  epg_channel_id?: string;
}
const FAVS_KEY_V2 = 'snow-livetv-favs-v2';

export function loadFavoritesData(): Map<number, FavChannel> {
  try {
    const raw = localStorage.getItem(FAVS_KEY_V2);
    if (raw) {
      const arr = JSON.parse(raw) as FavChannel[];
      return new Map(arr.map(f => [f.stream_id, f]));
    }
  } catch { /* ignore */ }
  // Fallback: migrate v1 (id-only) favorites so users don't lose them after refactor.
  try {
    const raw = localStorage.getItem(FAVS_KEY);
    if (raw) {
      const ids = JSON.parse(raw) as number[];
      if (Array.isArray(ids) && ids.length) {
        const map = new Map<number, FavChannel>();
        for (const id of ids) {
          const n = Number(id);
          if (Number.isFinite(n)) map.set(n, { stream_id: n, name: `Channel ${n}` });
        }
        try { localStorage.setItem(FAVS_KEY_V2, JSON.stringify([...map.values()])); } catch { /* ignore */ }
        return map;
      }
    }
  } catch { /* ignore */ }
  return new Map();
}

export function saveFavoritesData(m: Map<number, FavChannel>): void {
  try {
    localStorage.setItem(FAVS_KEY_V2, JSON.stringify([...m.values()]));
    localStorage.setItem(FAVS_KEY, JSON.stringify([...m.keys()]));
  } catch { /* ignore */ }
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

// --- Cache busting / refresh ------------------------------------------------
// Bumped by the Player's "Update Channels" action (and on Player open).
// When > 0 we append `_=<nonce>` to every player_api.php call so any
// intermediary HTTP cache (CapacitorHttp / fetch / proxy) returns fresh data.
// Listeners (LiveSection / MoviesSection / SeriesSection) clear their per-
// category caches on the event so the CURRENTLY visible category refetches
// on next view — we never eagerly load every category.
export const XTREAM_REFRESH_EVENT = 'xtream:refresh';
let xtreamRefreshNonce = 0;
export function bumpXtreamRefresh(): number {
  xtreamRefreshNonce += 1;
  try {
    window.dispatchEvent(new CustomEvent(XTREAM_REFRESH_EVENT, { detail: xtreamRefreshNonce }));
  } catch { /* SSR / no window */ }
  return xtreamRefreshNonce;
}
export function getXtreamRefreshNonce(): number { return xtreamRefreshNonce; }

// --- API endpoints ----------------------------------------------------------

const buildBase = (c: XtreamCreds, params: Record<string, string | number>) => {
  const url = new URL(`${c.host}/player_api.php`);
  url.searchParams.set('username', c.username);
  url.searchParams.set('password', c.password);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  if (xtreamRefreshNonce > 0) url.searchParams.set('_', String(xtreamRefreshNonce));
  return url.toString();
};

export async function authenticate(c: XtreamCreds): Promise<any> {
  return httpGetJson(buildBase(c, {}), 15000);
}

export function pickServerForUsername(username: string): XtreamServer {
  const u = username.trim();
  return u.includes('@')
    ? SERVERS.find(s => s.label === 'Vibez') || SERVERS[1]
    : SERVERS.find(s => s.label === 'Dreamstreams') || SERVERS[0];
}

export interface AuthProbeResult {
  ok: boolean;
  server?: XtreamServer;
  creds?: XtreamCreds;
  info?: any;
  userInfo?: XtreamUserInfo;
  error?: string;
}

/** Authenticate against exactly one server routed by username format. */
export async function authenticateRouted(
  username: string,
  password: string,
  onProgress?: (server: XtreamServer) => void,
): Promise<AuthProbeResult> {
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) return { ok: false, error: 'Missing username or password' };

  const server = pickServerForUsername(u);
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
    const ui: XtreamUserInfo | undefined = info?.user_info;
    const auth = ui?.auth;
    const status = String(ui?.status || '').toLowerCase();
    const authed = auth === 1 || auth === '1' || auth === true;
    const disabled = status === 'disabled' || status === 'expired' || status === 'banned';
    if (authed && !disabled) {
      return { ok: true, server, creds, info, userInfo: ui };
    }
    return { ok: false, error: 'Invalid username or password.' };
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't reach ${server.label}. If you're testing in a web browser this is expected — it works in the installed Android app.`,
    };
  }
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

/**
 * Native ExoPlayer variant of the Live stream URL: Vibez (strmz.xyz) is only
 * reliable via the raw .ts container on Fire TV — always swap .m3u8 → .ts for
 * the native player. Dreamstreams works with both.
 */
export function buildNativeLiveUrl(c: XtreamCreds, streamId: number): string {
  return buildLiveStreamUrl(c, streamId).replace(/\.m3u8(\?|$)/i, '.ts$1');
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
