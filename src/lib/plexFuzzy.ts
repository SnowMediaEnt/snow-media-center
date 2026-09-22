// Forgiving Plex search.
//
// Plex's own search wants the title spelled the way the file is named. On a
// TV keyboard people drop the apostrophe, the colon, the hyphen, or a letter
// ("dont look up", "spiderman", "batmn"), and the server answers with
// nothing. So when a search comes back thin, a few cheaper searches run for
// the pieces of what was typed (each long word, the start of the first one),
// and everything they return is scored against the query. The closest
// titles become a "Did you mean" row. No index of the library is kept on the
// box: the server does the finding, this only does the judging.

import type { PlexItem } from '@/lib/plex';

/** Lower case, no accents, no apostrophes ("don't" → "dont"), every other
 *  punctuation mark a space, "&" spelled out. What two spellings of the
 *  same title collapse to. */
export const normalizeTitle = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’‘`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Damerau–Levenshtein (adjacent swaps count once): typos, drops, doubles. */
export function editDistance(a: string, b: string): number {
  const n = a.length, m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

/** 0..1, how close `query` is to `title`. The best of three readings:
 *  whole-string edit distance; the query against the title's opening
 *  (someone who typed "dark knight" for "The Dark Knight Rises"); and
 *  word-by-word, each query word against its nearest title word, so
 *  "batmn begins" still finds "Batman Begins". */
export function similarity(query: string, title: string): number {
  const q = normalizeTitle(query);
  const t = normalizeTitle(title);
  if (!q || !t) return 0;
  if (q === t) return 1;
  const whole = 1 - editDistance(q, t) / Math.max(q.length, t.length);
  // Opening: the query against the same number of characters of the title.
  const tHead = t.slice(0, q.length);
  const head = tHead.length >= 3 ? (1 - editDistance(q, tHead) / Math.max(q.length, tHead.length)) * 0.95 : 0;
  // Word by word, with a small penalty for title words the query never
  // mentioned so a one-word query does not match everything containing it.
  const qw = q.split(' ');
  const tw = t.split(' ');
  let sum = 0;
  for (const w of qw) {
    let best = 0;
    for (const v of tw) {
      const s = v.startsWith(w) && w.length >= 3
        ? 1
        : 1 - editDistance(w, v) / Math.max(w.length, v.length);
      if (s > best) best = s;
    }
    sum += best;
  }
  const words = (sum / qw.length) * (qw.length >= tw.length ? 1 : Math.max(0.6, 1 - (tw.length - qw.length) * 0.08));
  return Math.max(whole, head, words);
}

/** Cheaper searches to run when the real one comes back thin. */
export function searchVariants(query: string): string[] {
  const q = normalizeTitle(query);
  const raw = query.trim();
  const out: string[] = [];
  const add = (s: string) => {
    const v = s.trim();
    if (v.length >= 3 && v.toLowerCase() !== raw.toLowerCase() && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  };
  add(q);                                             // punctuation gone
  const words = q.split(' ').filter((w) => w.length >= 4).sort((a, b) => b.length - a.length);
  for (const w of words.slice(0, 2)) add(w);          // the long words on their own
  const first = q.split(' ')[0] ?? '';
  if (first.length >= 6) add(first.slice(0, 5));      // the start of the first word, past a typo at its end
  else if (q.length >= 6 && !q.includes(' ')) add(q.slice(0, Math.ceil(q.length * 0.6)));
  return out.slice(0, 4);
}

export const DID_YOU_MEAN_MIN = 0.55;

/** The closest titles to what was typed, best first, without anything the
 *  real search already showed. */
export function rankSuggestions(query: string, candidates: PlexItem[], exclude: Set<string>, limit = 6): PlexItem[] {
  const seen = new Set<string>();
  const scored: Array<{ it: PlexItem; s: number }> = [];
  for (const it of candidates) {
    const key = String(it.ratingKey);
    if (!key || seen.has(key) || exclude.has(key)) continue;
    seen.add(key);
    const s = similarity(query, it.title);
    if (s >= DID_YOU_MEAN_MIN) scored.push({ it, s });
  }
  scored.sort((a, b) => b.s - a.s || (b.it.year ?? 0) - (a.it.year ?? 0));
  return scored.slice(0, limit).map((x) => x.it);
}

/** When is a search "thin" enough to go looking for what they meant?
 *  Nothing back, or nothing back that is actually close. */
export const searchLooksThin = (query: string, results: PlexItem[]): boolean =>
  results.length === 0 || !results.slice(0, 3).some((it) => similarity(query, it.title) >= 0.8);
