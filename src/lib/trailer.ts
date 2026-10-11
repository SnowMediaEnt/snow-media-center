// A film's or a series' trailer (owner, 2026-10-11: "did we add the trailer
// option to VOD and Plex by chance? with the fix to play in SMC instead of
// going out and the pause fix as well"; ported from Tronix 78d8b7d, 13015b8
// and 1039497).
//
// The panel's get_vod_info / get_series_info usually carry one: the title's
// `info.youtube_trailer` (a video id, sometimes a whole link, often empty).
// The title page has that answer already, so nothing extra is fetched.
//
// With a video id, Trailer plays it inside SMC: a full-screen layer
// (components/livetv/TrailerOverlay) with the video service's own embeddable
// player, its documented iframe embed on its privacy-enhanced host. Nothing is
// extracted or downloaded: the embed plays it. One that will not play there
// (embedding turned off for that video, no network) offers "Open outside the
// app": the watch page through AppManager.openUrl, which Android hands to the
// device's video app or its browser. Without a video id ("Find the trailer")
// a search for "<title> <year> trailer" opens the same way (a search can't be
// embedded). SMC uses no key or server for any of it.
// Kids profiles have no Trailer: once the other video app is open a child
// could browse it freely.
import { Capacitor } from '@capacitor/core';
import i18n from '@/i18n';
import { AppManager } from '@/capacitor/AppManager';
import { toast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { kidsLevel } from '@/lib/kidsFilter';
import type { XtreamSeries, XtreamSeriesInfo, XtreamVodInfo, XtreamVodStream } from '@/lib/xtream';

export type TrailerTarget =
  | { kind: 'video'; id: string }
  | { kind: 'search'; query: string };

export type TrailerKind = 'movie' | 'series';

/** The panel's trailer fields (some panels name it `trailer`). */
export interface TrailerFields {
  youtube_trailer?: unknown;
  trailer?: unknown;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** youtu.be/<id> (with or without the scheme and www). */
const SHORT_LINK = /^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i;
/** youtube.com/… (www, m, music; the no-cookie host), the rest after the host. */
const SITE_LINK = /^(?:https?:\/\/)?(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com\/(.*)$/i;
const WATCH_PARAM = /(?:^|[?&#])v=([A-Za-z0-9_-]{11})(?:[&#]|$)/;
const PATH_ID = /^(?:embed|v|e|shorts|live)\/([A-Za-z0-9_-]{11})(?:[?&#/]|$)/;

/**
 * The video id in a panel's trailer field: a bare id, a watch link, a short
 * link or an embed link. Anything else (empty, "null", "0", a link to some
 * other site, a broken id) is no trailer.
 */
export function trailerIdOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 300) return null;
  if (VIDEO_ID.test(s)) return s;
  const short = SHORT_LINK.exec(s);
  if (short) return short[1];
  const site = SITE_LINK.exec(s);
  if (!site) return null;
  const rest = site[1];
  const v = WATCH_PARAM.exec(rest) ?? PATH_ID.exec(rest);
  return v ? v[1] : null;
}

// A provider's decoration in front of a name: "EN - ", "FR | ", "[4K] ",
// "|EN| ", "4K| ". Upper case only for the bare kind, and never before a
// colon ("SOS: Harbor Patrol" is a title).
const TAG = /^\s*(?:\[[^\]]{1,12}\]|\|[^|]{1,12}\||[A-Z]{2,3}\s*[-|]\s|(?:4K|UHD|FHD|HD|VOD|MULTI)\s*[-|]\s*)\s*/;
const BRACKETS = /\[[^\]]*\]|\([^)]*\)/g;
const QUALITY_TAIL = /(?:\s*[-|]?\s*\b(?:4K|UHD|FHD|HD|SD|HDR|HEVC|H\.?265|[xX]265|2160p|1080p|720p|MULTI)\b)+\s*$/;
const DASH_YEAR_TAIL = /\s+[-|]\s*(?:19|20)\d{2}\s*$/;
const YEAR = /(?:^|\D)((?:19|20)\d{2})(?!\d)/;
const MAX_TITLE = 100;

/** Control characters (tab, new line, NUL…) as spaces. */
function noControls(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 32 || c === 127 ? ' ' : s[i];
  }
  return out;
}

/** A name as a person would type it: no provider tags, brackets or quality marks. */
export function trailerTitle(name: unknown): string {
  let s = typeof name === 'string' ? name : '';
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TAG, '');
    if (next === s) break;
    s = next;
  }
  s = s.replace(BRACKETS, ' ').replace(DASH_YEAR_TAIL, ' ').replace(QUALITY_TAIL, ' ');
  // Control characters and runs of spaces; punctuation inside a name stays.
  s = noControls(s).replace(/\s+/g, ' ').trim();
  return s.length > MAX_TITLE ? s.slice(0, MAX_TITLE).trim() : s;
}

/** The first release year (1900-2099) among these (a date, a year, a name with "(2005)"). */
export function trailerYear(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c !== 'string' && typeof c !== 'number') continue;
    const m = YEAR.exec(String(c));
    if (m) return m[1];
  }
  return null;
}

/** "<title> <year> trailer" (the year when known and not already in the title). */
export function trailerSearchQuery(name: unknown, year: string | null): string | null {
  const title = trailerTitle(name);
  if (!title) return null;
  const withYear = year && !title.endsWith(year) ? `${title} ${year}` : title;
  return `${withYear} trailer`;
}

