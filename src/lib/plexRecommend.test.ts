// Recommend to others: what a poster recommends, who may, and what reaches
// the account (plex_recommendations) and the list (plex_recommended).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem } from '@/lib/plex';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; row?: Record<string, unknown>; eq?: Array<[string, unknown]> }>,
  insertError: null as null | { code?: string; message?: string },
  mine: [] as Array<{ rating_key: string }>,
  /** The account's answer never comes. */
  hang: false,
  selects: 0,
  rpc: vi.fn(),
  trackEvent: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* test */ } } } }) },
    from: (table: string) => {
      const eq: Array<[string, unknown]> = [];
      return {
        insert: async (row: Record<string, unknown>) => { h.ops.push({ op: `insert:${table}`, row }); return { error: h.insertError }; },
        delete: () => {
          const d = {
            eq: (c: string, v: unknown) => { eq.push([c, v]); return d; },
            then: (r: (v: unknown) => void) => { h.ops.push({ op: `delete:${table}`, eq }); r({ error: null }); },
          };
          return d;
        },
        select: () => {
          const q = {
            eq: (c: string, v: unknown) => { eq.push([c, v]); return q; },
            limit: () => {
              h.selects++; h.ops.push({ op: `select:${table}`, eq });
              return h.hang ? new Promise(() => { /* never */ }) : Promise.resolve({ data: h.mine, error: null });
            },
          };
          return q;
        },
      };
    },
    rpc: h.rpc,
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.trackEvent }));

const film: PlexItem = { ratingKey: '101', title: 'Harbor Lights', type: 'movie', year: 2021, thumb: '/library/metadata/101/thumb/1700000000', contentRating: 'PG-13', librarySectionID: '1' };
const show: PlexItem = { ratingKey: '202', title: 'Frontier', type: 'show', thumb: '/library/metadata/202/thumb/1', contentRating: 'TV-14', librarySectionID: '2' };
const episode: PlexItem = { ratingKey: '303', title: 'Pilot', type: 'episode', grandparentTitle: 'Frontier', grandparentRatingKey: '202', contentRating: 'TV-14', librarySectionID: '2' };

beforeEach(async () => {
  h.ops.length = 0; h.insertError = null; h.mine = []; h.selects = 0; h.hang = false;
  h.rpc.mockReset(); h.trackEvent.mockReset();
  const m = await import('./plexRecommend');
  m.__resetPlexRecommendForTests();
  m.setPlexRecommendContext('srv-1', new Set(['9']));
  (await import('@/lib/viewer')).__setViewerForTests('user-1');
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
});

describe('what a poster recommends', () => {
  it('a movie or show itself, an episode its show, nothing else', async () => {
    const { recommendTarget } = await import('./plexRecommend');
    expect(recommendTarget(film)).toEqual({ ratingKey: '101', type: 'movie', title: 'Harbor Lights', year: 2021, thumb: '/library/metadata/101/thumb/1700000000', contentRating: 'PG-13' });
    expect(recommendTarget(episode)).toEqual({ ratingKey: '202', type: 'show', title: 'Frontier', thumb: '/library/metadata/202/thumb', contentRating: 'TV-14' });
    expect(recommendTarget({ ...episode, grandparentRatingKey: undefined })).toBeNull();
    expect(recommendTarget({ ratingKey: '7', title: 'Season 1', type: 'season' })).toBeNull();
    expect(recommendTarget({ ratingKey: 'abc', title: 'Odd', type: 'movie' })).toBeNull();
  });

  it('keeps only a path on the server as the poster: never a query (a token) or an address', async () => {
    const { recommendTarget } = await import('./plexRecommend');
    expect(recommendTarget({ ...film, thumb: '/library/metadata/101/thumb/1?X-Plex-Token=abc' })?.thumb).toBe('/library/metadata/101/thumb/1');
    expect(recommendTarget({ ...film, thumb: 'https://pms.example/library/metadata/101/thumb' })?.thumb).toBeUndefined();
  });
});

describe('who may recommend', () => {
  it('a grown-up profile on a known server, never a Kids profile, an adult title or library, or with no server', async () => {
    const m = await import('./plexRecommend');
    expect(m.canRecommend(film)).toBe(true);
    expect(m.canRecommend(episode)).toBe(true);
    expect(m.canRecommend({ ...film, librarySectionID: '9' })).toBe(false);
    expect(m.canRecommend({ ...film, contentRating: 'X' })).toBe(false);
    expect(m.canRecommend({ ...film, genres: ['Adult'] })).toBe(false);
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    expect(m.canRecommend({ ...film, contentRating: 'G' })).toBe(false);
    (await import('@/lib/kidsFilter')).setKidsLevel(null);
    m.setPlexRecommendContext(null);
    expect(m.canRecommend(film)).toBe(false);
  });
});

