import { beforeEach, describe, expect, it, vi } from 'vitest';

// Signing in goes through viewer.ts's own auth listener, as on the box when
// Live TV signs it in to the account linked to its line.
type AuthCb = (event: string, session: { user: { id: string } } | null) => void;
type Row = { item_key: string; payload: unknown; watched_at: string };
let authCb: AuthCb | null = null;
const upserts: unknown[] = [];
let cloudRows: Row[] = [];
let refuse: { message: string } | null = null;
vi.mock('@/integrations/supabase/client', () => {
  const q = {
    eq: () => q, like: () => q, not: () => q, limit: async () => ({ data: cloudRows.slice(), error: null }),
    then: undefined,
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb: AuthCb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      },
      from: () => ({
        // The account has the rows a moment later, as over the network.
        upsert: (rows: Row | Row[]) => {
          upserts.push(rows);
          return new Promise((resolve) => setTimeout(() => {
            if (!refuse) for (const r of Array.isArray(rows) ? rows : [rows]) cloudRows.push({ item_key: r.item_key, payload: r.payload, watched_at: r.watched_at });
            resolve({ error: refuse });
          }, 5));
        },
        delete: () => { const d = { eq: () => d, then: (r: (v: unknown) => void) => r({ error: null }) }; return d; },
        select: () => q,
      }),
    },
  };
});

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const signIn = (id: string) => authCb!('SIGNED_IN', { user: { id } });
const stored = (viewer: string) => JSON.parse(localStorage.getItem(`snow-plex-favorites:${viewer}`) || 'null');
const film = { ratingKey: '5', title: 'Film', type: 'movie', year: 2020, librarySectionID: '3' };

/** plexFavorites and viewer.ts as a fresh start of the app: nobody signed in. */
const fresh = async () => {
  vi.resetModules();
  const m = await import('./plexFavorites');
  await (await import('./viewer')).resolveViewer();
  return m;
};

beforeEach(() => {
  localStorage.clear();
  upserts.length = 0;
  cloudRows = [];
  refuse = null;
  authCb = null;
});

describe('plexFavorites: My List from before signing in comes with it', () => {
  it('is on the account\'s list, goes up to the account, then leaves the box', async () => {
    const m = await fresh();
    m.toggleFavorite(film);
    expect(stored('device').map).toHaveProperty('5');

    signIn('u1');
    expect(m.isFavorite('5')).toBe(true);
    expect(m.myList().map((i) => i.ratingKey)).toEqual(['5']);
    expect(stored('u1').map).toHaveProperty('5');
    await wait();
    expect(upserts).toEqual([[expect.objectContaining({ user_id: 'u1', kind: 'plex_fav', item_key: '5' })]]);
    expect(stored('device')).toBeNull();

    authCb!('SIGNED_OUT', null);
    expect(m.isFavorite('5')).toBe(false);
  });

  it('a pull straight after signing in waits for them, so they are not taken for removed', async () => {
    // The account was pulled on this box before, after the title was added.
    localStorage.setItem('snow-plex-favorites:u1', JSON.stringify({ map: {}, pulledAt: Date.now() }));
    localStorage.setItem('snow-plex-favorites:device', JSON.stringify({
      map: { 5: { ratingKey: '5', type: 'movie', title: 'Film', t: Date.now() - 60_000 } }, pulledAt: 0,
    }));
    const m = await fresh();
    signIn('u1');
    await m.pullFavoritesFromCloud();
    expect(m.isFavorite('5')).toBe(true);
    expect(stored('device')).toBeNull();
  });

  it('refused by the account: the box keeps its copy, and the next pull brings it again', async () => {
    refuse = { message: 'JWT expired' };
    const m = await fresh();
    m.toggleFavorite(film);
    signIn('u1');
    await wait();
    expect(m.isFavorite('5')).toBe(true);
    expect(stored('device').map).toHaveProperty('5');

    refuse = null;
    await m.pullFavoritesFromCloud();
    expect(m.isFavorite('5')).toBe(true);
    expect(cloudRows.map((r) => r.item_key)).toEqual(['5']);
    expect(stored('device')).toBeNull();
  });

  it('signed in before this start: the list left on the box comes over at the first pull', async () => {
    localStorage.setItem('snow-plex-favorites:device', JSON.stringify({
      map: { 5: { ratingKey: '5', type: 'movie', title: 'Film', t: Date.now() - 60_000 } }, pulledAt: 0,
    }));
    const m = await fresh();
    m.__resetPlexFavoritesForTests('u1');
    await m.pullFavoritesFromCloud();
    expect(m.isFavorite('5')).toBe(true);
    expect(stored('device')).toBeNull();
  });

  it('from one account to another brings nothing across', async () => {
    const m = await fresh();
    signIn('u1');
    m.toggleFavorite(film);
    await wait();
    signIn('u2');
    expect(m.isFavorite('5')).toBe(false);
    expect(m.myList()).toEqual([]);
    expect(stored('u1').map).toHaveProperty('5');
  });
});
