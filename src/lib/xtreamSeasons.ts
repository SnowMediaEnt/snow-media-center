// A series' seasons as Live TV › VOD › Series lists them, from the panel's
// get_series_info answer.
//
// Panels disagree on the shape. `episodes` is keyed by season number, but
// some leave `seasons` empty (or list seasons that have no episodes, like a
// "Specials" season 0 with nothing in it), and a few send `episodes` as a
// plain array, so the key is just a position and each episode's own `season`
// says where it belongs. The list here is built from the episodes that are
// actually there, ordered by season and by episode number, with the season's
// name taken from `seasons` when the panel gave one.
import type { XtreamEpisode, XtreamSeriesInfo } from '@/lib/xtream';

export interface SeriesSeason {
  number: number;
  name?: string;
  episodes: XtreamEpisode[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function seriesSeasons(info: XtreamSeriesInfo | null | undefined): SeriesSeason[] {
  if (!info) return [];
  const names = new Map<number, string | undefined>();
  for (const s of info.seasons ?? []) {
    const n = num(s?.season_number);
    if (!Number.isNaN(n)) names.set(n, s?.name || undefined);
  }
  const bySeason = new Map<number, XtreamEpisode[]>();
  const raw = info.episodes ?? {};
  const isArray = Array.isArray(raw);
  for (const [key, list] of Object.entries(raw as Record<string, XtreamEpisode[]>)) {
    if (!Array.isArray(list)) continue;
    for (const ep of list) {
      if (!ep || ep.id == null) continue;
      // The episode's own season first; an array's key is only a position.
      const own = num((ep as XtreamEpisode & { season?: unknown }).season);
      const n = !Number.isNaN(own) ? own : isArray ? NaN : num(key);
      if (Number.isNaN(n)) continue;
      const into = bySeason.get(n);
      if (into) into.push(ep); else bySeason.set(n, [ep]);
    }
  }
  const out: SeriesSeason[] = [];
  for (const n of [...bySeason.keys()].sort((a, b) => a - b)) {
    const eps = bySeason.get(n)!;
    // Stable: episodes with no usable number keep the panel's order, last.
    const sorted = eps
      .map((ep, i) => ({ ep, i, k: num(ep.episode_num) }))
      .sort((a, b) => {
        const ak = Number.isNaN(a.k) ? Infinity : a.k;
        const bk = Number.isNaN(b.k) ? Infinity : b.k;
        return ak - bk || a.i - b.i;
      })
      .map((x) => x.ep);
    out.push({ number: n, name: names.get(n), episodes: sorted });
  }
  return out;
}

/** Where autoplay goes after an episode: the next one in its season, else
 *  the first of the next season with episodes; null after the last. */
export function nextEpisode(seasons: SeriesSeason[], season: number, episode: number): { season: number; episode: number } | null {
  if (seasons[season] && episode + 1 < seasons[season].episodes.length) return { season, episode: episode + 1 };
  for (let s = season + 1; s < seasons.length; s++) {
    if (seasons[s].episodes.length) return { season: s, episode: 0 };
  }
  return null;
}
