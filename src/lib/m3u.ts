// M3U playlists, for an outside service added as an M3U link (Settings › Add
// another service, lib/outsideSource). xtream.ts hands a line with `m3u` set
// to the functions here, so Live TV, Hide Categories and the rest read a
// playlist exactly as they read a panel's lists:
//   categories  = the playlist's group-title values (no group → "Other"),
//   channels    = its entries, each with a stream_id made from its address,
//   stream URL  = the entry's own address.
// There is no guide for an M3U link in this version.
//
// A provider's playlist is often 10–50 MB, most of it movies and series, and
// many boxes have 1 GB. So:
//   • a playlist over MAX_PLAYLIST_BYTES is refused before it is downloaded
//     when the server says its size (a HEAD), and after, when it doesn't;
//   • it is read SLICE_LINES lines at a time, giving the remote a turn
//     between slices (parseM3uAsync), so the D-pad never freezes for long;
//   • only live entries are kept (a video file, or Xtream's
//     /movie/<user>/<pass>/<id> and /series/… shapes, is skipped), at most
//     MAX_LIVE_ENTRIES, and every string kept is copied out of the download,
//     which is let go as soon as the reading ends (a slice would hold on to
//     the whole text);
//   • one playlist is kept in memory, while Live TV is on screen, like the
//     panels' lists ("Update Channels", opening the Player, leaving Live TV
//     for Plex or closing the Player drop it: xtream.ts calls clearM3uCache);
//   • what was kept is also written to the box (Filesystem cache) for
//     DISK_TTL_MS: opening the Player again reads that instead of the whole
//     download; "Update Channels" always downloads afresh.
// A failed read is not kept.
//
// Real-world entries: a `|User-Agent=…` (any `|key=value`) after an address
// is cut off (the native player takes no per-stream headers), as is an
// #EXTVLCOPT option; a relative address counts from the playlist's own.
//
// The playlist goes straight to the provider (lib/directHttp: CapacitorHttp
// on the box, redirects followed by hand), never through Snow Media's
// servers. Never log its address or an entry's: they often carry the
// provider's login.
import i18n from '@/i18n';
import { isDemo } from '@/lib/demoMode';
import { contentLength, directGet } from '@/lib/directHttp';
import { noteOutsideStreamHosts } from '@/lib/outsideSource';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

/** Live channels kept from one playlist. A real line-up is a few thousand; past this it is a VOD dump. */
export const MAX_LIVE_ENTRIES = 30_000;
/** A playlist bigger than this is refused: holding it would take a 1 GB box down. */
export const MAX_PLAYLIST_BYTES = 40 * 1024 * 1024;
/** Lines read between two turns for the remote (~tens of ms on a slow box). */
export const SLICE_LINES = 2000;
/** How long the copy kept on the box stands in for a download. */
export const DISK_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;
const HEAD_TIMEOUT_MS = 5000;

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
  /** The hosts the entries play from (analytics never names them: lib/outsideSource). */
  hosts: string[];
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

/**
 * A string of its own. A slice (and a regex match) of the download keeps the
 * WHOLE download alive in V8 for as long as the slice lives; a concatenation
 * flattened by slice() does not.
 */
const own = (s: string): string => (' ' + s).slice(1);

/**
 * A movie or an episode, not a live channel: a video file, or Xtream's
 * /movie/<user>/<pass>/<id> and /series/<user>/<pass>/<id>. A live stream
 * that merely has "movies" in its path (/hls/movies/index.m3u8) stays.
 */
