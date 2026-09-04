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

import type { PlexItem } from '@/lib/plex';

export type PlexSectionType = 'movie' | 'show';

export interface LibraryRowSpec {
  /** Stable id. The focus cursor tracks THIS, not an array index — rows arrive
   *  asynchronously and an index cursor would drift under the user. */
  id: string;
  title: string;
  /** 'onDeck' uses the dedicated endpoint; 'query' uses /all with this query. */
  kind: 'onDeck' | 'query' | 'browseAll';
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
    { id: 'continue', title: 'Continue Watching', kind: 'onDeck', wave: 1 },
  ];

  if (type === 'movie') {
    rows.push({
      id: 'released',
      title: 'Recently Released',
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
      title: 'Recently Aired',
      kind: 'query',
      wave: 1,
      query: `type=4&sort=episode.originallyAvailableAt:desc&episode.originallyAvailableAt${AFTER}=-3mon`,
    });
  }

  rows.push({
    id: 'added',
    title: 'Recently Added',
    kind: 'query',
    wave: 1,
    // Deliberately NOT /library/sections/{k}/recentlyAdded: that endpoint does
    // not declare Container-Start/Size, so its response length is uncappable —
    // a real memory risk on a 512MB stick. python-plexapi implements
    // recentlyAdded() as this sort for the same reason.
    query: `type=${t}&sort=addedAt:desc`,
  });

  rows.push({
    id: 'unwatched',
    title: type === 'movie' ? "Haven't Watched" : "Haven't Finished",
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
    title: 'Top Rated',
    kind: 'query',
    wave: 2,
    // The rating bound does the same null-exclusion job as the date bound
    // above: without it, unrated titles can lead under :desc.
    query: `type=${t}&sort=audienceRating:desc&audienceRating${AFTER}=7`,
  });

  if (type === 'movie') {
    rows.push({
      id: 'again',
      title: 'Watch It Again',
      kind: 'query',
      wave: 2,
      // Movie sections only — viewCount on a show container is not meaningful,
      // and Continue Watching already covers in-progress series.
      query: `type=1&sort=lastViewedAt:desc&viewCount${AFTER}=0`,
    });
  }

  // Always last, always present. This is what makes index 0 safe to focus
  // before any network call resolves — without a real row here, an empty rows
  // array traps the D-pad while the first three requests are in flight.
  rows.push({ id: 'browseAll', title: 'Browse all', kind: 'browseAll', wave: 1 });

  return rows;
}

/** Caption lines for a tile. Episodes need their show name and S/E. */
export function tileCaption(it: PlexItem): { line1: string; line2?: string } {
  if (it.type === 'episode') {
    const se = it.parentIndex != null && it.index != null
      ? `S${it.parentIndex} E${it.index}`
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
