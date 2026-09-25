import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { item_key: string; payload: unknown; watched_at: string };
let cloudRows: Row[] = [];
let upsertAnswer: () => Promise<unknown> = () => Promise.resolve({ error: null });
vi.mock('@/integrations/supabase/client', () => {
  const q = {
    eq: () => q, like: () => q, not: () => q, order: () => q,
    limit: async () => ({ data: cloudRows, error: null }),
    then: undefined,
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from: () => ({ upsert: () => upsertAnswer(), select: () => q }),
    },
  };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const entry = (ratingKey: string, t: number, more: Record<string, unknown> = {}) =>
  ({ ratingKey, kind: 'movie', title: ratingKey, at: 1200, dur: 6000, t, done: false, ...more });
const put = (viewer: string, map: Record<string, unknown>) =>
  localStorage.setItem(`snow-plex-progress:${viewer}`, JSON.stringify(map));
const cloudRow = (p: Record<string, unknown> & { ratingKey: string }, watchedAt: number): Row =>
  ({ item_key: p.ratingKey, payload: p, watched_at: new Date(watchedAt).toISOString() });

beforeEach(async () => {
  localStorage.clear();
  cloudRows = [];
  upsertAnswer = () => Promise.resolve({ error: null });
  const m = await import('./plexProgress');
  m.__resetPlexProgressForTests('device');
});
afterEach(() => { vi.restoreAllMocks(); });

describe('plexProgress: a saved list with odd entries', () => {
  it('reads times written as text as numbers, and drops entries with no usable time or place', async () => {
    const now = Date.now();
    put('device', {
      m1: { ...entry('m1', 0), t: String(now - MIN), at: '1200', dur: '6000' },
      noTime: { ...entry('noTime', 0), t: undefined },
      badTime: { ...entry('badTime', 0), t: 'yesterday' },
      badPlace: { ...entry('badPlace', now - 2 * MIN), at: 'x' },
      badLength: { ...entry('badLength', now - 3 * MIN), dur: 'long' },
    });
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('device');
    expect(m.progressCount()).toBe(1);
    expect(m.getProgress('m1')).toMatchObject({ t: now - MIN, at: 1200, dur: 6000 });
    expect(m.continueWatching().map((i) => i.ratingKey)).toEqual(['m1']);
    expect(m.continueWatching()[0].lastViewedAt).toBe(now - MIN);
  });

  it('a time saved while the clock ran ahead counts as now, not as days to come', async () => {
    const now = Date.now();
    put('device', {
      ahead: entry('ahead', now + 5 * DAY),
      m2: entry('m2', now - MIN),
      e1: entry('e1', now + 3 * DAY, { kind: 'episode', at: 1790, dur: 1800, done: true, showKey: 'S', season: 1, index: 2 }),
    });
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('device');
    const row = m.continueWatching(30, undefined, now);
    expect(row.map((i) => [i.ratingKey, i.lastViewedAt])).toEqual([['ahead', now], ['m2', now - MIN]]);
    expect(m.finishedShows(8, now).map((s) => [s.showKey, s.t])).toEqual([['S', now]]);
    // Within a day ahead is only clocks a little apart: as it is.
    put('device', { soon: entry('soon', now + 60 * MIN) });
    m.__resetPlexProgressForTests('device');
    expect(m.continueWatching(30, undefined, now)[0].lastViewedAt).toBe(now + 60 * MIN);
  });
});

describe('plexProgress: the account copy brought to the box', () => {
  it('a time still to come on the account is taken as now', async () => {
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('u1');
    cloudRows = [cloudRow(entry('m1', 0), Date.now() + 365 * DAY)];
    const before = Date.now();
    await m.pullProgressFromCloud();
    const t = m.getProgress('m1')!.t;
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('"watched" or "not started" just after a place kept here does not take that place', async () => {
    const now = Date.now();
    put('u1', {
      done5: entry('done5', now - 30 * MIN),
      barely5: entry('barely5', now - 30 * MIN),
      done20: entry('done20', now - 60 * MIN),
      further5: entry('further5', now - 30 * MIN),
    });
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('u1');
    cloudRows = [
      cloudRow(entry('done5', 0, { at: 5990, done: true }), now - 25 * MIN),
      cloudRow(entry('barely5', 0, { at: 10 }), now - 25 * MIN),
      // Not the same sitting: finished twenty minutes on, somewhere else.
      cloudRow(entry('done20', 0, { at: 5990, done: true }), now - 40 * MIN),
      // A newer place to resume from always wins.
      cloudRow(entry('further5', 0, { at: 3000 }), now - 25 * MIN),
    ];
    await m.pullProgressFromCloud();
    expect(m.resumeSeconds('done5')).toBe(1200);
    expect(m.resumeSeconds('barely5')).toBe(1200);
    expect(m.isWatched('done20')).toBe(true);
    expect(m.resumeSeconds('further5')).toBe(3000);
  });
});

describe('plexProgress: storage that is full', () => {
  it('keeps the newest 150 when the whole list does not fit', async () => {
    const now = Date.now();
    const map: Record<string, unknown> = {};
    for (let i = 0; i < 200; i++) map[`m${i}`] = entry(`m${i}`, now - (i + 1) * MIN);
    put('device', map);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.startsWith('snow-plex-progress:') && Object.keys(JSON.parse(value)).length > 150) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, key, value);
    });
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('device');
    m.saveProgress({ ratingKey: 'new', kind: 'movie', title: 'New', at: 900, dur: 6000 });
    await tick();
    const kept = JSON.parse(localStorage.getItem('snow-plex-progress:device')!);
    expect(Object.keys(kept)).toHaveLength(150);
    expect(kept).toHaveProperty('new');
    expect(kept).toHaveProperty('m148');
    expect(kept).not.toHaveProperty('m149');
    expect(m.progressDiag().storageErrorAt).toBeUndefined();
  });

  it('says so in the Continue Watching check when nothing can be written, and this run still resumes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const m = await import('./plexProgress');
    const before = Date.now();
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 });
    await tick();
    expect(m.progressDiag().storageErrorAt).toBeGreaterThanOrEqual(before);
    expect(m.progressDiag().title).toBe('Film');
    expect(m.resumeSeconds('m1')).toBe(1200);
    // Storage gone altogether: noting never throws into the player.
    m.__resetPlexProgressForTests('device');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(() => m.noteProgressDiag({ infoMissAt: 1 })).not.toThrow();
    expect(m.progressDiag().infoMissAt).toBe(1);
  });
});

describe('plexProgress: the account refusing a copy', () => {
  it('is noted for the Continue Watching check', async () => {
    upsertAnswer = () => Promise.resolve({ error: { message: 'new row violates row-level security policy for table "watch_history"', code: '42501' } });
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('u1');
    const before = Date.now();
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 }, true);
    await tick(); await tick();
    const d = m.progressDiag();
    expect(d.cloudErrorAt).toBeGreaterThanOrEqual(before);
    expect(d.cloudError).toContain('row-level security');
    expect(d.cloudError!.length).toBeLessThanOrEqual(100);
    // Still kept on the box.
    expect(m.resumeSeconds('m1')).toBe(1200);
  });

  it('a request that fails outright is noted too', async () => {
    upsertAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
    const m = await import('./plexProgress');
    m.__resetPlexProgressForTests('u1');
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 }, true);
    await tick(); await tick();
    expect(m.progressDiag().cloudError).toBe('Failed to fetch');
  });
});