export const isVodUrl = (url: string): boolean => {
  const path = url.split(/[?#|]/)[0].toLowerCase();
  return /\.(mp4|mkv|avi|mov|m4v)$/.test(path) || /\/(movie|series)\/[^/]+\/[^/]+\/[^/]+$/.test(path);
};

/** An address without a `|User-Agent=…` (any `|key=value`) suffix. */
export const playableUrl = (url: string): string => {
  const bar = url.indexOf('|');
  return bar > 0 && url.indexOf('=', bar) > bar ? url.slice(0, bar).trim() : url;
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

export interface ParseOptions {
  /** The category of entries without a group. */
  otherGroup?: string;
  maxEntries?: number;
  /** The playlist's own address: relative entries count from it. */
  base?: string;
  /** The name of an entry with no title and no tvg-name (never its address: that can be a token). */
  channelName?: (n: number) => string;
}

/**
 * A reader that goes through the text a slice of lines at a time. Throws
 * M3uError('not_playlist') at once when the text is not an M3U channel list
 * (a web page, JSON, a single HLS stream).
 */
function createReader(input: string, opts: ParseOptions) {
  const otherGroup = opts.otherGroup ?? 'Other';
  const maxEntries = opts.maxEntries ?? MAX_LIVE_ENTRIES;
  const channelName = opts.channelName ?? ((n: number) => `Channel ${n}`);
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
  const hosts = new Set<string>();
  let skippedVod = 0;
  let truncated = false;
  let sawExtinf = false;
  let pending: { attrs: Record<string, string>; title: string } | null = null;
  let pendingGroup = '';
  let pos = 0;

  const take = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line[0] === '#') {
      if (/^#EXTINF/i.test(line)) {
        pending = readExtinf(line);
        pendingGroup = '';
        sawExtinf = true;
      } else if (/^#EXTGRP:/i.test(line)) {
        pendingGroup = line.slice(line.indexOf(':') + 1).trim();
      }
      // #EXTVLCOPT (a user agent, a referrer), #KODIPROP, #EXTM3U and the
      // rest: the native player takes no per-stream options, so none is kept.
      return;
    }
    const info: { attrs: Record<string, string>; title: string } | null = pending;
    const grp = pendingGroup;
    pending = null;
    pendingGroup = '';
    let url = playableUrl(line);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      // A relative address counts from the playlist's; without one (or a
      // bare line that isn't an entry) it can't be played.
      if (!info || !opts.base) return;
      try { url = new URL(url, opts.base).toString(); } catch { return; }
    }
    if (isVodUrl(url)) { skippedVod += 1; return; }
    if (streams.length >= maxEntries) { truncated = true; return; }

    const attrs = info?.attrs ?? {};
    const group = (attrs['group-title'] || grp || '').trim();
    const catId = groupId(group);
    if (!byCat.has(catId)) {
      byCat.set(catId, []);
      categories.push({ category_id: catId, category_name: own(group || otherGroup) });
    }
    // The id comes from the address, so a favourite finds its channel again
    // after a reload. Two entries with one address (or a rare clash) get the
    // next free id, in playlist order.
    let id = id31(url);
    for (let k = 1; urls.has(id) && k < 50; k++) id = id31(`${url}#${k}`);
    if (urls.has(id)) return;
    const name = (info?.title || attrs['tvg-name'] || '').trim() || channelName(streams.length + 1);
    const chno = Number(attrs['tvg-chno']);
    const st: XtreamLiveStream = {
      num: Number.isFinite(chno) && chno > 0 ? chno : streams.length + 1,
      name: own(name),
      stream_type: 'live',
      stream_id: id,
      category_id: catId,
      ...(attrs['tvg-logo'] ? { stream_icon: own(attrs['tvg-logo']) } : {}),
      ...(attrs['tvg-id'] ? { epg_channel_id: own(attrs['tvg-id']) } : {}),
    };
    urls.set(id, own(url));
    try { const h = new URL(url).hostname.toLowerCase(); if (h) hosts.add(own(h)); } catch { /* no host */ }
    streams.push(st);
    byCat.get(catId)!.push(st);
  };

  return {
    /** Read up to `maxLines` more lines; true once the text is done. */
    step(maxLines: number): boolean {
      // Line by line without splitting: a 40 MB playlist split into an
      // array would hold every line twice.
      const n = text.length;
      for (let i = 0; i < maxLines && pos < n; i++) {
        let end = text.indexOf('\n', pos);
        if (end < 0) end = n;
        take(text.slice(pos, end));
        pos = end + 1;
      }
      if (pos < n) return false;
      text = ''; // the download goes as soon as the reading ends
      return true;
    },
    result(): M3uPlaylist {
      if (!header && !sawExtinf && streams.length === 0) throw new M3uError('not_playlist');
      return { categories, streams, urls, byCat, hosts: [...hosts], skippedVod, truncated };
    },
  };
}

