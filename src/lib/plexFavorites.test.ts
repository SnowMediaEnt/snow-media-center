import { beforeEach, describe, expect, it, vi } from 'vitest';

const ops: Array<{ op: string; row?: unknown }> = [];
let cloudRows: Array<{ item_key: string; payload: unknown; watched_at: string }> = [];
vi.mock('@/integrations/supabase/client', () => {
  const q = {
    eq: () => q, limit: async () => ({ data: cloudRows, error: null }),
    then: undefined,
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from: () => ({
        upsert: (row: unknown) => { ops.push({ op: 'upsert', row }); return Promise.resolve({ error: null }); },
        delete: () => { const d = { eq: () => d, then: (r: (v: unknown) => void) => { ops.push({ op: 'delete' }); r({ error: null }); } }; return d; },
        select: () => q,
      }),
    },
  };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const film = { ratingKey: '5', title: 'Film', type: 'movie', year: 2020, librarySectionID: '3' };
const show = { ratingKey: '9', title: 'Show', type: 'show' };

beforeEach(async () => {
  localStorage.clear(); ops.length = 0; cloudRows = [];
  const m = await import('./plexFavorites');
  m.__resetPlexFavoritesForTests('device');
});

describe('plexFavorites (My List)', () => {
  it('adds and removes, newest first, with poster paths', async () => {
    const m = await import('./plexFavorites');
    expect(m.toggleFavorite(film)).toBe(true);
    await new Promise((r) => setTimeout(r, 3));
    expect(m.toggleFavorite(show)).toBe(true);
    expect(m.isFavorite('5')).toBe(true);
    expect(m.myList().map((i) => i.ratingKey)).toEqual(['9', '5']);
    expect(m.myList()[1].thumb).toBe('/library/metadata/5/thumb');
    expect(m.toggleFavorite(film)).toBe(false);
    expect(m.isFavorite('5')).toBe(false);
    await tick();
    expect(ops).toEqual([]); // a box without an account keeps it to itself
  });

  it('a signed-in viewer is copied to the account and removals delete there', async () => {
    const m = await import('./plexFavorites');
    m.__resetPlexFavoritesForTests('user-1');
    m.toggleFavorite(film);
    await tick();
    m.toggleFavorite(film);
    await tick();
    expect(ops.map((o) => o.op)).toEqual(['upsert', 'delete']);
  });

  it('pull: the account wins, but keeps what was added here since the last pull', async () => {
    const m = await import('./plexFavorites');
    m.__resetPlexFavoritesForTests('user-1');
    cloudRows = [{ item_key: '9', payload: { ratingKey: '9', type: 'show', title: 'Show', t: 1 }, watched_at: new Date(1).toISOString() }];
    await m.pullFavoritesFromCloud();
    expect(m.myList().map((i) => i.ratingKey)).toEqual(['9']);
    m.toggleFavorite(film); // added after the pull, not in the account yet
    cloudRows = [];         // and the show was removed on another box
    await m.pullFavoritesFromCloud();
    expect(m.myList().map((i) => i.ratingKey)).toEqual(['5']);
  });
});
