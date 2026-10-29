// Row definitions for the Plex library view.
//
// Every query here is served by the Plex server. The point is that a
// 4000-title library costs the same as a 40-title one — the old library tab
// paged the ENTIRE section into memory just to show it in title order.
//
// Several of these are counter-intuitive and were each checked against
// python-plexapi / Kometa rather than guessed. The comments say which and why,
// because the failure mode for getting one wrong is silent: Plex ignores
// unrecognised query params, so a bad filter returns the whole library looking
// like it worked.

import i18n from '@/i18n';
import type { PlexItem } from '@/lib/plex';

export type PlexSectionType = 'movie' | 'show';

export interface LibraryRowSpec {
  /** Stable id. The focus cursor tracks THIS, not an array index — rows arrive
   *  asynchronously and an index cursor would drift under the user. */
  id: string;
  /** The row's heading, as a translation key (translated when drawn). */
  titleKey: string;
  /** 'onDeck' uses the dedicated endpoint; 'query' uses /all with this query;
   *  'studios' is the row of studio groups (plexStudios), not titles. */
  kind: 'onDeck' | 'query' | 'studios';
  query?: string;
  /** Rows in wave 2 are fetched only once the user moves toward them. */
  wave: 1 | 2;
}

const typeNum = (t: PlexSectionType) => (t === 'movie' ? 1 : 2);

/**
 * `>>` is Plex's "after" operator, URL-encoded. It is load-bearing, not
 * decoration: combining :desc with :nullsLast on one field is unverified, so
 * undated titles would sort to the TOP under a bare :desc. The date bound
 * excludes them instead.
 */
const AFTER = '%3E%3E';

export function libraryRowSpecs(type: PlexSectionType): LibraryRowSpec[] {
  const t = typeNum(type);
  const rows: LibraryRowSpec[] = [
    { id: 'continue', titleKey: 'plex.library.rows.continue', kind: 'onDeck', wave: 1 },
  ];

  if (type === 'movie') {
    rows.push({
      id: 'released',
      titleKey: 'plex.library.rows.released',
      kind: 'query',
      wave: 1,
      query: `type=1&sort=originallyAvailableAt:desc&originallyAvailableAt${AFTER}=-2y`,
    });
  } else {
    // A TV library has no "recently released" — Plex's own hub is Recently
    // Aired, which is EPISODES. And the prefix is mandatory: on a show section
    // the bare `originallyAvailableAt` resolves to the SERIES premiere date, so
    // an unprefixed query returns episodes of shows that premiered recently and
    // can never surface a new episode of a long-running show.
    rows.push({
      id: 'released',
      titleKey: 'plex.library.rows.aired',
      kind: 'query',
      wave: 1,
      query: `type=4&sort=episode.originallyAvailableAt:desc&episode.originallyAvailableAt${AFTER}=-3mon`,
    });
  }

  rows.push({
    id: 'added',
    titleKey: 'plex.library.rows.added',
    kind: 'query',
    wave: 1,
    // Deliberately NOT /library/sections/{k}/recentlyAdded: that endpoint does
    // not declare Container-Start/Size, so its response length is uncappable —
    // a real memory risk on a 512MB stick. python-plexapi implements
    // recentlyAdded() as this sort for the same reason.
    query: `type=${t}&sort=addedAt:desc`,
  });

  // Studio groups (plexStudios): text tiles, OK filters the library to that
  // studio. Wave 2 — it costs the section's facts and its studio list.
  rows.push({ id: 'studios', titleKey: 'plex.library.rows.studios', kind: 'studios', wave: 2 });

  rows.push({
    id: 'unwatched',
    titleKey: type === 'movie' ? 'plex.library.rows.unwatchedMovies' : 'plex.library.rows.unwatchedShows',
    kind: 'query',
    wave: 2,
    // `unwatched` does not exist for the show libtype — the show-level field is
    // `unwatchedLeaves`. Sending `unwatched` to a TV section silently falls
    // back to `episode.unwatched`, which matches nearly every show and makes
    // the row a duplicate of the A-Z grid.
    query: type === 'movie'
      ? 'type=1&unwatched=1&sort=addedAt:desc'
      : 'type=2&unwatchedLeaves=1&sort=addedAt:desc',
  });

  rows.push({
    id: 'top',
    titleKey: 'plex.library.rows.top',
    kind: 'query',
    wave: 2,
    // The rating bound does the same null-exclusion job as the date bound
    // above: without it, unrated titles can lead under :desc.
    query: `type=${t}&sort=audienceRating:desc&audienceRating${AFTER}=7`,
  });

  if (type === 'movie') {
    rows.push({
      id: 'again',
      titleKey: 'plex.library.rows.again',
      kind: 'query',
      wave: 2,
      // Movie sections only — viewCount on a show container is not meaningful,
      // and Continue Watching already covers in-progress series.
      query: `type=1&sort=lastViewedAt:desc&viewCount${AFTER}=0`,
    });
  }

  // There is deliberately no "Browse all" row. It sat under the rails while
  // they loaded, so it was the only thing to land on — people pressed Down
  // into it and opened the old grid by accident. The whole library is still
  // one press away: Sort: A-Z on the bar above, which pages.
  return rows;
}

