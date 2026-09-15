/**
 * How much a line's service actually carries: channels, movies and series.
 *
 * The panel has no "count" call — the only way to know how many channels a
 * service has is to ask for the list and measure it. So the numbers are
 * remembered per account here, on the device, and shown next to "All
 * channels" / "All Movies" / "All Series" and on the account screen. They are
 * filled in three ways, cheapest first:
 *
 *   - a category the viewer opens records its own count
 *   - a full list already in hand (search, or All) records the total and
 *     every category at once
 *   - Live TV counts itself in the background about once a week, off the
 *     critical path, and keeps only the numbers (see countLiveStreams)
 *
 * Counts are a nicety, never a source of truth: nothing here throws, a
 * missing count simply shows no badge, and a service that changes size fixes
 * itself the next time a list is seen.
 */

export type CatalogKind = 'live' | 'vod' | 'series';

export interface CatalogCounts {
  /** Everything the service carries, or null while unknown. */
  total: number | null;
  /** category_id → how many items are in it. */
  byCat: Record<string, number>;
  /** When the total was last measured (epoch ms), 0 when never. */
  at: number;
}

/** A total older than this is worth measuring again. */
export const COUNTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Plenty for the biggest line-ups, and keeps the stored blob small. */
const MAX_CATEGORIES = 600;

const EMPTY: CatalogCounts = { total: null, byCat: {}, at: 0 };

const keyFor = (host: string, username: string, kind: CatalogKind) =>
  `smc-catalog-counts:${kind}:${String(host || '').toLowerCase()}|${String(username || '').toLowerCase()}`;

interface Account { host: string; username: string }

export function readCounts(acc: Account, kind: CatalogKind): CatalogCounts {
  try {
    const raw = localStorage.getItem(keyFor(acc.host, acc.username, kind));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<CatalogCounts>;
    const total = typeof parsed.total === 'number' && parsed.total >= 0 ? parsed.total : null;
    const byCat: Record<string, number> = {};
    if (parsed.byCat && typeof parsed.byCat === 'object') {
      for (const [k, v] of Object.entries(parsed.byCat)) {
        if (typeof v === 'number' && v >= 0) byCat[k] = v;
      }
    }
    return { total, byCat, at: typeof parsed.at === 'number' ? parsed.at : 0 };
  } catch {
    return EMPTY;
  }
}

/**
 * Merges what was just measured into what was already known and returns the
 * merged counts, so a caller can hold them in state without a second read.
 * Only `total` carries a timestamp — a single category is not a measurement
 * of the whole service.
 */
export function recordCounts(
  acc: Account,
  kind: CatalogKind,
  patch: { total?: number; byCat?: Record<string, number> },
): CatalogCounts {
  const current = readCounts(acc, kind);
  const next: CatalogCounts = {
    total: typeof patch.total === 'number' ? patch.total : current.total,
    byCat: { ...current.byCat, ...(patch.byCat ?? {}) },
    at: typeof patch.total === 'number' ? Date.now() : current.at,
  };
  const keys = Object.keys(next.byCat);
  if (keys.length > MAX_CATEGORIES) {
    // Keep the biggest categories: those are the ones worth labelling.
    const trimmed: Record<string, number> = {};
    for (const k of keys.sort((a, b) => next.byCat[b] - next.byCat[a]).slice(0, MAX_CATEGORIES)) {
      trimmed[k] = next.byCat[k];
    }
    next.byCat = trimmed;
  }
  try {
    localStorage.setItem(keyFor(acc.host, acc.username, kind), JSON.stringify(next));
  } catch { /* storage full or blocked — the counts are still returned */ }
  return next;
}

/** Marks the total as worth measuring again, e.g. after "Update Channels". */
export function expireCounts(acc: Account, kind: CatalogKind): CatalogCounts {
  const current = readCounts(acc, kind);
  const next = { ...current, at: 0 };
  try {
    localStorage.setItem(keyFor(acc.host, acc.username, kind), JSON.stringify(next));
  } catch { /* ignore */ }
  return next;
}

export const countsAreFresh = (c: CatalogCounts): boolean =>
  c.total != null && c.at > 0 && Date.now() - c.at < COUNTS_MAX_AGE_MS;

/** category_id → count, for any list of items that carries one. */
export function tallyByCategory(list: Array<{ category_id?: string | number | null }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of list) {
    const key = String(item?.category_id ?? '').trim();
    if (!key) continue;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** 12438 → "12,438". Falls back to the plain number where Intl is missing. */
export const formatCount = (n: number): string => {
  try { return n.toLocaleString(); } catch { return String(n); }
};
