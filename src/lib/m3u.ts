// M3U playlists, for an outside service added as an M3U link (Settings › Add
// another service, lib/outsideSource). xtream.ts hands a line with `m3u` set
// to the functions here, so Live TV, Hide Categories and the rest read a
// playlist exactly as they read a panel's lists:
//   categories  = the playlist's group-title values (no group → "Other"),
//   channels    = its entries, each with a stream_id made from its address,
//   stream URL  = the entry's own address.
// There is no guide for an M3U link in this version.
//
// A provider's playlist is often 10–50 MB, most of it movies and series. Only
// live entries are kept (an address with /movie/ or /series/ in it, or a
// video file, is skipped) and at most MAX_LIVE_ENTRIES of them. The playlist
// is read once and kept while Live TV is on screen, like the panels' lists:
// "Update Channels" (and opening the Player) drop it, as does leaving Live TV
// for Plex or closing the Player (xtream.ts calls clearM3uCache with its own
// kept lists). A failed read is not kept.
//
// The playlist goes straight to the provider (CapacitorHttp on the box, so
// no CORS), never through Snow Media's servers. Never log its address or an
// entry's: they often carry the provider's login.
import i18n from '@/i18n';
import { isDemo } from '@/lib/demoMode';
import { XtreamHttpError } from '@/lib/xtreamListProxy';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

/** Live channels kept from one playlist. A real line-up is a few thousand; past this it is a VOD dump. */
export const MAX_LIVE_ENTRIES = 30_000;
/** A playlist bigger than this (characters) is refused: holding it would take a low-memory box down. */
export const MAX_PLAYLIST_CHARS = 64 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
/** Playlists kept at once: the saved one, and one being tested in Settings. */
const KEEP = 2;

/** Why a playlist could not be used (a plain HTTP refusal is an XtreamHttpError). */
export type M3uFailure = 'not_playlist' | 'too_big';
export class M3uError extends Error {
  readonly reason: M3uFailure;
  constructor(reason: M3uFailure) {
    super(`m3u: ${reason}`);
    this.name = 'M3uError';
    this.reason = reason;
  }
}

export interface M3uPlaylist {
  categories: XtreamCategory[];
  streams: XtreamLiveStream[];
  /** stream_id → the entry's address. */
  urls: Map<number, string>;
  /** The channels of each category, by category_id. */
  byCat: Map<string, XtreamLiveStream[]>;
  /** Entries left out as movies / series. */
  skippedVod: number;
  /** More live entries than MAX_LIVE_ENTRIES: the rest were left out. */
  truncated: boolean;
}

// ── parsing ────────────────────────────────────────────────────────────────

/** FNV-1a, 32 bits: a stable number for a string (stream and category ids). */
export const hash32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

/** A positive 31-bit id: some native code reads stream ids as Java ints. */
const id31 = (s: string): number => (hash32(s) & 0x7fffffff) || 1;

/** The id a group's name becomes. The same name always gets the same id, so hidden categories stay hidden across reloads. */
const groupId = (group: string): string => String(id31(`g:${group}`));

/** A movie or an episode, not a live channel: Xtream's /movie/ and /series/ paths, or a video file. */
export const isVodUrl = (url: string): boolean => {
  const path = url.split(/[?#]/)[0].toLowerCase();
  return /\/(movie|movies|series)\//.test(path) || /\.(mp4|mkv|avi|mov|m4v)$/.test(path);
};

/** `key="value"` pairs of an #EXTINF line (double, single or no quotes), keys in lowercase. */
const readAttributes = (head: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  }
  return out;
};

/** "#EXTINF:-1 tvg-id="x" group-title="News, UK",BBC One" → its attributes and its title (after the first comma outside quotes). */
const readExtinf = (line: string): { attrs: Record<string, string>; title: string } => {
  const body = line.slice(line.indexOf(':') + 1);
  let quote = '';
  let cut = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { cut = i; break; }
  }
  const head = cut >= 0 ? body.slice(0, cut) : body;
  const title = cut >= 0 ? body.slice(cut + 1).trim() : '';
  return { attrs: readAttributes(head), title };
};

