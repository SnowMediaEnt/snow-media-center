// What the Plex search screen offers before anything is typed.
//
// Two lists. "Popular searches" is what everyone has been looking for, the
// top twenty across the fleet over the last ninety days, from the
// get_popular_plex_searches RPC. It counts the searches viewers committed
// to (moved down into the results, or opened one) and, from the boxes that
// predate that event, the last query of each typing burst — every keystroke
// runs a search, so the RPC drops "b", "ba", "bat" when "batman" followed.
// "Recent on this box" is this device's own last few.
//
// Both fail soft: no RPC yet, no network, no storage — the screen just shows
// whichever list it has, or the plain "Type to search" line.
import { supabase } from '@/integrations/supabase/client';
import { isAdultLabel } from '@/lib/adultContent';
import { trackEvent } from '@/lib/analytics';

const RECENT_KEY = 'smc:plex-recent-searches';
const RECENT_MAX = 8;
const POPULAR_CACHE_KEY = 'smc:plex-popular-searches';
const POPULAR_TTL_MS = 30 * 60 * 1000;
export const POPULAR_MAX = 20;

const norm = (q: string) => q.trim().replace(/\s+/g, ' ');

export const loadRecentSearches = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && !!x).slice(0, RECENT_MAX) : [];
  } catch { return []; }
};

export const rememberSearch = (query: string): string[] => {
  const q = norm(query);
  if (q.length < 2) return loadRecentSearches();
  const next = [q, ...loadRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
};

export const forgetRecentSearches = (): void => {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
};

/** A search the viewer meant: they went down to the results or opened one.
 *  This is what "Popular searches" counts, and what this box remembers. */
export const commitSearch = (query: string): void => {
  const q = norm(query);
  if (q.length < 2) return;
  rememberSearch(q);
  try { trackEvent('plex_search_commit', 'player', { scope: 'plex', query: q.slice(0, 64) }); } catch { /* ignore */ }
};

/** Popular searches across the fleet, most searched first. Adult terms are
 *  dropped here as well as in the RPC's callers, since the list is shown on
 *  the home-room screen. Cached for half an hour per session. */
export async function fetchPopularSearches(limit = POPULAR_MAX): Promise<string[]> {
  try {
    const raw = sessionStorage.getItem(POPULAR_CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as { at: number; list: string[] };
      if (Date.now() - c.at < POPULAR_TTL_MS && Array.isArray(c.list)) return c.list.slice(0, limit);
    }
  } catch { /* ignore */ }
  let list: string[] = [];
  try {
    const { data, error } = await supabase.rpc('get_popular_plex_searches', { p_limit: limit * 2 });
    if (!error && Array.isArray(data)) {
      const seen = new Set<string>();
      for (const row of data as Array<{ query?: string }>) {
        const q = norm(String(row?.query ?? ''));
        const k = q.toLowerCase();
        if (q.length < 2 || seen.has(k) || isAdultLabel(q)) continue;
        seen.add(k);
        list.push(q);
        if (list.length >= limit) break;
      }
    }
  } catch { list = []; }
  try { sessionStorage.setItem(POPULAR_CACHE_KEY, JSON.stringify({ at: Date.now(), list })); } catch { /* ignore */ }
  return list;
}

/** The popular searches to show, in order, at most `max`. The list is built
 *  from what boxes report, and anyone can report anything, so only searches
 *  that find a title on this server count: `found` is true when one did,
 *  false when nothing matched, undefined while the search is still running
 *  (not shown yet either, so made-up text never flashes up). */
export const popularOnThisServer = (
  labels: string[],
  found: (label: string) => boolean | undefined,
  max: number,
): string[] => {
  const out: string[] = [];
  for (const label of labels) {
    if (out.length >= max) break;
    if (found(label) === true) out.push(label);
  }
  return out;
};

/** Until the fleet has searched enough, the server's most-played titles
 *  stand in, so the row is never empty on a fresh install. */
export const fallbackSuggestions = (titles: Array<string | undefined>, limit = 12): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const q = norm(String(t ?? ''));
    const k = q.toLowerCase();
    if (q.length < 2 || seen.has(k) || isAdultLabel(q)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
};