/** Read a whole playlist at once. Pure: no network, no cache (tests, small lists). */
export function parseM3u(input: string, opts: ParseOptions = {}): M3uPlaylist {
  const reader = createReader(input, opts);
  while (!reader.step(Number.MAX_SAFE_INTEGER)) { /* all of it */ }
  return reader.result();
}

/**
 * Read a playlist SLICE_LINES lines at a time, letting the event loop run
 * between slices (the remote, the picture's clock), so a big playlist never
 * freezes the screen for more than one slice. `onSlice` (tests) hears each one.
 */
export async function parseM3uAsync(input: string, opts: ParseOptions & { onSlice?: () => void } = {}): Promise<M3uPlaylist> {
  const reader = createReader(input, opts);
  for (;;) {
    const done = reader.step(SLICE_LINES);
    opts.onSlice?.();
    if (done) break;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  return reader.result();
}

// ── the copy kept on the box ───────────────────────────────────────────────

const diskPath = (url: string) => `outside-m3u/${hash32(url).toString(16)}.json`;
/** "Update Channels": a copy on the box written before this is not used. */
let freshAfter = 0;

type DiskCopy = {
  v: 1;
  at: number;
  /** Which playlist (its address hashed, again: a clash of file names never mixes two). */
  u: string;
  cats: Array<[string, string]>;
  /** [id, name, category, logo, guide id, number, address] */
  rows: Array<[number, string, string, string, string, number, string]>;
  hosts: string[];
  skippedVod: number;
  truncated: boolean;
};

async function nativeFs() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform?.() !== true) return null;
  return import('@capacitor/filesystem');
}

async function readDisk(url: string): Promise<M3uPlaylist | null> {
  try {
    const fs = await nativeFs();
    if (!fs) return null;
    const { data } = await fs.Filesystem.readFile({ path: diskPath(url), directory: fs.Directory.Cache, encoding: fs.Encoding.UTF8 });
    const copy = JSON.parse(String(data)) as DiskCopy;
    if (copy?.v !== 1 || copy.u !== String(hash32(`u:${url}`)) || !Array.isArray(copy.rows)) return null;
    if (Date.now() - copy.at > DISK_TTL_MS || copy.at <= freshAfter) return null;
    const categories: XtreamCategory[] = copy.cats.map(([category_id, category_name]) => ({ category_id, category_name }));
    const byCat = new Map<string, XtreamLiveStream[]>(categories.map((c) => [c.category_id, []]));
    const streams: XtreamLiveStream[] = [];
    const urls = new Map<number, string>();
    for (const [id, name, catId, icon, epg, num, addr] of copy.rows) {
      const st: XtreamLiveStream = { num, name, stream_type: 'live', stream_id: id, category_id: catId, ...(icon ? { stream_icon: icon } : {}), ...(epg ? { epg_channel_id: epg } : {}) };
      streams.push(st);
      urls.set(id, addr);
      (byCat.get(catId) ?? byCat.set(catId, []).get(catId)!).push(st);
    }
    return { categories, streams, urls, byCat, hosts: copy.hosts ?? [], skippedVod: copy.skippedVod ?? 0, truncated: !!copy.truncated };
  } catch {
    return null;
  }
}

async function writeDisk(url: string, list: M3uPlaylist): Promise<void> {
  try {
    const fs = await nativeFs();
    if (!fs) return;
    const copy: DiskCopy = {
      v: 1,
      at: Date.now(),
      u: String(hash32(`u:${url}`)),
      cats: list.categories.map((c) => [c.category_id, c.category_name]),
      rows: list.streams.map((s) => [s.stream_id, s.name, String(s.category_id ?? ''), s.stream_icon ?? '', s.epg_channel_id ?? '', s.num ?? 0, list.urls.get(s.stream_id) ?? '']),
      hosts: list.hosts,
      skippedVod: list.skippedVod,
      truncated: list.truncated,
    };
    await fs.Filesystem.writeFile({ path: diskPath(url), directory: fs.Directory.Cache, data: JSON.stringify(copy), encoding: fs.Encoding.UTF8, recursive: true });
  } catch { /* no room, or not the box: the next visit downloads it */ }
}

