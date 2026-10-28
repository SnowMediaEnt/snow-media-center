// A film's page: "More in this series" (the other films sharing its title's
// stem — part 2, part 3, the first one) and "More like this" (its own
// category). Owner, 2026-10-27: open a film and go straight to its sequel
// instead of backing out and hunting for it.
//
// Everything here is on the box and pure: it reads movie lists the section
// already holds (or fetched once). It never asks the panel about another film
// (a burst of per-film calls gets the box's address banned).

type Named = { name: string; stream_id: number; stream_icon?: string; year?: string; category_id?: string };

const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ROMAN_RE = 'ii|iii|iv|v|vi|vii|viii|ix|x';
const WORD_RE = Object.keys(WORDS).join('|');

// A stem this generic matches unrelated films: no series row for it.
const COMMON = new Set([
  'the', 'love', 'home', 'life', 'war', 'man', 'men', 'woman', 'women', 'girl', 'girls', 'boy', 'boys', 'baby',
  'mother', 'father', 'family', 'friends', 'night', 'day', 'time', 'world', 'money', 'house', 'game', 'dream',
  'heart', 'story', 'movie', 'film', 'kids', 'christmas', 'alone', 'fear', 'hope', 'lost', 'gone', 'run',
  'escape', 'revenge', 'vengeance', 'dead', 'evil', 'blood', 'killer', 'monster', 'paradise', 'summer',
  'winter', 'spring', 'autumn', 'dark', 'light', 'black', 'white', 'red', 'blue', 'green', 'gold', 'secret',
  'secrets', 'truth', 'school', 'party', 'wedding', 'holiday', 'vacation', 'city', 'island', 'road',
]);

// Provider decoration, removed before anything else is read.
const QUALITY = /\b(?:4k|8k|uhd|fhd|hd|sd|1080p|720p|480p|2160p|hdr10\+?|hdr|dv|hevc|x26[45]|h26[45]|multi|multisub|vostfr|subbed|dubbed)\b/gi;
const LANG_PREFIX = /^\s*[A-Z]{2,3}\s*[-|:]\s*(?=\S)/; // "EN - ", "FR|", "DE:"
const TAG_PREFIX = /^\s*(?:4k|8k|uhd|fhd|hd|sd|multi|vod|vip)\s*[-|:]\s*(?=\S)/i; // "4K-", "UHD | "
const PIPE_PREFIX = /^\s*\|[^|]{1,15}\|\s*/; // "|EN| "
const BRACKET_PREFIX = /^\s*\[[^\]]{1,15}\]\s*/; // "[EN] "

export interface CleanTitle {
  /** Lower case, decoration and year gone; ':' marks a subtitle. */
  base: string;
  /** The release year found in the name, if any. */
  year: number | null;
}

