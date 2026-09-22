// Keeps adult material off the content bar.
//
// The bar is the first thing on the home screen, in front of whoever is in
// the room, so it must never show an adult channel or an adult Plex title,
// whatever the viewer watched or has in their libraries. Nothing here hides
// anything inside the Player itself; that is the Hide Categories screen's job.
//
// Two strengths of test, because the same word means different things in
// different places:
//   - a LABEL (a Live TV category, a Plex library, a genre, a certificate)
//     is a curator's word for the whole bucket, so a broad list is safe:
//     "Adult", "XXX", "18+", "For Adults", "Sex" all mean one thing there.
//   - a TITLE (a channel name, a movie) needs the unmistakable words only.
//     "Sex and the City" and "Sex Education" are prime-time television, and
//     "Adult Swim" is cartoons.
//
// The edge function that builds the shared Plex rows carries the same rules
// in supabase/functions/_shared/adultContent.ts; keep the two together.

const LABEL_WORDS = [
  'adult', 'adults', 'xxx', 'porn', 'porno', 'pornstar', 'sex', 'sexy', 'erotic', 'erotica',
  'hentai', 'nsfw', 'brazzers', 'playboy', 'hustler', 'penthouse', 'vivid', 'onlyfans',
  'only fans', 'x-rated', 'rated x', 'for adults', 'adults only', 'mature',
];
const TITLE_WORDS = [
  'xxx', 'porn', 'porno', 'pornstar', 'hentai', 'nsfw', 'brazzers', 'playboy', 'hustler',
  'penthouse', 'onlyfans', 'only fans', 'x-rated', 'adults only', 'for adults', 'erotic',
  'erotica',
];
/** "18+", "+18", "(18)", "18 +" — an age gate written any of the usual ways. */
const AGE_GATE = /(^|[^0-9])(18|21)\s*\+|\+\s*(18|21)([^0-9]|$)|\((18|21)\)/;
/** Only ever means the cartoon block. */
const ADULT_SWIM = /\badult\s*swim\b/i;

/** Punctuation that providers use as a separator ("US|XXX", "x-rated",
 *  "adults_only") becomes a space, on the input and on the word list alike. */
const clean = (s: unknown): string => String(s ?? '').replace(/[_\-./|]+/g, ' ').trim();
const escape = (w: string) => clean(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
const wordList = (words: string[]) => new RegExp(`(^|[^a-z0-9])(${words.map(escape).join('|')})([^a-z0-9]|$)`, 'i');

const LABEL_RE = wordList(LABEL_WORDS);
const TITLE_RE = wordList(TITLE_WORDS);

/** A category, library, genre or certificate that names an adult bucket. */
export const isAdultLabel = (label: unknown): boolean => {
  const s = clean(label);
  if (!s) return false;
  if (ADULT_SWIM.test(s) && !/\b(xxx|porn)\b/i.test(s)) return false;
  return LABEL_RE.test(s) || AGE_GATE.test(s);
};

/** A channel or title whose own name leaves no doubt. */
export const isAdultTitle = (title: unknown): boolean => {
  const s = clean(title);
  if (!s) return false;
  if (ADULT_SWIM.test(s)) return false;
  if (TITLE_RE.test(s) || AGE_GATE.test(s)) return true;
  // "Adult" on its own in a channel name ("ADULT 1", "Adult Movies HD") —
  // channels are named by the provider, not by a studio, so the plain word
  // is decisive there in a way it is not for a film called "Adult Life Skills".
  return /(^|[^a-z0-9])adult(s)?([^a-z0-9]|$)/i.test(s) && !/\b(life|education|world|learning)\b/i.test(s);
};

/** Plex certificates that mean pornography, not merely "grown-up". "R" and
 *  "TV-MA" stay: they are most of a normal library. */
const ADULT_RATINGS = new Set(['xxx', 'x', 'x18', 'r18', '18+', 'adult', 'nc17-adult']);
export const isAdultRating = (rating: unknown): boolean => {
  const s = String(rating ?? '').trim().toLowerCase().replace(/^[a-z]{2}\//, ''); // "us/XXX"
  return !!s && (ADULT_RATINGS.has(s) || isAdultLabel(s));
};

/** Some Xtream panels flag streams and categories with is_adult "1". */
export const isFlaggedAdult = (row: unknown): boolean => {
  const v = (row as Record<string, unknown> | null | undefined)?.is_adult;
  return v === 1 || v === true || v === '1' || v === 'true';
};

export interface LiveAdultCheck {
  name?: unknown;
  categoryName?: unknown;
  /** The raw stream or category row, for the is_adult flag. */
  row?: unknown;
}

/** A Live TV channel is adult when its category is, its panel flags it, or
 *  its own name says so. */
export const isAdultChannel = (c: LiveAdultCheck): boolean =>
  isFlaggedAdult(c.row) || isAdultLabel(c.categoryName) || isAdultTitle(c.name);

export interface PlexAdultCheck {
  title?: unknown;
  /** The show a "continue watching" episode belongs to. */
  grandparentTitle?: unknown;
  libraryTitle?: unknown;
  contentRating?: unknown;
  genres?: unknown;
}

/** A Plex title is adult when its library is, a genre or certificate says
 *  so, or its name does. */
export const isAdultPlexItem = (p: PlexAdultCheck): boolean => {
  if (isAdultLabel(p.libraryTitle)) return true;
  if (isAdultRating(p.contentRating)) return true;
  const genres = Array.isArray(p.genres) ? p.genres : [];
  if (genres.some((g) => isAdultLabel(g))) return true;
  return isAdultTitle(p.title) || isAdultTitle(p.grandparentTitle);
};
