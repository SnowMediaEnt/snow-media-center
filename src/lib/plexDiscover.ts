// Row definitions for the Plex Discover screen.
//
// Discover is the browsing screen: rows that surface titles the viewer has
// not looked for, the way the Plex app's own home does. Every row is served
// by the server with the query syntax verified for the library rows (see
// plexLibraryRows.ts for why each bound is load-bearing), and stitched across
// every visible library so a two-library server reads as one catalogue.
//
// Plex's cloud "Discover" (trending across streaming services) is deliberately
// not here: it needs the viewer's own plex.tv account and lists mostly things
// the server does not have.

import { getPlexFilterValues, getPlexRelated, getPlexSectionRow, type PlexItem, type PlexLibrary } from '@/lib/plex';
import { currentViewer, loadWatchHistory } from '@/lib/watchHistory';

/** `>>` is Plex's "greater than", URL-encoded. */
const AFTER = '%3E%3E';

export interface DiscoverRow {
  id: string;
  title: string;
  items: PlexItem[];
}

export const DISCOVER_RAIL_CAP = 40;
/** Per-library take for a stitched row: enough that a two-library server
 *  still fills the rail after dedupe, small enough for a stick. */
const PER_SECTION = 20;

const typeNum = (l: PlexLibrary) => (l.type === 'movie' ? 1 : 2);

