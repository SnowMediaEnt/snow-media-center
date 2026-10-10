// The channels of Recently watched, for the panel Live TV opens with ▶ (over
// the full-screen picture, or at the right edge of the channel list).
//
// The same history the content bar reads (lib/watchHistory, this viewer and
// profile, on the box and on the account), channels only, newest first, one
// row per channel. As on the content bar: a channel on a line no longer
// signed in here is left out (it cannot play), and adult channels never show,
// whatever was watched; nor does a channel whose category is hidden in Hide
// Categories, nor on a Kids profile one outside its own line-up. Every
// signed-in service's channels are in it, each with its own line.
import type { WatchEntry } from '@/lib/watchHistory';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { lineKey } from '@/lib/favoritesSync';
import { isAdultChannel } from '@/lib/adultContent';

export interface RecentChannel {
  /** The history key (watchHistory.channelKey): what Remove takes off. */
  key: string;
  /** `lineKey|stream_id`: the same channel as the one playing. */
  id: string;
  name: string;
  num?: number;
  icon?: string;
  /** Its category's name, when history knows it. */
  category?: string;
  line: XtreamCreds;
  /** A stream to play (what history kept of it). */
  stream: XtreamLiveStream;
  watchedAt: number;
}

/** At most this many rows: the last 10 channels watched. */
export const RECENT_CHANNELS_MAX = 10;

export const recentChannelId = (line: Pick<XtreamCreds, 'host' | 'username'>, streamId: number): string =>
  `${lineKey(line)}|${streamId}`;

export interface RecentChannelsFilter {
  /** Hidden category ids per line (Hide Categories). */
  hidden?: ReadonlyMap<string, ReadonlySet<string>> | null;
  /** A Kids profile: the category ids each line lets it open (null: not Kids). */
  kidsCats?: ReadonlyMap<string, ReadonlySet<string>> | null;
  /** Adult category ids per line: their channels never show, whatever
   *  category name history kept (it is the list's, e.g. Favorites). */
  adultCats?: ReadonlyMap<string, ReadonlySet<string>> | null;
}

/** The rows, newest first. Pure. */
export function recentChannelsFrom(
  history: readonly WatchEntry[],
  lines: readonly XtreamCreds[],
  filter: RecentChannelsFilter = {},
  max: number = RECENT_CHANNELS_MAX,
): RecentChannel[] {
  const byKey = new Map(lines.map((l) => [lineKey(l), l]));
  const out: RecentChannel[] = [];
  const seen = new Set<string>();
  for (const e of [...history].sort((a, b) => b.watchedAt - a.watchedAt)) {
    if (out.length >= max) break;
    const ch = e?.kind === 'channel' ? e.channel : undefined;
    if (!ch || !ch.host || !ch.username || typeof ch.streamId !== 'number') continue;
    const lk = lineKey(ch);
    const line = byKey.get(lk);
    if (!line) continue;
    const id = `${lk}|${ch.streamId}`;
    if (seen.has(id)) continue;
    const cat = ch.categoryId != null && String(ch.categoryId) ? String(ch.categoryId) : undefined;
    // The subtitle is the category's name, or the service's when none was known.
    const category = e.subtitle && e.subtitle !== ch.serverLabel ? e.subtitle : undefined;
    if (isAdultChannel({ name: e.title, categoryName: category })) continue;
    if (cat && filter.adultCats?.get(lk)?.has(cat)) continue;
    if (cat && filter.hidden?.get(lk)?.has(cat)) continue;
    if (filter.kidsCats && !(cat && filter.kidsCats.get(lk)?.has(cat))) continue;
    seen.add(id);
    out.push({
      key: e.key,
      id,
      name: e.title,
      num: ch.num,
      icon: ch.icon || e.poster,
      category,
      line,
      stream: { stream_id: ch.streamId, name: e.title, num: ch.num, stream_icon: ch.icon || e.poster, category_id: cat },
      watchedAt: e.watchedAt,
    });
  }
  return out;
}
