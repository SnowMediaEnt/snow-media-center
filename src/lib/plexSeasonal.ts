// Seasonal collections in Plex. Each season has a window (month/day, local
// time) and a hand-picked list of titles grouped into rows (see
// src/data/seasons). While it is in season a menu entry appears at the top of
// the libraries. Every title is looked up on the viewer's own server by name
// and year; a row shows only what the server has, in the list's order.
//
// Adding the next holiday is a new SEASONS entry with its own list.
import type { PlexItem, PlexLibrary } from '@/lib/plex';
import { searchPlex } from '@/lib/plex';
import { HALLOWEEN_ROWS, type CuratedRow, type CuratedTitle } from '@/data/seasons/halloween';

export interface SeasonRowDef { id: string; title: string }
export interface Season {
  id: 'halloween';
  title: string;
  /** Inclusive window, [month 1-12, day]. */
  from: [number, number];
  to: [number, number];
  rows: CuratedRow[];
}

export const SEASONS: Season[] = [
  {
    id: 'halloween',
    title: 'Halloween',
    // Spooky season: from late September through the weekend after.
    from: [9, 20],
    to: [11, 2],
    rows: HALLOWEEN_ROWS,
  },
];

/** The season on right now, or null. */
export function activeSeason(now: Date = new Date()): Season | null {
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  for (const s of SEASONS) {
    const a = s.from[0] * 100 + s.from[1];
    const b = s.to[0] * 100 + s.to[1];
    if (a <= b ? md >= a && md <= b : md >= a || md <= b) return s;
  }
  return null;
}

/** Title as a comparison key: case, accents, punctuation, "&"/"and" and a
 *  leading article don't matter ("The Addams Family" = "Addams Family"). */
export function normTitle(t: string): string {
  return t
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^\s*(the|a|an)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this server item stand for that list entry? Same name, same kind,
 *  year within one (release dates differ by country). */
export function matches(it: PlexItem, want: CuratedTitle): boolean {
  if ((it.type === 'show') !== !!want.s) return false;
  if (normTitle(it.title) !== normTitle(want.t)) return false;
  return !it.year || Math.abs(it.year - want.y) <= 1;
}

/** Parallel title lookups. Small: every one is a search on the server. */
const LOOKUP_PARALLEL = 4;

/**
 * Finds a season's titles on the server, row by row, handing each row to
 * `land` as soon as it is complete. One search per distinct title, and none
 * for a title an earlier search already turned up ("Halloween" finds the
 * sequels too). Titles from libraries the viewer cannot see are skipped.
 */
export async function loadSeasonRows(
  base: string,
  token: string,
  libraries: PlexLibrary[],
  season: Season,
  land: (row: SeasonRowDef, items: PlexItem[]) => void,
  stop: () => boolean,
  skip: (id: string) => boolean = () => false,
  search: (q: string) => Promise<PlexItem[]> = (q) => searchPlex(base, token, q),
): Promise<void> {
  const visible = new Set(libraries.map((l) => String(l.key)));
  const seen: PlexItem[] = [];
  const searched = new Set<string>();
  const find = (w: CuratedTitle) => seen.find((it) => matches(it, w)) ?? null;

  for (const row of season.rows) {
    if (stop()) return;
    if (skip(row.id)) continue;
    const todo = row.items.filter((w) => !find(w) && !searched.has(normTitle(w.t)));
    // Sequels wait for their first film's search, which usually finds them.
    const names = todo.map((w) => normTitle(w.t));
    const isSequel = (n: string) => names.some((m) => m !== n && n.startsWith(`${m} `));
    for (const pass of [todo.filter((w) => !isSequel(normTitle(w.t))), todo.filter((w) => isSequel(normTitle(w.t)))]) {
      let next = 0;
      const worker = async () => {
        while (next < pass.length && !stop()) {
          const w = pass[next++];
          const q = normTitle(w.t);
          if (searched.has(q) || find(w)) continue;
          searched.add(q);
          const got = await search(w.t).catch(() => [] as PlexItem[]);
          for (const it of got) {
            if (it.librarySectionID && !visible.has(String(it.librarySectionID))) continue;
            seen.push(it);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(LOOKUP_PARALLEL, pass.length) }, worker));
    }
    if (stop()) return;
    const out: PlexItem[] = [];
    const ids = new Set<string>();
    for (const w of row.items) {
      const it = find(w);
      if (it && !ids.has(it.ratingKey)) { ids.add(it.ratingKey); out.push(it); }
    }
    land({ id: row.id, title: row.title }, out);
  }
}

// ── Kept across launches ────────────────────────────────────────────────
// Finding a season's titles is a few hundred searches, so the answer is kept
// for half a day per server and library set. Cleared on Plex sign-out.
const STORE = 'smc-season-v1:';
export const SEASON_TTL_MS = 12 * 3600_000;
interface Stored { base: string; libs: string; ts: number; rows: Record<string, PlexItem[]> }

export function loadStoredSeason(seasonId: string, base: string, libs: string, now = Date.now()): Record<string, PlexItem[]> {
  try {
    const d = JSON.parse(localStorage.getItem(STORE + seasonId) || 'null') as Stored | null;
    if (!d || d.base !== base || d.libs !== libs || now - d.ts >= SEASON_TTL_MS) return {};
    return d.rows || {};
  } catch {
    return {};
  }
}

export function storeSeasonRow(seasonId: string, base: string, libs: string, rowId: string, items: PlexItem[]): void {
  try {
    const cur = JSON.parse(localStorage.getItem(STORE + seasonId) || 'null') as Stored | null;
    const d: Stored = cur && cur.base === base && cur.libs === libs && Date.now() - cur.ts < SEASON_TTL_MS
      ? cur : { base, libs, ts: Date.now(), rows: {} };
    // Just what a poster tile needs.
    d.rows[rowId] = items.map((it) => ({
      ratingKey: it.ratingKey, title: it.title, type: it.type, thumb: it.thumb, art: it.art, year: it.year,
      librarySectionID: it.librarySectionID, rating: it.rating, contentRating: it.contentRating,
      genres: it.genres, duration: it.duration, videoResolution: it.videoResolution,
    }));
    localStorage.setItem(STORE + seasonId, JSON.stringify(d));
  } catch { /* storage full or unavailable: the rows reload next time */ }
}
