// A film's page: "More in this series" (the other films sharing its title's
// stem — part 2, part 3, the first one) and "More like this" (its own
// category). Owner, 2026-10-27: open a film and go straight to its sequel
// instead of backing out and hunting for it.
//
// Everything here is on the box and pure: it reads movie lists the section
// already holds (or fetched once). It never asks the panel about another film
// (a burst of per-film calls gets the box's address banned).

type Named = { name: string; stream_id: number; stream_icon?: string; year?: string; category_id?: string };

// Not IX/X: "Malcolm X" is a name, not part 10.
const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 };
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ROMAN_RE = 'ii|iii|iv|v|vi|vii|viii';
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
  /** The year was a bare trailing number ("Title 2049"), which may be part
   *  of the name itself rather than the release year. */
  yearFromTail: boolean;
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
  let yearFromTail = false;
  if (trailing && /[a-z]/i.test(trailing[1])) {
    if (year == null) { year = Number(trailing[2]); yearFromTail = true; }
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
  return { base: s, year, yearFromTail };
}

const flat = (s: string) => s.replace(/\s*:\s*/g, ' ').replace(/\s+/g, ' ').trim();

interface Parsed { stem: string; num: number | null; full: string; year: number | null; yearFromTail: boolean }

const PART_RE = new RegExp(`^(.+?)[\\s:]+(?:part|chapter|vol|volume)\\s+(\\d{1,2}|${ROMAN_RE}|${WORD_RE})(?:\\s*:.*)?$`);
const END_RE = new RegExp(`^(.+?)\\s+(\\d{1,2}|${ROMAN_RE})(?:\\s*:.*)?$`);
const MID_RE = /^(.+?)\s+(\d{1,2})\s+\S.*$/;
// The part before a subtitle: cut at the first ':' with at least two words
// before it ("Mission: Impossible - Fallout" is "mission impossible", and
// "The Mission" stays out of it).
function beforeSubtitle(s: string): string {
  const parts = s.split(/\s*:\s*/);
  let head = parts[0];
  for (let i = 1; i < parts.length; i++) {
    if (head.replace(/^the\s+/, '').trim().split(/\s+/).length >= 2) break;
    head = `${head} ${parts[i]}`;
  }
  return head;
}

const toNum = (t: string): number | null => {
  if (/^\d+$/.test(t)) { const n = Number(t); return n >= 1 && n <= 19 ? n : null; }
  return ROMAN[t] ?? WORDS[t] ?? null;
};

function parse(name: string): Parsed {
  const { base, year, yearFromTail } = cleanTitle(name);
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
  if (/:/.test(stem)) {
    const head = beforeSubtitle(stem);
    if (/[a-z]/.test(head)) stem = head;
  }
  stem = flat(stem.replace(/:/g, ' ')).replace(/^the\s+(?=\S)/, '');
  return { stem, num, full, year, yearFromTail };
}

// Small on purpose: the series index parses the whole catalogue without it,
// so this only holds the few titles a page looks at.
const parsedCache = new Map<string, Parsed>();
const parsed = (name: string): Parsed => {
  const key = String(name ?? '');
  let p = parsedCache.get(key);
  if (!p) {
    p = parse(key);
    if (parsedCache.size > 2000) parsedCache.clear();
    parsedCache.set(key, p);
  }
  return p;
};

const keyOfParsed = ({ stem }: Parsed): string => {
  if (stem.replace(/[^a-z]/g, '').length < 4) return '';
  if (!stem.includes(' ') && COMMON.has(stem)) return '';
  if (/^[\d\s]+$/.test(stem)) return '';
  return stem;
};

/** The series a title belongs to, or '' when its stem is too short or too
 *  common to say ("Doll Night", "Doll Night 2" and "EN - Doll Night III
 *  (1991)" all give "doll night"). */
export function franchiseKey(name: string): string {
  return keyOfParsed(parsed(name));
}

/** Where a title sits in its series: 2 for "Part 2" / "II", null for none. */
export function sequelNumber(name: string): number | null {
  return parsed(name).num;
}

