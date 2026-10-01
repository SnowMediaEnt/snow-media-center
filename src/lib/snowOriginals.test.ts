import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in client that records the query it is asked and answers `db.answer`.
const db = vi.hoisted(() => ({
  calls: [] as Array<[string, unknown[]]>,
  answer: { data: [] as unknown[] | null, error: null as null | { message: string } },
}));
vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['select', 'eq', 'order']) chain[m] = (...a: unknown[]) => { db.calls.push([m, a]); return chain; };
  chain.limit = (...a: unknown[]) => { db.calls.push(['limit', a]); return Promise.resolve(db.answer); };
  return {
    supabase: {
      from: (t: string) => { db.calls.push(['from', [t]]); return chain; },
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/storage/v1/object/public/${bucket}/${path}` } }),
        }),
      },
    },
  };
});

import {
  FRESH_MS, KEEP_MS, NEW_MS, fetchOriginals, fmtDuration, forViewer, isNew, loadCachedOriginals,
  orientationOf, saveCachedOriginals, toOriginal, toOriginals, type SnowOriginal, type SnowOriginalRow,
} from './snowOriginals';

const row = (over: Partial<SnowOriginalRow> = {}): SnowOriginalRow => ({
  id: 'r1', title: 'Clip', description: 'About it', video_path: 'r1/v-abcd1234.mp4', poster_path: 'r1/p-abcd1234.jpg',
  backdrop_path: 'r1/b-abcd1234.jpg', duration_sec: 61.4, width: 720, height: 1280, orientation: 'portrait',
  kid_friendly: true, published: true, published_at: '2026-09-30T10:00:00.000Z', sort: -10, created_at: '2026-09-29T10:00:00.000Z',
  ...over,
});

beforeEach(() => { localStorage.clear(); db.calls = []; db.answer = { data: [], error: null }; });
afterEach(() => { vi.restoreAllMocks(); });

describe('toOriginal', () => {
  it('maps a row and builds the public URLs from the bucket paths', () => {
    expect(toOriginal(row())).toEqual({
      id: 'r1', title: 'Clip', description: 'About it',
      videoUrl: 'https://cdn.test/storage/v1/object/public/snow-originals/r1/v-abcd1234.mp4',
      posterUrl: 'https://cdn.test/storage/v1/object/public/snow-originals/r1/p-abcd1234.jpg',
      backdropUrl: 'https://cdn.test/storage/v1/object/public/snow-originals/r1/b-abcd1234.jpg',
      durationSec: 61.4, width: 720, height: 1280, portrait: true, kidFriendly: true,
      publishedAt: '2026-09-30T10:00:00.000Z', createdAt: '2026-09-29T10:00:00.000Z', sort: -10,
    });
  });

  it('sideways when wider than tall; no picture when the Hub stored none', () => {
    const o = toOriginal(row({ width: 1920, height: 1080, poster_path: null, backdrop_path: null }))!;
    expect(o.portrait).toBe(false);
    expect(o.posterUrl).toBeNull();
    expect(o.backdropUrl).toBeNull();
  });

  it('drops rows with no video file or no size', () => {
    expect(toOriginal(row({ video_path: '' }))).toBeNull();
    expect(toOriginal(row({ width: 0 }))).toBeNull();
    expect(toOriginal(row({ height: 0 }))).toBeNull();
    expect(toOriginals([row(), row({ id: 'r2', video_path: '' }), row({ id: 'r3' })]).map((o) => o.id)).toEqual(['r1', 'r3']);
  });
});

describe('orientationOf', () => {
  it('trusts the database value, and falls back to the size when it is null or unexpected', () => {
    expect(orientationOf({ orientation: 'landscape', width: 720, height: 1280 })).toBe('landscape');
    expect(orientationOf({ orientation: null, width: 720, height: 1280 })).toBe('portrait');
    expect(orientationOf({ orientation: 'square', width: 1920, height: 1080 })).toBe('landscape');
  });
});

describe('fetchOriginals', () => {
  it('always asks for published rows only, in the Hub order, at most 200', async () => {
    db.answer = { data: [{ ...row(), orientation: null }], error: null };
    const rows = await fetchOriginals();
    expect(db.calls[0]).toEqual(['from', ['snow_originals']]);
    const select = db.calls.find(([m]) => m === 'select')![1][0] as string;
    expect(select.split(',')).not.toContain('created_by');
    expect(db.calls).toContainEqual(['eq', ['published', true]]);
    expect(db.calls.filter(([m]) => m === 'order')).toEqual([
      ['order', ['sort', { ascending: true }]],
      ['order', ['published_at', { ascending: false, nullsFirst: false }]],
      ['order', ['created_at', { ascending: false }]],
    ]);
    expect(db.calls).toContainEqual(['limit', [200]]);
    expect(rows[0].orientation).toBe('portrait');
  });

  it('throws when the server answers with an error', async () => {
    db.answer = { data: null, error: { message: 'offline' } };
    await expect(fetchOriginals()).rejects.toThrow('offline');
  });
});

describe('forViewer', () => {
  const list = toOriginals([row({ id: 'kid', kid_friendly: true }), row({ id: 'all', kid_friendly: false })]);
  it.each([
    ['little', ['kid']],
    ['kids', ['kid']],
    // The owner's choice: Teens see every Snow Original.
    ['teen', ['kid', 'all']],
    [null, ['kid', 'all']],
  ] as const)('%s profile', (level, ids) => {
    expect(forViewer(list, level).map((o) => o.id)).toEqual(ids);
  });
});

describe('isNew', () => {
  const at = Date.parse('2026-09-01T00:00:00.000Z');
  const item = (publishedAt: string | null): Pick<SnowOriginal, 'publishedAt' | 'createdAt'> => ({ publishedAt, createdAt: '2020-01-01T00:00:00.000Z' });
  it('is new for 7 days after publishing, then not', () => {
    const p = new Date(at).toISOString();
    expect(isNew(item(p), at + NEW_MS - 1)).toBe(true);
    expect(isNew(item(p), at + NEW_MS)).toBe(false);
    expect(NEW_MS).toBe(7 * 24 * 60 * 60_000);
  });
  it('uses the upload time when there is no publish time', () => {
    expect(isNew({ publishedAt: null, createdAt: new Date(at).toISOString() }, at + 1000)).toBe(true);
    expect(isNew(item(null), at)).toBe(false);
  });
});

describe('fmtDuration', () => {
  it('writes digits only', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(5)).toBe('0:05');
    expect(fmtDuration(61.4)).toBe('1:01');
    expect(fmtDuration(179.6)).toBe('3:00');
    expect(fmtDuration(3723)).toBe('1:02:03');
    expect(fmtDuration(Number.NaN)).toBe('0:00');
  });
});

describe('the saved list', () => {
  const now = Date.parse('2026-09-30T12:00:00.000Z');
  it('round-trips with its time', () => {
    saveCachedOriginals([row()], now);
    expect(loadCachedOriginals(now + FRESH_MS + 1)).toEqual({ at: now, rows: [row()] });
  });
  it('is kept for a week for offline viewing, then dropped', () => {
    saveCachedOriginals([row()], now);
    expect(loadCachedOriginals(now + KEEP_MS)).not.toBeNull();
    expect(loadCachedOriginals(now + KEEP_MS + 1)).toBeNull();
  });
  it('ignores a damaged entry', () => {
    localStorage.setItem('smc-originals-v1', '{not json');
    expect(loadCachedOriginals(now)).toBeNull();
    localStorage.setItem('smc-originals-v1', JSON.stringify({ at: 'x', rows: 3 }));
    expect(loadCachedOriginals(now)).toBeNull();
  });
  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveCachedOriginals([row()], now)).not.toThrow();
    expect(loadCachedOriginals(now)).toBeNull();
  });
});