/** A title without its provider prefix, tags, brackets and year. */
export function cleanTitle(name: string): CleanTitle {
  let s = String(name ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’`´]/g, "'");
  for (let i = 0; i < 4; i++) {
    const before = s;
    s = s.replace(PIPE_PREFIX, '').replace(BRACKET_PREFIX, '').replace(TAG_PREFIX, '').replace(LANG_PREFIX, '');
    if (s === before) break;
  }
  let year: number | null = null;
  const inBrackets = s.match(/[([]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (inBrackets) year = Number(inBrackets[1]);
  s = s.replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, ' ').replace(QUALITY, ' ');
  // A trailing year: "Title - 1988", "Title 1988" (never a title that is only a year).
  const trailing = s.match(/^(.*\S)[\s\-–—:,.]+((?:19|20)\d{2})\s*$/);
  if (trailing && /[a-z]/i.test(trailing[1])) {
    if (year == null) year = Number(trailing[2]);
    s = trailing[1];
  }
  s = s.toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/\s+[-–—]+\s+/g, ' : ') // " - subtitle" reads as ": subtitle"
    .replace(/[^a-z0-9:]+/g, ' ')
    .replace(/\s*:\s*/g, ' : ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:]+|[\s:]+$/g, '');
  return { base: s, year };
}

const flat = (s: string) => s.replace(/\s*:\s*/g, ' ').replace(/\s+/g, ' ').trim();

interface Parsed { stem: string; num: number | null; full: string; year: number | null }

const PART_RE = new RegExp(`^(.+?)[\\s:]+(?:part|chapter|vol|volume)\\s+(\\d{1,2}|${ROMAN_RE}|${WORD_RE})(?:\\s*:.*)?$`);
const END_RE = new RegExp(`^(.+?)\\s+(\\d{1,2}|${ROMAN_RE})(?:\\s*:.*)?$`);
const MID_RE = /^(.+?)\s+(\d{1,2})\s+\S.*$/;
const SUB_RE = /^(.+?)\s*:\s*.+$/;

const toNum = (t: string): number | null => {
  if (/^\d+$/.test(t)) { const n = Number(t); return n >= 1 && n <= 19 ? n : null; }
  return ROMAN[t] ?? WORDS[t] ?? null;
};

function parse(name: string): Parsed {
  const { base, year } = cleanTitle(name);
  const full = flat(base);
  let stem = base;
  let num: number | null = null;
  for (const re of [PART_RE, END_RE, MID_RE]) {
    const m = base.match(re);
    if (!m) continue;
    const n = toNum(m[2]);
    if (n == null || !/[a-z]/.test(m[1])) continue;
    stem = m[1]; num = n;
    break;
  }
  if (num == null) {
    const m = base.match(SUB_RE);
    if (m && /[a-z]/.test(m[1])) stem = m[1];
  }
  stem = flat(stem.replace(/:/g, ' ')).replace(/^the\s+(?=\S)/, '');
  return { stem, num, full, year };
}

const parsedCache = new Map<string, Parsed>();
const parsed = (name: string): Parsed => {
  const key = String(name ?? '');
  let p = parsedCache.get(key);
  if (!p) {
    p = parse(key);
    if (parsedCache.size > 50000) parsedCache.clear();
    parsedCache.set(key, p);
  }
  return p;
};

/** The series a title belongs to, or '' when its stem is too short or too
 *  common to say ("Doll Night", "Doll Night 2" and "EN - Doll Night III
 *  (1991)" all give "doll night"). */
export function franchiseKey(name: string): string {
  const { stem } = parsed(name);
  if (stem.replace(/[^a-z]/g, '').length < 4) return '';
  if (!stem.includes(' ') && COMMON.has(stem)) return '';
  if (/^[\d\s]+$/.test(stem)) return '';
  return stem;
}

/** Where a title sits in its series: 2 for "Part 2" / "II", null for none. */
export function sequelNumber(name: string): number | null {
  return parsed(name).num;
}

const yearOf = (m: Named): number | null => {
  const y = String(m.year ?? '').match(/(?:19|20)\d{2}/);
  return y ? Number(y[0]) : parsed(m.name).year;
};

/** One copy per film: the same title (and year, when both copies know it)
 *  is the same film; the copy with a poster wins. Copies of `skip` go. */
function dedupe<T extends Named>(items: readonly T[], skip?: Named): T[] {
  const seen = new Map<string, Array<{ year: number | null; item: T | null }>>();
  const out: Array<{ year: number | null; item: T | null }> = [];
  const place = (m: Named, item: T | null) => {
    const full = parsed(m.name).full;
    const year = yearOf(m);
    const group = seen.get(full) ?? [];
    const same = group.find((g) => g.year == null || year == null || g.year === year);
    if (same) {
      if (same.year == null) same.year = year;
      // Same slot, the better copy.
      if (same.item && item && !same.item.stream_icon && item.stream_icon) same.item = item;
      return;
    }
    const entry = { year, item };
    group.push(entry);
    seen.set(full, group);
    out.push(entry);
  };
  if (skip) place(skip, null);
  for (const m of items) if (m && m.name) place(m, m);
  return out.map((e) => e.item).filter((x): x is T => x != null);
}

// Each list's series index, built once per list (a catalogue is tens of
// thousands of films; the page asks again for every film opened).
const indexes = new WeakMap<readonly Named[], Map<string, Named[]>>();
function indexOf<T extends Named>(list: readonly T[]): Map<string, T[]> {
  let idx = indexes.get(list) as Map<string, T[]> | undefined;
  if (!idx) {
    idx = new Map();
    for (const m of list) {
      if (!m || !m.name) continue;
      const k = franchiseKey(m.name);
      if (!k) continue;
      const arr = idx.get(k);
      if (arr) arr.push(m); else idx.set(k, [m]);
    }
    indexes.set(list, idx as Map<string, Named[]>);
  }
  return idx;
}

/** The other films of `current`'s series in `all`, one copy each, in order:
 *  the first film, 2, 3 … (then by year, then by name). */
export function findFranchise<T extends Named>(current: Named, all: readonly T[] | null | undefined, limit = 20): T[] {
  if (!current || !all?.length) return [];
  const key = franchiseKey(current.name);
  if (!key) return [];
  const same = (indexOf(all).get(key) ?? []).filter((m) => m.stream_id !== current.stream_id);
  const kept = dedupe(same, current);
  const order = (m: T) => [sequelNumber(m.name) ?? 1, yearOf(m) ?? 9999] as const;
  return kept
    .map((m, i) => ({ m, i, o: order(m) }))
    .sort((a, b) => a.o[0] - b.o[0] || a.o[1] - b.o[1] || a.m.name.localeCompare(b.m.name) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}

const genres = (g: unknown): Set<string> =>
  new Set(String(g ?? '').toLowerCase().split(/[,/|&;]+/).map((s) => s.trim()).filter(Boolean));

/** "More like this": other films from `list` (the film's own category),
 *  those sharing a genre with `genre` first, then the ones after it in the
 *  list; never the film itself, its copies, its series (`exclude` and any
 *  title of the same series) — at most `limit`. */
export function findMoreLikeThis<T extends Named>(
  current: Named,
  list: readonly T[] | null | undefined,
  genre?: string | null,
  exclude?: Iterable<number>,
  limit = 12,
): T[] {
  if (!current || !list?.length) return [];
  const out = new Set<number>(exclude ?? []);
  const key = franchiseKey(current.name);
  const at = list.findIndex((m) => m?.stream_id === current.stream_id);
  const n = list.length;
  const rotated: T[] = [];
  for (let k = 1; k <= n; k++) rotated.push(list[(Math.max(at, 0) + k) % n]);
  const pool = rotated.filter((m) => m && m.name && m.stream_id !== current.stream_id && !out.has(m.stream_id)
    && !(key && franchiseKey(m.name) === key));
  const want = genres(genre);
  const score = (m: T): number => {
    if (!want.size) return 0;
    let s = 0;
    for (const g of genres((m as unknown as { genre?: unknown }).genre)) if (want.has(g)) s++;
    return s;
  };
  const ranked = want.size
    ? pool.map((m, i) => ({ m, i, s: score(m) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m)
    : pool;
  return dedupe(ranked, current).slice(0, limit);
}

/** Cast names from the panel's comma-separated string, at most `limit`. */
export function castNames(cast: unknown, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(cast ?? '').split(/[,;\n]+/)) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}
