// Movies › Search and Series › Search: the typed letters against the whole
// catalogue (the section holds it; this is the pure part). As in Live TV's
// search (lib/liveSearch), an adult title never shows, whatever is typed:
// the panel flags it, its category names an adult bucket, or its own name
// leaves no doubt (lib/adultSearch).
import { adultCategoryIds, isAdultHit } from '@/lib/adultSearch';

/** How many results the grid shows at most. */
export const VOD_SEARCH_LIMIT = 500;

/** The titles whose name holds the typed letters, in catalogue order, adult
 *  ones left out. `categories`: the section's category list. */
export function searchVodTitles<T extends { name: string; category_id?: unknown }>(
  query: string,
  list: readonly T[] | null | undefined,
  categories: ReadonlyArray<{ category_id?: unknown; category_name?: unknown }> | null | undefined,
  limit: number = VOD_SEARCH_LIMIT,
): T[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q || !list?.length) return [];
  const adultCats = adultCategoryIds(categories);
  const out: T[] = [];
  for (const m of list) {
    if (!String(m?.name ?? '').toLowerCase().includes(q)) continue;
    if (isAdultHit({ name: m.name, categoryId: m.category_id, row: m }, adultCats)) continue;
    out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}