/** A name for an entry with no title: the last part of its address. */
const nameFromUrl = (url: string): string => {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  const last = path.slice(path.lastIndexOf('/') + 1);
  try { return decodeURIComponent(last) || url; } catch { return last || url; }
};

/**
 * Read a playlist. Pure: no network, no cache. Throws M3uError('not_playlist')
 * when the text is not an M3U channel list (a web page, JSON, a single HLS
 * stream). `otherGroup` names the category of entries without a group.
 */
export function parseM3u(
  input: string,
  opts: { otherGroup?: string; maxEntries?: number } = {},
): M3uPlaylist {
  const otherGroup = opts.otherGroup ?? 'Other';
  const maxEntries = opts.maxEntries ?? MAX_LIVE_ENTRIES;
  // A byte-order mark, read as UTF-8 or (a wrong charset) as Latin-1.
  let text = input.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, '');
  // Old Mac line endings: CR alone.
  if (text.indexOf('\n') < 0 && text.indexOf('\r') >= 0) text = text.replace(/\r/g, '\n');

  const start = text.slice(0, 4096);
  const trimmedStart = start.replace(/^\s+/, '');
  // A web page or JSON (an error, a login page), or ONE HLS stream (its
  // segments would read as "channels"): none of them is a channel list.
  if (/^[<{[]/.test(trimmedStart) || /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(start)) {
    throw new M3uError('not_playlist');
  }
  const header = /^#EXTM3U/i.test(trimmedStart);

  const categories: XtreamCategory[] = [];
  const byCat = new Map<string, XtreamLiveStream[]>();
  const streams: XtreamLiveStream[] = [];
  const urls = new Map<number, string>();
  let skippedVod = 0;
  let truncated = false;
  let sawExtinf = false;

  let pending: { attrs: Record<string, string>; title: string } | null = null;
  let pendingGroup = '';

  // Line by line without splitting: a 50 MB playlist split into an array
  // would hold every line twice.
  let pos = 0;
  const n = text.length;
  while (pos < n) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = n;
    const line = text.slice(pos, end).trim();
    pos = end + 1;
    if (!line) continue;
    if (line[0] === '#') {
      if (/^#EXTINF/i.test(line)) {
        pending = readExtinf(line);
        pendingGroup = '';
        sawExtinf = true;
      } else if (/^#EXTGRP:/i.test(line)) {
        pendingGroup = line.slice(line.indexOf(':') + 1).trim();
      }
      // #EXTVLCOPT, #KODIPROP, #EXTM3U and the rest say nothing we use.
      continue;
    }
    // An address. Without an #EXTINF before it, only a real URL counts.
    const url = line;
    const info = pending;
    const grp = pendingGroup;
    pending = null;
    pendingGroup = '';
    if (!info && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) continue;
    if (isVodUrl(url)) { skippedVod += 1; continue; }
    if (streams.length >= maxEntries) { truncated = true; continue; }

    const attrs = info?.attrs ?? {};
    const group = (attrs['group-title'] || grp || '').trim();
    const catId = groupId(group);
    if (!byCat.has(catId)) {
      byCat.set(catId, []);
      categories.push({ category_id: catId, category_name: group || otherGroup });
    }
    // The id comes from the address, so a favourite finds its channel again
    // after a reload. Two entries with one address (or a rare clash) get the
    // next free id, in playlist order.
    let id = id31(url);
    for (let k = 1; urls.has(id) && k < 50; k++) id = id31(`${url}#${k}`);
    if (urls.has(id)) continue;
    const name = (info?.title || attrs['tvg-name'] || nameFromUrl(url)).trim();
    const chno = Number(attrs['tvg-chno']);
    const st: XtreamLiveStream = {
      num: Number.isFinite(chno) && chno > 0 ? chno : streams.length + 1,
      name,
      stream_type: 'live',
      stream_id: id,
      category_id: catId,
      ...(attrs['tvg-logo'] ? { stream_icon: attrs['tvg-logo'] } : {}),
      ...(attrs['tvg-id'] ? { epg_channel_id: attrs['tvg-id'] } : {}),
    };
    urls.set(id, url);
    streams.push(st);
    byCat.get(catId)!.push(st);
  }

  if (!header && !sawExtinf && streams.length === 0) throw new M3uError('not_playlist');
  return { categories, streams, urls, byCat, skippedVod, truncated };
}

