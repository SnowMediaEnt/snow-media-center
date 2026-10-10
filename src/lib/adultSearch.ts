// Search never puts an adult channel or title on screen. Live TV's search runs
// over every line's whole line-up and Movies / Series search over the whole
// catalogue, so a couple of letters ("nc") matched inside names from the
// adult categories too.
//
// The same tests as the content bar's (lib/adultContent): a hit is adult when
// the panel flags it (is_adult), its category names an adult bucket, or its
// own name leaves no doubt. Search NEVER shows such a hit, whatever is typed,
// "adult", "xxx" or "18+" included: viewers who want it browse the categories
// directly (unless they are hidden). The adult categories stay where they are
// in the category lists: this is about search only.
import { isAdultLabel, isAdultTitle, isFlaggedAdult } from '@/lib/adultContent';

/** The ids of a line's categories that name an adult bucket or that its
 *  panel flags (is_adult). */
export function adultCategoryIds(
  cats: ReadonlyArray<{ category_id?: unknown; category_name?: unknown }> | null | undefined,
): Set<string> {
  const out = new Set<string>();
  for (const c of cats ?? []) {
    if (c == null || c.category_id == null) continue;
    if (isAdultLabel(c.category_name) || isFlaggedAdult(c)) out.add(String(c.category_id));
  }
  return out;
}

/** A search hit that never shows (see the top). */
export function isAdultHit(
  hit: { name?: unknown; categoryId?: unknown; row?: unknown },
  adultCats?: ReadonlySet<string> | null,
): boolean {
  if (isFlaggedAdult(hit.row)) return true;
  if (adultCats && hit.categoryId != null && adultCats.has(String(hit.categoryId))) return true;
  return isAdultTitle(hit.name);
}
