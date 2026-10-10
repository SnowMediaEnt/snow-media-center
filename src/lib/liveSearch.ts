// Live TV › Search: the typed letters against every signed-in line's whole
// line-up (LiveSection holds the lists; this is the pure part).
//
// - A channel in a category hidden in Settings › Hide Categories is not
//   found either: hidden means out of sight, search included.
// - Never an adult channel, whatever is typed (lib/adultSearch): typing "nc"
//   brought up channels from the adult categories.
// - Best first: names that START with the letters, then names with a word
//   starting with them ("US | NC News"), then the letters anywhere inside a
//   word. Each group keeps the line-up's order. Typing "NC" put whatever had
//   "nc" inside a word ahead of the channels named NC.
import type { XtreamLiveStream } from '@/lib/xtream';
import { isAdultHit } from '@/lib/adultSearch';

/** One line's line-up, with what it keeps out of search. */
export interface LiveSearchLine {
  list: readonly XtreamLiveStream[];
  /** Category ids hidden in Hide Categories. */
  hidden?: ReadonlySet<string> | null;
  /** Category ids that are adult (adultSearch.adultCategoryIds). */
  adultCats?: ReadonlySet<string> | null;
}

/** A channel search never shows (a hidden category's, an adult one), for
 *  the search box and for a channel asked for by name (a voice command or
 *  the assistant: a search by voice). */
export function leftOutOfSearch(
  s: XtreamLiveStream,
  line: Pick<LiveSearchLine, 'hidden' | 'adultCats'>,
): boolean {
  const cat = s.category_id != null ? String(s.category_id) : '';
  if (cat && line.hidden?.has(cat)) return true;
  return isAdultHit({ name: s.name, categoryId: cat || undefined, row: s }, line.adultCats);
}

/** How many results the list shows at most. */
export const LIVE_SEARCH_LIMIT = 500;

/** A letter or digit right before the match: it starts inside a word. */
const insideWord = (c: string): boolean => /[a-z0-9]/.test(c) || c.toLowerCase() !== c.toUpperCase();

/** The channels that fit the typed letters, best first (see the top). */
export function searchLiveChannels(
  query: string,
  lines: readonly LiveSearchLine[],
  limit: number = LIVE_SEARCH_LIMIT,
): XtreamLiveStream[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || limit <= 0) return [];
  // 0: the name starts with it, 1: a word starts with it, 2: inside a word.
  const tiers: XtreamLiveStream[][] = [[], [], []];
  for (const line of lines) {
    for (const s of line.list) {
      // Nothing can beat a full first group.
      if (tiers[0].length >= limit) break;
      const name = String(s?.name ?? '').toLowerCase();
      const at = name.indexOf(q);
      if (at < 0) continue;
      const tier = at === 0 ? 0 : insideWord(name.charAt(at - 1)) ? 2 : 1;
      if (tiers[tier].length >= limit) continue;
      if (leftOutOfSearch(s, line)) continue;
      tiers[tier].push(s);
    }
  }
  return tiers[0].concat(tiers[1], tiers[2]).slice(0, limit);
}