const yearOf = (m: Named): number | null => {
  const y = String(m.year ?? '').match(/(?:19|20)\d{2}/);
  return y ? Number(y[0]) : parsed(m.name).year;
};
// A year read only off the end of the name ("Blade Runner 2049") may be the
// name itself: such a title is a copy of another only when both years agree.
const softYear = (m: Named): boolean => !/(?:19|20)\d{2}/.test(String(m.year ?? '')) && parsed(m.name).yearFromTail;

/** One copy per film: the same title (and year, when both copies know it)
 *  is the same film; the copy with a poster wins. Copies of `skip` go. */
function dedupe<T extends Named>(items: readonly T[], skip?: Named): T[] {
  type Slot = { year: number | null; tail: boolean; item: T | null };
  const seen = new Map<string, Slot[]>();
  const out: Slot[] = [];
  const place = (m: Named, item: T | null) => {
    const full = parsed(m.name).full;
    const year = yearOf(m);
    const tail = softYear(m);
    const group = seen.get(full) ?? [];
    const same = group.find((g) => g.year === year
      || (g.year == null && year != null && !tail)
      || (year == null && g.year != null && !g.tail));
    if (same) {
      if (same.year == null) { same.year = year; same.tail = tail; }
      // Same slot, the better copy.
      if (same.item && item && !same.item.stream_icon && item.stream_icon) same.item = item;
      return;
    }
    const entry: Slot = { year, tail, item };
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
const building = new WeakMap<readonly Named[], Promise<void>>();
function addTo(idx: Map<string, Named[]>, m: Named) {
  if (!m || !m.name) return;
  const k = keyOfParsed(parse(String(m.name)));
  if (!k) return;
  const arr = idx.get(k);
  if (arr) arr.push(m); else idx.set(k, [m]);
}
function indexOf<T extends Named>(list: readonly T[]): Map<string, T[]> {
  let idx = indexes.get(list) as Map<string, T[]> | undefined;
  if (!idx) {
    const built = new Map<string, Named[]>();
    for (const m of list) addTo(built, m);
    indexes.set(list, built);
    idx = built as Map<string, T[]>;
  }
  return idx;
}

/** Whether `list`'s series index is built (findFranchise is then quick). */
export function seriesIndexReady(list: readonly Named[]): boolean {
  return indexes.has(list);
}

/** Builds `list`'s series index a slice at a time, giving the remote back
 *  between slices: a catalogue of tens of thousands of films in one go held
 *  a Fire TV for seconds. */
export function buildSeriesIndex(list: readonly Named[], slice = 1500): Promise<void> {
  if (indexes.has(list)) return Promise.resolve();
  const running = building.get(list);
  if (running) return running;
  const built = new Map<string, Named[]>();
  const p = new Promise<void>((resolve) => {
    let i = 0;
    const step = () => {
      const end = Math.min(i + slice, list.length);
      for (; i < end; i++) addTo(built, list[i]);
      if (i < list.length) { window.setTimeout(step, 0); return; }
      indexes.set(list, built);
      building.delete(list);
      resolve();
    };
    step();
  });
  building.set(list, p);
  return p;
}

/** The other films of `current`'s series in `all`, one copy each, in order:
 *  the first film, 2, 3 … (then by year, then by name). */
export function findFranchise<T extends Named>(current: Named, all: readonly T[] | null | undefined, limit = 20): T[] {
  if (!current || !all?.length) return [];
  const key = franchiseKey(current.name);
  if (!key) return [];
  const group = indexOf(all).get(key) ?? [];
  // A bare trailing 10-19 is only a part number when the series has a film
  // without one (the first, or a "Part"/"II" title): "Orbit 11" and "Orbit
  // 13" are names. Parts 2-9 stand on their own (a catalogue often lacks
  // the first film).
  const named = (n: string) => { const p = parsed(n); return p.num == null || p.num <= 9 || !/\s\d{1,2}(?:\s*:.*)?$/.test(p.full); };
  if (!named(current.name) && !group.some((m) => named(m.name))) return [];
  const same = group.filter((m) => m.stream_id !== current.stream_id);
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