/** What Trailer opens: the panel's video, else a search for it; null with no name at all. */
export function trailerTarget(o: { fields?: TrailerFields | null; name?: unknown; title?: unknown; years?: unknown[] }): TrailerTarget | null {
  const id = trailerIdOf(o.fields?.youtube_trailer) ?? trailerIdOf(o.fields?.trailer);
  if (id) return { kind: 'video', id };
  // Some panels send the name without its decoration as `title`.
  const name = typeof o.title === 'string' && o.title.trim() ? o.title : o.name;
  const query = trailerSearchQuery(name, trailerYear(...(o.years ?? []), o.name));
  return query ? { kind: 'search', query } : null;
}

/** Fields some panels add to a title that SMC's types leave out. */
type PanelExtras = { title?: unknown; year?: unknown; release_date?: unknown };

/** A film's trailer, from its page's get_vod_info answer (also with none in:
 *  a search). Null on a Kids profile: no Trailer there. */
export const movieTrailer = (m: XtreamVodStream, info: XtreamVodInfo | null | undefined): TrailerTarget | null =>
  kidsLevel() ? null : trailerTarget({
    fields: info?.info, name: m.name, title: (m as PanelExtras).title, years: [info?.info?.releasedate, m.year],
  });

/** A series' trailer, from its page's get_series_info answer. Null on a Kids profile. */
export const seriesTrailer = (s: XtreamSeries, info: XtreamSeriesInfo | null | undefined): TrailerTarget | null => {
  if (kidsLevel()) return null;
  const x = s as PanelExtras;
  return trailerTarget({
    fields: info?.info, name: s.name, title: x.title, years: [info?.info?.releaseDate, x.year, s.releaseDate, x.release_date],
  });
};

/** The trailer's web page (the web build's new tab, and Android's way out). */
export function trailerWebUrl(t: TrailerTarget): string {
  return t.kind === 'video'
    ? `https://www.youtube.com/watch?v=${encodeURIComponent(t.id)}`
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(t.query)}`;
}

/** The embeddable player's privacy-enhanced host (no cookies until it plays). */
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
/** Where the embed's own messages (its player API) may come from. */
export const TRAILER_EMBED_ORIGINS: readonly string[] = [EMBED_ORIGIN, 'https://www.youtube.com'];

/**
 * The embed for a video id, with its documented player parameters: starts
 * at once (the viewer pressed OK for it), its own controls, no other
 * channels' videos at the end, inline, no annotations, no full-screen button
 * (it is full screen already), and its player API on (enablejsapi, with the
 * page's origin) so the remote's OK can pause it. `lang`: the app's language
 * for its controls and captions. `start`: whole seconds in (the layer's
 * resume on a WebView whose paused embed won't play again: the same video,
 * from where it was paused).
 */
export function trailerEmbedUrl(id: string, origin?: string | null, lang?: string | null, start?: number | null): string {
  const p = new URLSearchParams({
    autoplay: '1', controls: '1', rel: '0', playsinline: '1', iv_load_policy: '3', fs: '0', enablejsapi: '1',
  });
  if (origin && /^https?:\/\/[^/\s]+$/.test(origin)) p.set('origin', origin);
  if (lang && /^[a-z]{2}$/.test(lang)) p.set('hl', lang);
  if (typeof start === 'number' && Number.isFinite(start) && start >= 1) p.set('start', String(Math.floor(start)));
  return `${EMBED_ORIGIN}/embed/${encodeURIComponent(id)}?${p.toString()}`;
}

// One press of OK can arrive twice (key repeat, the WebView's echo): one open.
const AGAIN_MS = 1500;
let lastOpenAt = 0;

/** Test hook: forget the last open. */
export function __resetTrailerForTests(): void { lastOpenAt = 0; }

/**
 * Trailer pressed on a title page. The panel's video plays inside the app:
 * `playInside` gets its id (the page draws TrailerOverlay over itself). A
 * search opens outside (openTrailerOutside). Resolves whether something
 * opened. Never on a Kids profile (the button isn't drawn there either).
 */
export async function openTrailer(t: TrailerTarget, kind: TrailerKind, playInside: (id: string) => void): Promise<boolean> {
  if (kidsLevel()) return false;
  if (t.kind === 'video') {
    playInside(t.id);
    try { trackEvent('trailer_open', 'player', { kind, how: t.kind, opened: true, in_app: true }); } catch { /* ignore */ }
    return true;
  }
  const now = Date.now();
  if (now - lastOpenAt < AGAIN_MS) return false;
  return openTrailerOutside(t, kind);
}

/**
 * The trailer outside the app: a search, or "Open outside the app" on a
 * video that can't play inside it. Android: the video app's own link first
 * (a phone's video app takes it), else the web page, which the device hands
 * to its video app or its browser (AppManager.openUrl, Android's ACTION_VIEW).
 * The web build: a new tab. Coming back (Back) returns to the same title page.
 * When nothing on the device could open it, the viewer is told.
 */
export async function openTrailerOutside(t: TrailerTarget, kind: TrailerKind): Promise<boolean> {
  if (kidsLevel()) return false;
  lastOpenAt = Date.now();
  const tries = Capacitor.isNativePlatform() && t.kind === 'video'
    ? [`vnd.youtube:${encodeURIComponent(t.id)}`, trailerWebUrl(t)]
    : [trailerWebUrl(t)];
  let opened = false;
  for (const url of tries) {
    try { await AppManager.openUrl({ url }); opened = true; break; } catch { /* the next way */ }
  }
  if (!opened) {
    lastOpenAt = 0;
    try { toast({ title: i18n.t('live.toast.trailerNoneTitle') }); } catch { /* ignore */ }
  }
  try { trackEvent('trailer_open', 'player', { kind, how: t.kind, opened, in_app: false }); } catch { /* ignore */ }
  return opened;
}