async function deleteDisk(url: string): Promise<void> {
  try {
    const fs = await nativeFs();
    if (fs) await fs.Filesystem.deleteFile({ path: diskPath(url), directory: fs.Directory.Cache });
  } catch { /* not there */ }
}

// ── download ───────────────────────────────────────────────────────────────

async function download(url: string): Promise<M3uPlaylist> {
  // Its size first, when the server says it: a playlist too big for the box
  // is refused before a byte of it is held.
  const said = await contentLength(url, HEAD_TIMEOUT_MS);
  if (said != null && said > MAX_PLAYLIST_BYTES) throw new M3uError('too_big');
  const res = await directGet(url, { responseType: 'text', timeoutMs: FETCH_TIMEOUT_MS });
  const told = Number(res.headers['content-length']);
  if (Number.isFinite(told) && told > MAX_PLAYLIST_BYTES) throw new M3uError('too_big');
  const d = res.data;
  const text = typeof d === 'string' ? d : d == null ? '' : JSON.stringify(d);
  if (text.length > MAX_PLAYLIST_BYTES) throw new M3uError('too_big');
  return parseM3uAsync(text, {
    base: res.url || url,
    otherGroup: i18n.t('liveAccount.outside.otherGroup'),
    channelName: (n) => i18n.t('liveAccount.outside.channelN', { n }),
  });
}

// ── the kept playlist ──────────────────────────────────────────────────────

const kept = new Map<string, { p: Promise<M3uPlaylist>; data?: M3uPlaylist }>();
/**
 * The addresses of a playlist let go while one of its channels may still be
 * playing ("Update Channels", another playlist tested in Settings): the
 * player is handed the address on every render, so it keeps it till the new
 * copy is in. Only the addresses.
 */
const lastUrls = new Map<string, Map<number, string>>();

/** The playlist at `url`: the one kept, the box's copy, or a download. */
export function loadM3u(url: string): Promise<M3uPlaylist> {
  // Demo mode never reaches a provider, ours or anyone's.
  if (isDemo()) return Promise.reject(new Error('M3U is disabled in demo mode'));
  const hit = kept.get(url);
  if (hit) return hit.p;
  // One playlist at a time: another one's addresses stay for what is playing.
  for (const [u, e] of kept) {
    if (e.data) lastUrls.set(u, e.data.urls);
    kept.delete(u);
  }
  const entry = {} as { p: Promise<M3uPlaylist>; data?: M3uPlaylist };
  entry.p = (async () => {
    let list = await readDisk(url);
    if (!list) {
      list = await download(url);
      const fresh = list;
      // Written after the screen has had its turn: the copy is for next time.
      setTimeout(() => { void writeDisk(url, fresh); }, 0);
    }
    entry.data = list;
    lastUrls.delete(url);
    noteOutsideStreamHosts(list.hosts);
    return list;
  })();
  entry.p.catch(() => { if (kept.get(url) === entry) kept.delete(url); });
  kept.set(url, entry);
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

/**
 * Forget one playlist (a favourite heal wants a fresh copy). `disk` also
 * deletes the box's copy (the service was removed).
 */
export function forgetM3u(url: string, opts: { disk?: boolean } = {}): void {
  kept.delete(url);
  if (opts.disk) { lastUrls.delete(url); void deleteDisk(url); }
}

/**
 * Forget the kept playlist: leaving Live TV (everything goes), or a refresh
 * (`keepAddresses`: what is playing keeps playing till the new copy is read,
 * see lastUrls). `fresh` ("Update Channels"): the box's copy is not used
 * either, the next read downloads.
 */
export function clearM3uCache(opts: { keepAddresses?: boolean; fresh?: boolean } = {}): void {
  if (opts.fresh) freshAfter = Date.now();
  if (!opts.keepAddresses) { lastUrls.clear(); kept.clear(); return; }
  for (const [u, e] of kept) if (e.data) lastUrls.set(u, e.data.urls);
  kept.clear();
}
