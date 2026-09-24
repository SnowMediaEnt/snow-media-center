// "Next episode" for Continue Watching. A show whose latest episode was
// finished used to drop off the row; now the episode after it takes its
// place, as in the Plex apps. The server is asked once per show and finished
// episode (seasons, then that season's episodes), and the answer is kept a
// few hours, so Home does not ask again on every visit.
import { getPlexEpisodes, getPlexSeasons, type PlexItem } from '@/lib/plex';
import { finishedShows, type FinishedShow } from '@/lib/plexProgress';

const KEEP_MS = 6 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; item: PlexItem | null }>();

/** The episode after `show`'s finished one (the next season's first when the
 *  season is over), or null at the end of the show. Specials (season 0) are
 *  skipped. */
export async function nextEpisode(base: string, token: string, show: FinishedShow): Promise<PlexItem | null> {
  const key = `${base}|${show.showKey}|${show.season}|${show.index}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.item;
  const seasons = (await getPlexSeasons(base, token, show.showKey))
    .filter((s) => typeof s.index === 'number' && s.index > 0)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  let item: PlexItem | null = null;
  for (const s of seasons) {
    if ((s.index ?? 0) < show.season) continue;
    const eps = (await getPlexEpisodes(base, token, s.ratingKey))
      .filter((e) => typeof e.index === 'number' && (s.index !== show.season || (e.index ?? 0) > show.index))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const e = eps[0];
    if (!e) continue;
    item = {
      ratingKey: e.ratingKey,
      title: e.title,
      type: 'episode',
      // The show's poster on the tile, as the rest of the row does.
      thumb: `/library/metadata/${show.showKey}/thumb`,
      duration: e.duration,
      librarySectionID: show.librarySectionID,
      grandparentTitle: show.showTitle,
      parentIndex: s.index,
      index: e.index,
      lastViewedAt: show.t,
    } as PlexItem;
    break;
  }
  memo.set(key, { at: Date.now(), item });
  return item;
}

/** Next episodes for the shows finished most recently, oldest request last.
 *  One show at a time: a stick does not need eight requests at once. */
export async function upNextEpisodes(base: string, token: string, limit = 8): Promise<PlexItem[]> {
  const out: PlexItem[] = [];
  for (const show of finishedShows(limit)) {
    try {
      const it = await nextEpisode(base, token, show);
      if (it) out.push(it);
    } catch { /* that show is not reachable right now */ }
  }
  return out;
}

/** Tests only. */
export function __resetUpNextForTests(): void { memo.clear(); }
