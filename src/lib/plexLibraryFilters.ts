// Sort + filter state for a Plex library, and the query string it produces.
//
// Kept as a pure module so the awkward parts are in one place and readable.
// The awkward parts are real: Plex silently ignores query params it does not
// recognise, so a wrong key does not error — it returns the whole unfiltered
// library while looking like it worked. Every branch below exists because the
// naive version is wrong on one of the two section types.

import type { PlexSectionType } from '@/lib/plexLibraryRows';

export interface LibraryFilterState {
  /** Plex sort key, e.g. 'titleSort', 'addedAt:desc'. Empty = server default. */
  sort: string;
  /** Genre tag id from the section's own vocabulary. */
  genre?: { key: string; title: string };
  /** Decade or year, as Plex's `decade`/`year` filter expects. */
  year?: { key: string; title: string };
  /** Content rating, e.g. 'PG-13'. */
  contentRating?: { key: string; title: string };
  /** Unwatched only. */
  unwatched: boolean;
}

export const EMPTY_FILTERS: LibraryFilterState = { sort: '', unwatched: false };

export function hasAnyFilter(f: LibraryFilterState): boolean {
  return !!(f.sort || f.genre || f.year || f.contentRating || f.unwatched);
}

/** Human summary for the "showing…" line. */
export function describeFilters(f: LibraryFilterState, sortTitle?: string): string {
  const bits: string[] = [];
  if (f.genre) bits.push(f.genre.title);
  if (f.year) bits.push(f.year.title);
  if (f.contentRating) bits.push(f.contentRating.title);
  if (f.unwatched) bits.push('Unwatched');
  if (sortTitle) bits.push(`by ${sortTitle}`);
  return bits.join(' · ');
}

/**
 * Build the query string (no leading `?`) for /library/sections/{k}/all.
 *
 * `type` is mandatory and is the reason the two section types diverge: on a
 * SHOW section an unprefixed field name resolves to the SHOW's field, not the
 * episode's, and several filters do not exist at the show level at all.
 */
export function buildLibraryQuery(
  sectionType: PlexSectionType,
  f: LibraryFilterState,
): string {
  const parts: string[] = [];
  parts.push(`type=${sectionType === 'movie' ? 1 : 2}`);

  if (f.sort) parts.push(`sort=${encodeURIComponent(f.sort)}`);

  // Genre, year/decade and content rating are tag ids from the section's own
  // vocabulary (Meta.Type[].Filter[]), so they are already the right shape for
  // whichever section they came from — no branching needed.
  if (f.genre) parts.push(`genre=${encodeURIComponent(f.genre.key)}`);
  if (f.year) parts.push(`${yearParam(f.year.key)}`);
  if (f.contentRating) parts.push(`contentRating=${encodeURIComponent(f.contentRating.key)}`);

  if (f.unwatched) {
    // `unwatched` does NOT exist for the show libtype. The show-level field is
    // `unwatchedLeaves`. Sending `unwatched` to a TV section falls back to
    // `episode.unwatched`, which matches any show with a single unplayed
    // episode — i.e. almost the entire library, which makes the filter look
    // broken rather than absent.
    parts.push(sectionType === 'movie' ? 'unwatched=1' : 'unwatchedLeaves=1');
  }

  return parts.join('&');
}

/**
 * The year filter's values come back as either plain years ("1994") or decade
 * buckets ("1990"), depending on which filter the section advertises. Plex
 * accepts `year=` for both; `decade=` only for the decade filter. Using
 * `year=` uniformly is the safe choice — a decade bucket key IS a year value
 * Plex understands.
 */
function yearParam(key: string): string {
  return `year=${encodeURIComponent(key)}`;
}

/**
 * Sort options worth offering, in the order a person would want them.
 * Filtered against what the SERVER says it supports, so an unusual library
 * never gets an option that silently does nothing.
 */
export const PREFERRED_SORTS: Array<{ key: string; title: string }> = [
  { key: 'titleSort', title: 'A – Z' },
  { key: 'titleSort:desc', title: 'Z – A' },
  { key: 'addedAt:desc', title: 'Recently Added' },
  { key: 'originallyAvailableAt:desc', title: 'Release Date' },
  { key: 'year:desc', title: 'Year (newest)' },
  { key: 'year', title: 'Year (oldest)' },
  { key: 'audienceRating:desc', title: 'Rating (highest)' },
  { key: 'lastViewedAt:desc', title: 'Recently Watched' },
];

/** Keep only the sorts this section actually advertises. */
export function availableSorts(
  serverSorts: Array<{ key: string; title: string }>,
): Array<{ key: string; title: string }> {
  if (!serverSorts.length) return PREFERRED_SORTS;
  const supported = new Set(serverSorts.map((s) => s.key));
  const out = PREFERRED_SORTS.filter((s) => supported.has(s.key.split(':')[0]));
  return out.length ? out : PREFERRED_SORTS;
}

/** Find a filter by its Plex `filter` name, tolerating libtype prefixes. */
export function findFilter<T extends { filter: string }>(
  filters: T[],
  name: string,
): T | undefined {
  // On non-movie sections the keys are libtype-prefixed ('show.genre'), so a
  // bare === comparison silently finds nothing and the chip never appears.
  return filters.find((f) => f.filter === name || f.filter.endsWith(`.${name}`));
}
