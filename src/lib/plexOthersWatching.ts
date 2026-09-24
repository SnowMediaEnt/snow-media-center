// "What others are watching" on Plex Home: the titles Snow Media viewers
// have been playing over the last seven days.
//
// The counting is already done on the server: media-bar-feed ranks the
// app's plex_play events of the last week by how many boxes played each
// title and hands them out as "Popular this week" items of the provider's
// server (with that server's machineIdentifier and ratingKeys). One call,
// answered from the function's own five-minute cache, kept here for half an
// hour. The titles are then read from the viewer's own server in ONE request
// (Home does that, see PlexSection), which confirms each one is there and
// brings its certificate and genres for the Kids and adult filters.
//
// Only a server the feed describes is served: on another server (the
// viewer's own) the same ratingKeys are other titles, so nothing is shown.
// Nothing here throws.
import { supabase } from '@/integrations/supabase/client';

export const OTHERS_WATCHING_TITLE = 'What others are watching';
/** How long the feed's answer is kept on the box. */
export const OTHERS_TTL_MS = 30 * 60 * 1000;
const FEED_TIMEOUT_MS = 8000;
const MAX_TITLES = 24;
/** The feed's mark on the week's most-played titles (media-bar-feed). */
const POPULAR_WEEK = /^Popular this week/i;

export interface FeedItem {
  ratingKey?: string | number;
  kind?: string;
  title?: string;
  subtitle?: string;
  machineIdentifier?: string;
  librarySectionID?: string | number;
}

/** The week's titles that belong to this server and to a library the viewer
 *  can see, in the feed's order (most boxes first), deduped. Episodes count
 *  as their show on the feed already; anything else is skipped. */
export function othersWatchingKeys(items: FeedItem[] | null | undefined, machineId: string | undefined, visibleSections: Set<string>, max = MAX_TITLES): string[] {
  if (!machineId || !Array.isArray(items)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || !POPULAR_WEEK.test(String(it.subtitle ?? ''))) continue;
    if (it.machineIdentifier !== machineId) continue;
    const key = it.ratingKey != null ? String(it.ratingKey) : '';
    if (!/^\d+$/.test(key) || seen.has(key)) continue;
    if (it.librarySectionID != null && !visibleSections.has(String(it.librarySectionID))) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

let memo: { at: number; items: FeedItem[] } | null = null;
let pending: Promise<FeedItem[] | null> | null = null;

/** The feed's items, from the half-hour memo or one call. Null when it could
 *  not be read (not cached, so the next visit asks again). */
export async function fetchFeedItems(now = Date.now()): Promise<FeedItem[] | null> {
  if (memo && now - memo.at < OTHERS_TTL_MS) return memo.items;
  if (pending) return pending;
  const p = (async (): Promise<FeedItem[] | null> => {
    try {
      const call = supabase.functions.invoke('media-bar-feed');
      const timeout = new Promise<null>((r) => { window.setTimeout(() => r(null), FEED_TIMEOUT_MS); });
      const res = await Promise.race([call, timeout]);
      const data = res && !res.error ? (res.data as { items?: FeedItem[]; error?: string } | null) : null;
      if (!data || data.error || !Array.isArray(data.items)) return null;
      // Only what the row needs: the feed is a whole content bar.
      const items: FeedItem[] = data.items
        .filter((it) => it && POPULAR_WEEK.test(String(it.subtitle ?? '')))
        .map((it) => ({ ratingKey: it.ratingKey, subtitle: it.subtitle, machineIdentifier: it.machineIdentifier, librarySectionID: it.librarySectionID }));
      memo = { at: Date.now(), items };
      return items;
    } catch {
      return null;
    }
  })();
  pending = p;
  void p.then(() => { if (pending === p) pending = null; });
  return p;
}

/** Tests only. */
export function __resetOthersWatchingForTests(): void { memo = null; pending = null; }