describe('recommend and take back', () => {
  it('recommends as the signed-in account on this server, and takes it back', async () => {
    const m = await import('./plexRecommend');
    const heard = vi.fn();
    window.addEventListener(m.PLEX_RECOMMEND_EVENT, heard);
    expect(await m.recommendTitle('srv-1', m.recommendTarget(film)!)).toBe('ok');
    expect(h.ops[0]).toEqual({ op: 'insert:plex_recommendations', row: {
      user_id: 'user-1', server_id: 'srv-1', rating_key: '101', type: 'movie', title: 'Harbor Lights',
      year: 2021, thumb: '/library/metadata/101/thumb/1700000000', content_rating: 'PG-13',
    } });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(m.plexRecommendChangedAt()).toBeGreaterThan(0);

    expect(await m.unrecommendTitle('srv-1', '101')).toBe('ok');
    expect(h.ops[1]).toEqual({ op: 'delete:plex_recommendations', eq: [['user_id', 'user-1'], ['server_id', 'srv-1'], ['rating_key', '101']] });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(h.trackEvent.mock.calls.map((c) => c[2])).toEqual([{ action: 'add', type: 'movie' }, { action: 'remove' }]);
    window.removeEventListener(m.PLEX_RECOMMEND_EVENT, heard);
  });

  it('already recommended (another box) is fine; the daily limit and other refusals say so', async () => {
    const m = await import('./plexRecommend');
    h.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect(await m.recommendTitle('srv-1', m.recommendTarget(film)!)).toBe('ok');
    h.insertError = { code: 'P0001', message: 'plex_recommend_daily_limit' };
    expect(await m.recommendTitle('srv-1', m.recommendTarget(show)!)).toBe('limit');
    h.insertError = { code: '42501', message: 'new row violates row-level security policy' };
    expect(await m.recommendTitle('srv-1', m.recommendTarget(show)!)).toBe('error');
  });

  it('signed out: nothing is sent', async () => {
    (await import('@/lib/viewer')).__setViewerForTests('device');
    const m = await import('./plexRecommend');
    expect(await m.recommendTitle('srv-1', m.recommendTarget(film)!)).toBe('signed_out');
    expect(await m.unrecommendTitle('srv-1', '101')).toBe('signed_out');
    expect(await m.loadMyRecommended('srv-1')).toBeNull();
    expect(h.ops).toEqual([]);
  });

  it("this account's own titles: read once per server, then kept current on the box", async () => {
    const m = await import('./plexRecommend');
    h.mine = [{ rating_key: '101' }];
    expect(m.myRecommendedKeys('srv-1')).toBeNull();
    const [a, b] = await Promise.all([m.loadMyRecommended('srv-1'), m.loadMyRecommended('srv-1')]);
    expect([...a!]).toEqual(['101']);
    expect(b).toBe(a);
    expect(h.selects).toBe(1);
    expect(h.ops[0].eq).toEqual([['user_id', 'user-1'], ['server_id', 'srv-1']]);
    await m.recommendTitle('srv-1', m.recommendTarget(show)!);
    expect([...m.myRecommendedKeys('srv-1')!].sort()).toEqual(['101', '202']);
    await m.unrecommendTitle('srv-1', '101');
    expect([...m.myRecommendedKeys('srv-1')!]).toEqual(['202']);
    await m.loadMyRecommended('srv-1');
    expect(h.selects).toBe(1);
    // Another server is another list.
    expect(m.myRecommendedKeys('srv-2')).toBeNull();
  });
});

describe("this account's own, unanswered", () => {
  it('gives up after 8 s (the menu then offers Recommend) and asks again next time', async () => {
    vi.useFakeTimers();
    try {
      const m = await import('./plexRecommend');
      h.hang = true;
      const p = m.loadMyRecommended('srv-1');
      await vi.advanceTimersByTimeAsync(8000);
      expect(await p).toBeNull();
      expect(m.myRecommendedKeys('srv-1')).toBeNull();
      h.hang = false;
      h.mine = [{ rating_key: '101' }];
      expect([...(await m.loadMyRecommended('srv-1'))!]).toEqual(['101']);
      expect(h.selects).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the list', () => {
  it('asks plex_recommended for this server, and makes poster tiles of it with their counts', async () => {
    const m = await import('./plexRecommend');
    h.rpc.mockResolvedValue({ data: [
      { rating_key: '202', type: 'show', title: 'Frontier', year: 2016, thumb: '/library/metadata/202/thumb/9', content_rating: 'TV-14', recommenders: 5, last_recommended_at: '2026-10-12T10:00:00Z' },
      { rating_key: '101', type: 'movie', title: 'Harbor Lights', year: null, thumb: null, content_rating: null, recommenders: 1, last_recommended_at: '2026-10-12T09:00:00Z' },
      { rating_key: '101', type: 'movie', title: 'Twice', year: null, thumb: null, content_rating: null, recommenders: 1, last_recommended_at: '2026-10-12T09:00:00Z' },
      { rating_key: '404', type: 'episode', title: 'Not a title', year: null, thumb: null, content_rating: null, recommenders: 3, last_recommended_at: '2026-10-12T09:00:00Z' },
    ], error: null });
    const rows = await m.fetchRecommended('srv-1', 12);
    expect(h.rpc).toHaveBeenCalledWith('plex_recommended', { p_server: 'srv-1', p_limit: 12 });
    expect(m.recommendedItems(rows)).toEqual([
      { ratingKey: '202', type: 'show', title: 'Frontier', year: 2016, thumb: '/library/metadata/202/thumb/9', contentRating: 'TV-14', recommenders: 5 },
      { ratingKey: '101', type: 'movie', title: 'Harbor Lights', year: undefined, thumb: '/library/metadata/101/thumb', contentRating: undefined, recommenders: 1 },
    ]);
  });

  it('an unanswered list is null, not an empty row', async () => {
    const m = await import('./plexRecommend');
    h.rpc.mockResolvedValue({ data: null, error: { message: 'function plex_recommended does not exist' } });
    expect(await m.fetchRecommended('srv-1')).toBeNull();
    h.rpc.mockRejectedValue(new Error('offline'));
    expect(await m.fetchRecommended('srv-1')).toBeNull();
    expect(await m.fetchRecommended('')).toBeNull();
  });
});