// ── download ───────────────────────────────────────────────────────────────

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  // As xtream.ts's directGetJson: on the box CapacitorHttp is the only
  // transport (provider hosts send no CORS headers), and its answer is final.
  let native = false;
  try {
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    native = Capacitor.isNativePlatform?.() === true;
    if (native) {
      const res = await CapacitorHttp.get({
        url,
        headers: { Accept: '*/*' },
        responseType: 'text',
        connectTimeout: Math.min(timeoutMs, 15000),
        readTimeout: timeoutMs,
      } as Parameters<typeof CapacitorHttp.get>[0]);
      if (res.status < 200 || res.status >= 300) throw new XtreamHttpError(res.status);
      const d: unknown = res.data;
      return typeof d === 'string' ? d : d == null ? '' : JSON.stringify(d);
    }
  } catch (e) {
    if (native) throw e;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new XtreamHttpError(r.status);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// ── the kept playlists ─────────────────────────────────────────────────────

const kept = new Map<string, { p: Promise<M3uPlaylist>; data?: M3uPlaylist }>();
/**
 * The addresses of a playlist read before the last "Update Channels": the
 * channel playing through it keeps its address (the player is handed it on
 * every render) until the new copy is in, instead of stopping for the
 * download. Only the addresses, and only until then.
 */
const lastUrls = new Map<string, Map<number, string>>();

/** The playlist at `url`, read once and kept (see the top of this file). */
export function loadM3u(url: string): Promise<M3uPlaylist> {
  // Demo mode never reaches a provider, ours or anyone's.
  if (isDemo()) return Promise.reject(new Error('M3U is disabled in demo mode'));
  const hit = kept.get(url);
  if (hit) {
    kept.delete(url);
    kept.set(url, hit);
    return hit.p;
  }
  const entry = {} as { p: Promise<M3uPlaylist>; data?: M3uPlaylist };
  entry.p = (async () => {
    const text = await fetchText(url, FETCH_TIMEOUT_MS);
    if (text.length > MAX_PLAYLIST_CHARS) throw new M3uError('too_big');
    const list = parseM3u(text, { otherGroup: i18n.t('liveAccount.outside.otherGroup') });
    entry.data = list;
    lastUrls.delete(url);
    return list;
  })();
  entry.p.catch(() => { if (kept.get(url) === entry) kept.delete(url); });
  kept.set(url, entry);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
  return entry.p;
}

export async function m3uCategories(url: string): Promise<XtreamCategory[]> {
  return (await loadM3u(url)).categories;
}

/** Every live entry, or one category's. */
export async function m3uStreams(url: string, categoryId?: string): Promise<XtreamLiveStream[]> {
  const list = await loadM3u(url);
  return categoryId ? list.byCat.get(String(categoryId)) ?? [] : list.streams;
}

/**
 * The address to play for an entry, once the playlist has been read ('' till
 * then). Live TV reads every line's categories as it opens, which reads the
 * playlist; a favourite picked before that lands simply starts when it does
 * (the player is handed the address on the next render).
 */
export function m3uStreamUrl(url: string, streamId: number): string {
  return kept.get(url)?.data?.urls.get(streamId) ?? lastUrls.get(url)?.get(streamId) ?? '';
}

/** Whether the playlist is read already (or on its way). */
export const hasM3u = (url: string): boolean => kept.has(url);

/** Forget one playlist (a favourite heal wants a fresh copy). */
export function forgetM3u(url: string): void { kept.delete(url); }

/**
 * Forget every playlist: leaving Live TV (everything goes), or "Update
 * Channels" (`keepAddresses`: what is playing keeps playing till the new copy
 * is read, see lastUrls).
 */
export function clearM3uCache(opts: { keepAddresses?: boolean } = {}): void {
  if (!opts.keepAddresses) { lastUrls.clear(); kept.clear(); return; }
  for (const [u, e] of kept) if (e.data) lastUrls.set(u, e.data.urls);
  kept.clear();
}
