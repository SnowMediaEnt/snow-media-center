// What a Kids profile may see (see profiles.ts). Set once when the profile is
// picked; read by the Plex and Live TV data layers, so every screen that lists
// titles or channels gets the same answer without knowing about profiles.
//
//   little   G, TV-Y, TV-G (and the UK/Canada/Australia equivalents)
//   kids     + PG, TV-Y7, TV-PG                                  (the default)
//   teen     + PG-13, TV-14
//
// Plex: a movie or show needs a certificate on the list — an unrated title is
// not shown, since nobody has said it is for children — and never comes from
// an adult library. Live TV: 'little' and 'kids' see only the categories named
// for children (Kids, Family, Cartoons, Disney, Nick …); 'teen' sees
// everything except adult categories and channels.
import type { PlexItem } from '@/lib/plex';
import { isAdultLabel, isAdultPlexItem, isAdultTitle, isFlaggedAdult } from '@/lib/adultContent';

export type KidsLevel = 'little' | 'kids' | 'teen';

export const KIDS_LEVELS: Array<{ id: KidsLevel; label: string; hint: string }> = [
  { id: 'little', label: 'Little kids', hint: 'G and TV-Y / TV-G' },
  { id: 'kids', label: 'Kids', hint: 'Up to PG and TV-PG' },
  { id: 'teen', label: 'Teens', hint: 'Up to PG-13 and TV-14' },
];

// As Plex writes them (country-prefixed ones in lower case, "gb/12A"): the
// library listing asks the server by these exact strings.
const RATINGS: Record<KidsLevel, string[]> = {
  little: ['G', 'TV-Y', 'TV-G', 'U', 'gb/U', 'ca/G', 'au/G', 'nz/G', 'ie/G'],
  kids: ['PG', 'TV-Y7', 'TV-Y7-FV', 'TV-PG', 'gb/PG', 'ca/PG', 'au/PG', 'nz/PG', 'ie/PG'],
  teen: ['PG-13', 'TV-14', 'gb/12', 'gb/12A', 'ca/14A', 'au/M', 'nz/M', 'ie/12A'],
};

let level: KidsLevel | null = null;

/** Set by profiles.ts when a profile is picked; null for a grown-up profile. */
export function setKidsLevel(next: KidsLevel | null): void { level = next; }
export const kidsLevel = (): KidsLevel | null => level;

/** Every certificate the level allows, as Plex writes them. */
export const allowedRatings = (l: KidsLevel): string[] =>
  l === 'little' ? RATINGS.little
    : l === 'kids' ? [...RATINGS.little, ...RATINGS.kids]
      : [...RATINGS.little, ...RATINGS.kids, ...RATINGS.teen];

const norm = (r: string) => r.trim().toUpperCase().replace(/\s+/g, '');

export function ratingAllowed(rating: string | undefined | null, l: KidsLevel | null = level): boolean {
  if (!l) return true;
  if (!rating) return false;
  const r = norm(rating);
  const list = allowedRatings(l).map(norm);
  // "us/PG" and "PG" are the same certificate.
  return list.includes(r) || list.includes(r.replace(/^US\//, ''));
}

/** Whether a Plex title may be shown to the current profile. Seasons,
 *  episodes without their own certificate and anything else that is not a
 *  movie or show pass: they are reached through a show that was checked. */
export function kidsAllowsPlex(it: Pick<PlexItem, 'type' | 'contentRating' | 'title' | 'grandparentTitle' | 'genres'>, l: KidsLevel | null = level): boolean {
  if (!l) return true;
  if (isAdultPlexItem({ title: it.title, grandparentTitle: it.grandparentTitle, contentRating: it.contentRating, genres: it.genres })) return false;
  if (it.type === 'movie' || it.type === 'show') return ratingAllowed(it.contentRating, l);
  if (it.type === 'episode' && it.contentRating) return ratingAllowed(it.contentRating, l);
  return true;
}

/** A Plex library a Kids profile may open. */
export const kidsAllowsLibrary = (title: string, l: KidsLevel | null = level): boolean => !l || !isAdultLabel(title);

/** The Plex filter for a library listing, so paging counts only allowed
 *  titles ('' for a grown-up profile). */
export function kidsRatingQuery(l: KidsLevel | null = level): string {
  if (!l) return '';
  return `contentRating=${allowedRatings(l).map(encodeURIComponent).join(',')}`;
}

const KIDS_CATEGORY = /(^|[^a-z])(kids?|children|childrens|child|family|families|cartoons?|toons?|animation|animated|disney|nick|nickelodeon|nick\s*jr|junior|jr|baby|babies|preschool|boomerang|pbs\s*kids|cbeebies|cbbc|nursery)([^a-z]|$)/i;

/** A name that says kids or family: a Live TV category, a Plex library. */
export const isKidsLabel = (name: unknown): boolean => KIDS_CATEGORY.test(String(name ?? '').replace(/[_|/.-]+/g, ' '));

/** Plex genres made for children. A certificate alone lets through grown-up
 *  shows rated TV-PG and PG; a Kids profile's suggestions also need one of these. */
export const KIDS_GENRE = /^(animation|anime|family|kids|children|children's|childrens|cartoons?)$/i;
export const hasKidsGenre = (genres: string[] | undefined): boolean => (genres ?? []).some((g) => KIDS_GENRE.test(g.trim()));

/** A Live TV category the profile may open. */
export function kidsAllowsCategory(name: unknown, row?: unknown, l: KidsLevel | null = level): boolean {
  if (!l) return true;
  if (isAdultLabel(name) || isFlaggedAdult(row)) return false;
  if (l === 'teen') return true;
  return KIDS_CATEGORY.test(String(name ?? '').replace(/[_|/.-]+/g, ' '));
}

/** A Live TV channel the profile may watch, given the categories it may open
 *  (null when every non-adult category is allowed). */
export function kidsAllowsChannel(stream: { name?: unknown; category_id?: unknown; is_adult?: unknown }, allowedCats: Set<string> | null, l: KidsLevel | null = level): boolean {
  if (!l) return true;
  if (isAdultTitle(stream.name) || isFlaggedAdult(stream)) return false;
  return !allowedCats || allowedCats.has(String(stream.category_id ?? ''));
}
