// Studio groups for a Plex library's "Studios" row (owner, 2026-10-29: "a
// studio row in Plex … like disney studios, A24, fox, WB, universal … but i
// need specifically Angel Studios as well").
//
// A server's studio list is raw and noisy: "Walt Disney Pictures", "Walt
// Disney Animation Studios", "Disney+" and "Disney Channel" are four entries.
// Each tile is a GROUP of those raw names, and its filter value is all of the
// group's raw keys joined by commas — Plex reads a comma-separated filter
// value as OR. Studios that match no group are not shown.
//
// Matching is by name, case-insensitively: a raw name belongs to a group when
// it IS one of the group's names, or starts with one followed by something
// that is not a letter or digit ("Marvel Studios LLC", "Disney+",
// "Warner Bros. Pictures"). The word boundary is what keeps "Foxtail Films"
// out of Fox and "Applecart" out of Apple.
//
// Names only — no logos or brand artwork anywhere.

export interface StudioGroup {
  /** Stable id, e.g. 'angel'. */
  id: string;
  /** What the tile says. */
  name: string;
  /** The `studio=` value: the matched raw keys, comma-joined (OR). */
  value: string;
  /** The server's raw studio titles this group matched. */
  matched: string[];
}

interface GroupDef { id: string; name: string; names: string[] }

/** The table, in display order. Angel Studios leads (the owner's ask);
 *  groupStudios also forces it first, so a reorder here cannot demote it. */
export const STUDIO_TABLE: GroupDef[] = [
  { id: 'angel', name: 'Angel Studios', names: ['angel studios', 'angel films', 'vidangel', 'angel studios distribution'] },
  { id: 'disney', name: 'Disney', names: [
    'walt disney', 'disney', 'disney+', 'touchstone pictures', 'hollywood pictures',
  ] },
  { id: 'pixar', name: 'Pixar', names: ['pixar'] },
  { id: 'marvel', name: 'Marvel', names: ['marvel'] },
  { id: 'lucasfilm', name: 'Lucasfilm', names: ['lucasfilm'] },
  { id: 'a24', name: 'A24', names: ['a24'] },
  { id: 'fox', name: '20th Century / Fox', names: [
    '20th century', 'twentieth century', 'fox', 'searchlight pictures',
  ] },
  { id: 'warner', name: 'Warner Bros.', names: ['warner bros', 'warner brothers', 'new line'] },
  { id: 'hbo', name: 'HBO', names: ['hbo'] },
  { id: 'universal', name: 'Universal', names: ['universal', 'focus features', 'illumination'] },
  { id: 'paramount', name: 'Paramount', names: ['paramount'] },
  { id: 'sony', name: 'Sony / Columbia', names: [
    'sony pictures', 'sony', 'columbia pictures', 'tristar', 'tri-star', 'screen gems',
  ] },
  { id: 'lionsgate', name: 'Lionsgate', names: ['lionsgate', 'lions gate', 'summit entertainment'] },
  { id: 'dreamworks', name: 'DreamWorks', names: ['dreamworks'] },
  { id: 'blumhouse', name: 'Blumhouse', names: ['blumhouse'] },
  { id: 'netflix', name: 'Netflix', names: ['netflix'] },
  { id: 'amazon', name: 'Amazon / MGM', names: ['amazon', 'mgm', 'metro-goldwyn-mayer', 'prime video'] },
  { id: 'apple', name: 'Apple', names: ['apple tv', 'apple original', 'apple studios'] },
  { id: 'ghibli', name: 'Studio Ghibli', names: ['studio ghibli'] },
  { id: 'neon', name: 'Neon', names: ['neon'] },
  { id: 'legendary', name: 'Legendary', names: ['legendary pictures', 'legendary entertainment'] },
  { id: 'miramax', name: 'Miramax', names: ['miramax'] },
];

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const isWordChar = (c: string): boolean => /[a-z0-9]/.test(c);

/** True when the raw studio name belongs under `alias` (both normalised). */
export function studioMatches(raw: string, alias: string): boolean {
  const n = norm(raw);
  const a = norm(alias);
  if (!a || !n.startsWith(a)) return false;
  if (n.length === a.length) return true;
  // The alias must end on a word boundary in the raw name.
  return !isWordChar(n[a.length]) || !isWordChar(a[a.length - 1]);
}

/** Which group a raw studio name belongs to, if any. */
export function studioGroupId(raw: string): string | undefined {
  return STUDIO_TABLE.find((g) => g.names.some((a) => studioMatches(raw, a)))?.id;
}

/**
 * The server's studio values ({key, title} from the section's studio filter)
 * folded into groups. Only groups with at least one match; Angel Studios
 * first when present, the rest in table order. A raw key is used once.
 */
export function groupStudios(values: Array<{ key: string; title: string }>): StudioGroup[] {
  const byId = new Map<string, { keys: string[]; titles: string[] }>();
  const seen = new Set<string>();
  for (const v of values) {
    if (!v || !v.key || seen.has(v.key)) continue;
    const id = studioGroupId(v.title || v.key);
    if (!id) continue;
    seen.add(v.key);
    const g = byId.get(id) ?? { keys: [], titles: [] };
    g.keys.push(v.key);
    g.titles.push(v.title);
    byId.set(id, g);
  }
  const out: StudioGroup[] = [];
  for (const def of STUDIO_TABLE) {
    const g = byId.get(def.id);
    if (!g) continue;
    out.push({ id: def.id, name: def.name, value: g.keys.join(','), matched: g.titles });
  }
  // Angel Studios first whenever it is there (owner's explicit ask).
  const ai = out.findIndex((g) => g.id === 'angel');
  if (ai > 0) out.unshift(out.splice(ai, 1)[0]);
  return out;
}
