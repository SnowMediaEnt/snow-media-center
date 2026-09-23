import { beforeEach, describe, expect, it, vi } from 'vitest';

const upserts: unknown[] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: (row: unknown) => { upserts.push(row); return Promise.resolve({ error: null }); } }),
  },
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  localStorage.clear();
  upserts.length = 0;
  const m = await import('./plexProgress');
  m.__resetPlexProgressForTests('device');
});

describe('plexProgress', () => {
  it('resumes mid-way, not in the first or last minute, not once watched', async () => {
    const m = await import('./plexProgress');
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 30, dur: 6000 });
    await tick();
    expect(m.resumeSeconds('m1')).toBeUndefined();
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200.7, dur: 6000 });
    await tick();
    expect(m.resumeSeconds('m1')).toBe(1200);
    expect(m.progressPercent('m1')).toBe(20);
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 5700, dur: 6000 });
    await tick();
    expect(m.isWatched('m1')).toBe(true);
    expect(m.resumeSeconds('m1')).toBeUndefined();
  });

  it('continue watching: newest first, one episode per show, show poster', async () => {
    const m = await import('./plexProgress');
    m.saveProgress({ ratingKey: 'e1', kind: 'episode', title: 'Ep 1', at: 600, dur: 1800, showKey: 's1', showTitle: 'Show', season: 1, index: 1 });
    await tick(); await new Promise((r) => setTimeout(r, 5));
    m.saveProgress({ ratingKey: 'm2', kind: 'movie', title: 'Film', at: 900, dur: 6000, librarySectionID: '3' });
    await tick(); await new Promise((r) => setTimeout(r, 5));
    m.saveProgress({ ratingKey: 'e2', kind: 'episode', title: 'Ep 2', at: 300, dur: 1800, showKey: 's1', showTitle: 'Show', season: 1, index: 2 });
    await tick();
    const row = m.continueWatching();
    expect(row.map((i) => i.ratingKey)).toEqual(['e2', 'm2']);
    expect(row[0].thumb).toBe('/library/metadata/s1/thumb');
    expect(row[0].grandparentTitle).toBe('Show');
    expect(row[0].viewOffset).toBe(300_000);
    expect(m.continueWatching(30, '3').map((i) => i.ratingKey)).toEqual(['m2']);
  });

  it('only a signed-in viewer is copied to the account', async () => {
    const m = await import('./plexProgress');
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1200, dur: 6000 }, true);
    await tick();
    expect(upserts).toEqual([]);
    m.__resetPlexProgressForTests('user-1');
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1300, dur: 6000 }, true);
    await tick();
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as { kind: string }).kind).toBe('plex_progress');
    // Within the minute and not final: not copied again.
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'Film', at: 1310, dur: 6000 });
    await tick();
    expect(upserts).toHaveLength(1);
  });
});

describe('mergeContinue', () => {
  it('keeps this box first, adds the server titles it lacks, one episode per show', async () => {
    const m = await import('./plexProgress');
    const own = [
      { ratingKey: 'e2', title: 'Ep 2', type: 'episode', grandparentTitle: 'Show' },
      { ratingKey: 'm1', title: 'Film', type: 'movie' },
    ];
    const server = [
      { ratingKey: 'm1', title: 'Film', type: 'movie' },
      { ratingKey: 'e3', title: 'Ep 3', type: 'episode', grandparentTitle: 'Show' },
      { ratingKey: 'x1', title: 'Other', type: 'episode', grandparentTitle: 'Other Show' },
      { ratingKey: 'x2', title: 'Other 2', type: 'episode', grandparentTitle: 'Other Show' },
      { ratingKey: 'm9', title: 'New', type: 'movie' },
    ];
    expect(m.mergeContinue(own, server).map((i) => i.ratingKey)).toEqual(['e2', 'm1', 'x1', 'm9']);
  });
});