/** Merge per-section results, drop duplicates, cap. */
export const mergeRail = (lists: Array<PlexItem[] | null>, cap = DISCOVER_RAIL_CAP): PlexItem[] => {
  const seen = new Set<string>();
  const out: PlexItem[] = [];
  for (const list of lists) {
    for (const it of list ?? []) {
      const id = String(it.ratingKey ?? `${it.title}:${it.year ?? ''}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(it);
    }
  }
  return out.slice(0, cap);
};

/** Interleave lists so a two-library server does not show all of one then
 *  all of the other on a random row. */
const interleave = (lists: Array<PlexItem[] | null>): PlexItem[] => {
  const out: PlexItem[] = [];
  const max = Math.max(0, ...lists.map((l) => l?.length ?? 0));
  for (let i = 0; i < max; i++) for (const l of lists) if (l?.[i]) out.push(l[i]);
  return mergeRail([out]);
};

const sections = (libraries: PlexLibrary[]) =>
  libraries.filter((l) => l.type === 'movie' || l.type === 'show');

// Two sections at a time, like Home's stitched rails. Wave 1 runs three of
// these side by side, and with every section at once that was eleven
// requests on a four-library server the moment Discover opened.
const ACROSS_PARALLEL = 2;
const fetchAcross = async (
  base: string, token: string, libs: PlexLibrary[], query: (l: PlexLibrary) => string | null,
): Promise<PlexItem[]> => {
  const lists: Array<PlexItem[] | null> = new Array(libs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < libs.length) {
      const i = next++;
      const q = query(libs[i]);
      lists[i] = q ? await getPlexSectionRow(base, token, libs[i].key, q, PER_SECTION).catch(() => null) : null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(ACROSS_PARALLEL, libs.length) }, worker));
  return interleave(lists);
};

// ── Wave 1: the rows that need no lookups first ─────────────────────────

/**
 * Titles like the last thing this viewer played on Plex. Plex's related hub
 * (Similar, Same director …) for that title, flattened. Nothing to show
 * until something has been watched.
 */
export async function becauseYouWatched(base: string, token: string): Promise<{ title: string; items: PlexItem[] } | null> {
  const viewer = await currentViewer();
  const last = loadWatchHistory(viewer).find((e) => e.kind === 'plex' && e.plex?.ratingKey);
  if (!last?.plex) return null;
  const items = await getPlexRelated(base, token, last.plex.ratingKey, DISCOVER_RAIL_CAP).catch(() => []);
  if (!items.length) return null;
  // An episode's history entry carries the show as its title, which is the
  // name that reads right here.
  return { title: `Because you watched ${last.title}`, items };
}

/** Well rated and never played here. The rating bound keeps unrated titles
 *  out; unwatched is a movie-only field, shows use unwatchedLeaves. */
export const hiddenGems = (base: string, token: string, libraries: PlexLibrary[]) =>
  fetchAcross(base, token, sections(libraries), (l) =>
    l.type === 'movie'
      ? `type=1&unwatched=1&audienceRating${AFTER}=7&sort=random`
      : `type=2&unwatchedLeaves=1&audienceRating${AFTER}=7&sort=random`);

/** A random handful from everything. */
export const surpriseMe = (base: string, token: string, libraries: PlexLibrary[]) =>
  fetchAcross(base, token, sections(libraries), (l) => `type=${typeNum(l)}&sort=random`);

/** Movies watched longest ago — the viewCount bound is what makes the sort
 *  mean "watched", not "never watched". Movies only: viewCount on a show
 *  container is not meaningful. */
export const rediscover = (base: string, token: string, libraries: PlexLibrary[]) =>
  fetchAcross(base, token, libraries.filter((l) => l.type === 'movie'), () =>
    `type=1&sort=lastViewedAt:asc&viewCount${AFTER}=0`);

// ── Wave 2: genres and decades ──────────────────────────────────────────

/** The genres worth a row of their own, in the order they should appear.
 *  Plex's own list is alphabetical, which put Adventure and Animation first
 *  on every server. Matched case-insensitively against what the server has. */
const GENRE_ORDER = [
  'Action', 'Comedy', 'Horror', 'Thriller', 'Family', 'Animation', 'Drama',
  'Science Fiction', 'Sci-Fi', 'Documentary', 'Romance', 'Crime', 'Adventure', 'Fantasy',
];
const GENRE_ROWS_MAX = 6;

/** Genres present on the server's libraries, keyed per section, in rail order. */
export async function pickGenres(base: string, token: string, libraries: PlexLibrary[]) {
  const libs = sections(libraries);
  const perLib = await Promise.all(libs.map((l) =>
    getPlexFilterValues(base, token, `/library/sections/${l.key}/genre`).catch(() => [])));
  // title (lowercased) -> section key -> genre key
  const byTitle = new Map<string, { title: string; keys: Map<string, string> }>();
  libs.forEach((l, i) => {
    for (const g of perLib[i]) {
      const k = g.title.trim().toLowerCase();
      const row = byTitle.get(k) ?? { title: g.title.trim(), keys: new Map<string, string>() };
      row.keys.set(l.key, g.key);
      byTitle.set(k, row);
    }
  });
  const out: Array<{ title: string; keys: Map<string, string> }> = [];
  const taken = new Set<string>();
  for (const want of GENRE_ORDER) {
    const hit = byTitle.get(want.toLowerCase());
    if (!hit || taken.has(hit.title.toLowerCase())) continue;
    taken.add(hit.title.toLowerCase());
    out.push(hit);
    if (out.length >= GENRE_ROWS_MAX) break;
  }
  return out;
}

export const genreRow = (base: string, token: string, libraries: PlexLibrary[], keys: Map<string, string>) =>
  fetchAcross(base, token, sections(libraries), (l) => {
    const k = keys.get(l.key);
    return k ? `type=${typeNum(l)}&genre=${encodeURIComponent(k)}&sort=random` : null;
  });

/** Decades, newest first, movies only. `>=` and `<=` are Plex's inclusive
 *  bounds (python-plexapi __gte / __lte). The rows for decades the server
 *  has nothing from come back empty and are dropped. */
export const DECADES = [2010, 2000, 1990, 1980, 1970] as const;
export const decadeTitle = (d: number) => (d >= 2000 ? `${d}s Movies` : `'${String(d).slice(2)}s Movies`);
export const decadeRow = (base: string, token: string, libraries: PlexLibrary[], decade: number) =>
  fetchAcross(base, token, libraries.filter((l) => l.type === 'movie'), () =>
    `type=1&year>=${decade}&year<=${decade + 9}&sort=random`);