/** Caption lines for a tile. Episodes need their show name and S/E. */
export function tileCaption(it: PlexItem): { line1: string; line2?: string } {
  if (it.type === 'episode') {
    const se = it.parentIndex != null && it.index != null
      ? i18n.t('plex.library.episodeCode', { season: it.parentIndex, episode: it.index })
      : undefined;
    return { line1: it.grandparentTitle || it.title, line2: se };
  }
  return { line1: it.title, line2: it.year ? String(it.year) : undefined };
}

/** Resume progress 0..1, or null when the item is not partially watched. */
export function resumeFraction(it: PlexItem): number | null {
  if (!it.viewOffset || !it.duration || it.duration <= 0) return null;
  const f = it.viewOffset / it.duration;
  return f > 0.01 && f < 0.99 ? f : null;
}

// ── Tile geometry (plex.css, the Apple TV look) ──────────────────────────
/** One tile along a rail, gap included: a 110 px poster or a 200 px wide
 *  still, 12 apart. */
export const RAIL_TILE_PX = 122;
export const WIDE_TILE_PX = 212;
export const RAIL_GAP_PX = 12;
/** A rail's scrolling row as drawn (.plex-rail-row: 16 + art + 8 + 14 + 13
 *  + 16, art 165 or 112): what a rail far from the highlight is drawn as. */
export const RAIL_ROW_H = 232;
export const WIDE_ROW_H = 180;
/** Continue Watching is a row of wide 16:9 stills, as on the Apple TV. */
export function isWideRail(id: string | undefined): boolean { return id === 'continue'; }
/** The Studios row as drawn: 40 px pills in the same .plex-rail-row padding
 *  (16 + 40 + 16). */
export const STUDIO_ROW_H = 72;

/** "1h 38m" / "42m". */
export function plexRuntime(ms: number | undefined): string {
  if (!ms || ms <= 0) return '';
  const total = Math.floor(ms / 60000);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? i18n.t('plex.detail.hoursMinutes', { h, m }) : i18n.t('plex.detail.minutes', { m });
}

/** The facts line under Home's hero title (PlexHero): what the episode is
 *  (its code and name), else the year; the certificate; the runtime. */
export function heroFacts(it: PlexItem): string[] {
  const out: string[] = [];
  if (it.type === 'episode') {
    const code = tileCaption(it).line2;
    if (code) out.push(code);
    if (it.title && it.title !== it.grandparentTitle) out.push(it.title);
  } else if (it.year) out.push(String(it.year));
  if (it.contentRating) out.push(it.contentRating);
  const rt = plexRuntime(it.duration);
  if (rt) out.push(rt);
  return out;
}
