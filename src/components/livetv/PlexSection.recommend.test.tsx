// Recommend to others, through PlexSection with the network mocked (owner,
// 2026-10-12: "press and hold on a movie or show and recommend it to others
// ... in Discover there can be a bar strictly of movies and shows others have
// seen and recommend others check out"):
//   - Discover leads with "Recommended by viewers", read for this server,
//     each title confirmed on the server, counted, adult and Kids filters
//     applied, hidden when empty;
//   - a short OK on a poster opens it, a held OK opens the menu once, and
//     Recommend reaches the account; Discover asks again after it;
//   - a Kids profile has no menu; signed out, the menu says to sign in;
//   - the menu goes, and the remote comes back, when Plex loses the remote
//     or the server.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem, PlexLibrary } from '@/lib/plex';

const h = vi.hoisted(() => {
  const later = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => { setTimeout(() => r(v), ms); });
  const noop = () => { /* test */ };
  const conn = { base: 'https://plex.test', token: 'tok', name: 'Snow Media P2', clientIdentifier: 'srv' };
  const auth = {
    status: 'ready', conn, pinCode: null, error: null, justLinked: false, accountToken: null, providerNote: null, providerAvailable: false,
    clearJustLinked: noop, startLink: noop, cancelLink: noop, signOut: noop, retryConnect: noop, linkWithProvider: noop, reportAuthFailure: noop,
  };
  return {
    later, auth, conn,
    setAuth: null as null | ((a: typeof auth) => void),
    libs: vi.fn(), hub: vi.fn(), added: vi.fn(), row: vi.fn(), search: vi.fn(),
    rpc: vi.fn(),
    ops: [] as Array<{ op: string; row?: Record<string, unknown> }>,
    mine: [] as Array<{ rating_key: string }>,
    toast: vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  const result = { data: null, error: null };
  const chain: unknown = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(result) : () => chain),
  });
  const recs = (table: string) => ({
    insert: async (row: Record<string, unknown>) => { h.ops.push({ op: `insert:${table}`, row }); return { error: null }; },
    delete: () => {
      const d = { eq: () => d, then: (r: (v: unknown) => void) => { h.ops.push({ op: `delete:${table}` }); r({ error: null }); } };
      return d;
    },
    select: () => { const q = { eq: () => q, limit: async () => ({ data: h.mine, error: null }) }; return q; },
  });
  return {
    supabase: {
      from: (table: string) => (table === 'plex_recommendations' ? recs(table) : chain),
      rpc: (name: string, args: unknown) => (name === 'plex_recommended' ? h.rpc(args) : Promise.resolve(result)),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* test */ } } } }),
      },
      functions: { invoke: async () => result },
      channel: () => ({ on() { return this; }, subscribe() { return this; } }),
      removeChannel: () => undefined,
    },
  };
});
vi.mock('@/lib/analytics', async (orig) => ({
  ...(await orig<typeof import('@/lib/analytics')>()),
  trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(),
}));
vi.mock('@/hooks/usePlexAuth', async () => {
  const React = await import('react');
  return {
    usePlexAuth: () => {
      const [a, set] = React.useState(h.auth);
      h.setAuth = set;
      return a;
    },
  };
});
vi.mock('@/hooks/use-toast', async (orig) => ({ ...(await orig<typeof import('@/hooks/use-toast')>()), toast: h.toast }));
vi.mock('@/hooks/useNativePlayer', () => {
  const state = {
    error: null, buffering: false, audioWarning: null, controller: null,
    getPosition: async () => ({ position: 0, duration: 0, playing: false }), seekTo: () => undefined, retry: () => undefined,
  };
  return { useNativePlayer: () => state };
});
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexLibraries: h.libs,
  searchPlex: h.search,
  getPlexItemByKey: async () => null,
  getPlexHub: h.hub,
  getPlexRecentlyAdded: h.added,
  getPlexSectionRow: h.row,
  getPlexFilterValues: async () => [],
  getPlexRelated: async () => [],
  getPlexAccount: async () => null,
  loadHiddenPlexLibs: async () => [],
  preloadImages: async () => undefined,
}));
vi.mock('@/lib/overseerr', async (orig) => ({
  ...(await orig<typeof import('@/lib/overseerr')>()),
  overseerrSearch: async () => [],
}));
vi.mock('@/lib/plexSearches', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexSearches')>()),
  fetchPopularSearches: async () => [], loadRecentSearches: () => [],
}));
vi.mock('@/lib/plexProgress', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexProgress')>()),
  initPlexProgress: async () => undefined, pullProgressFromCloud: async () => undefined, continueWatching: () => [],
}));
vi.mock('@/lib/plexFavorites', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexFavorites')>()),
  myList: () => [], pullFavoritesFromCloud: async () => undefined,
}));
vi.mock('@/lib/plexProvider', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexProvider')>()),
  isOwnPlexAccount: async () => false,
}));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('./PlexDetail', () => ({ default: ({ item }: { item: PlexItem }) => <div>DETAIL:{item.title}</div> }));
vi.mock('./EpisodeAutoplay', () => ({ default: () => null }));
vi.mock('./PlexProgressReporter', () => ({ default: () => null }));
vi.mock('./PlexPlayerOverlay', () => ({ default: () => null }));

class NoResize { observe() { /* test */ } unobserve() { /* test */ } disconnect() { /* test */ } }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

const LIBS: PlexLibrary[] = [
  { key: '1', title: 'Movies', type: 'movie' },
  { key: '2', title: 'TV Shows', type: 'show' },
  { key: '3', title: 'Adult Movies', type: 'movie' },
];
const it_ = (ratingKey: string, title: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey, title, type: 'movie', thumb: `/library/metadata/${ratingKey}/thumb/1`, librarySectionID: '1', ...extra });
const row = (rating_key: string, title: string, recommenders: number, type = 'movie') => ({
  rating_key, type, title, year: 2020, thumb: `/library/metadata/${rating_key}/thumb/1`, content_rating: null, recommenders, last_recommended_at: '2026-10-12T10:00:00Z',
});
// What the server holds of the recommended titles: 11 and 12 are there, 13 is
// in the adult library, 14 carries an adult certificate, 15 is gone.
const ON_SERVER: Record<string, PlexItem> = {
  11: it_('11', 'Harbor Lights', { contentRating: 'PG' }),
  12: it_('12', 'Frontier', { type: 'show', librarySectionID: '2', contentRating: 'TV-MA' }),
  13: it_('13', 'Library Pick', { librarySectionID: '3', contentRating: 'R' }),
  14: it_('14', 'Late Night', { contentRating: 'X' }),
};
const RPC_ROWS = [row('11', 'Harbor Lights', 5), row('12', 'Frontier', 2, 'show'), row('13', 'Library Pick', 2), row('14', 'Late Night', 1), row('15', 'Gone Film', 1)];

// The Mac running these is often busy: every wait has room.
const T = { timeout: 5000 };
const key = (k: string, keyCode: number, extra: Record<string, unknown> = {}) => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k, keyCode, ...extra }); };
const keyUp = (k: string, keyCode: number) => { fireEvent.keyUp(document.activeElement ?? document.body, { key: k, keyCode }); };
const okPress = () => { key('Enter', 13); keyUp('Enter', 13); };
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const renderPlex = async (isActive = true) => {
  const { default: PlexSection } = await import('./PlexSection');
  const el = (active: boolean) => <PlexSection isActive={active} onExitLeft={() => undefined} onExitUp={() => undefined} />;
  const r = render(el(isActive));
  return { ...r, setActive: (active: boolean) => r.rerender(el(active)) };
};
/** From the side menu (where Plex opens, on Home) down to Discover and in. */
const openDiscover = async () => {
  await renderPlex();
  await screen.findByText('Discover', undefined, T);
  key('ArrowDown', 40);
  await wait(300);
  key('ArrowRight', 39);
};
const recRow = () => document.querySelector('[data-plex-row="recommended"]');

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  h.ops.length = 0;
  h.mine = [];
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  (await import('@/lib/viewer')).__setViewerForTests('user-1');
  // What this account recommended is kept on the box between visits.
  (await import('@/lib/plexRecommend')).__resetPlexRecommendForTests();
  h.libs.mockImplementation(() => h.later(5, LIBS));
  h.added.mockImplementation(() => h.later(5, []));
  h.row.mockImplementation(() => h.later(5, []));
  h.hub.mockImplementation((_b: string, _t: string, path: string) => {
    const m = /^\/library\/metadata\/([\d,]+)$/.exec(path);
    if (!m) return h.later(5, []);
    return h.later(5, m[1].split(',').map((k) => ON_SERVER[k]).filter(Boolean));
  });
  h.rpc.mockImplementation(async () => ({ data: RPC_ROWS, error: null }));
  h.search.mockImplementation(() => h.later(5, []));
});
afterEach(async () => {
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
});

describe('Discover — "Recommended by viewers"', { timeout: 30_000 }, () => {
  it('leads Discover with the titles recommended on this server, each confirmed on it and counted; adult and gone titles never show', async () => {
    await openDiscover();
    expect(await screen.findByText('Recommended by viewers', undefined, T)).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith({ p_server: 'srv', p_limit: 24 });
    // One request to the server for all of them.
    expect(h.hub).toHaveBeenCalledWith('https://plex.test', 'tok', '/library/metadata/11,12,13,14,15');
    const text = recRow()!.textContent!;
    expect(text).toContain('Harbor Lights');
    expect(text).toContain('Frontier');
    expect(text.indexOf('Harbor Lights')).toBeLessThan(text.indexOf('Frontier'));
    // The adult library's title, the adult certificate, the title the server no longer has.
    expect(text).not.toContain('Library Pick');
    expect(text).not.toContain('Late Night');
    expect(text).not.toContain('Gone Film');
    // The counts, on the posters.
    expect(screen.getByRole('img', { name: 'Recommended by 5 viewers' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Recommended by 2 viewers' })).toBeTruthy();
    // First on the page.
    expect(document.querySelector('[data-plex-row]')!.getAttribute('data-plex-row')).toBe('recommended');
    // OK on the first: its page.
    okPress();
    expect(await screen.findByText('DETAIL:Harbor Lights', undefined, T)).toBeTruthy();
  });

  it("what a title is comes from the server, not from the list: a row that calls a film a show can't hide it", async () => {
    h.rpc.mockImplementation(async () => ({ data: [{ ...row('11', 'Renamed', 9, 'show') }], error: null }));
    await openDiscover();
    await screen.findByText('Recommended by viewers', undefined, T);
    const text = recRow()!.textContent!;
    // The server's own name, and its count.
    expect(text).toContain('Harbor Lights');
    expect(text).not.toContain('Renamed');
    expect(screen.getByRole('img', { name: 'Recommended by 9 viewers' })).toBeTruthy();
  });

  it('nothing recommended: no row', async () => {
    h.rpc.mockImplementation(async () => ({ data: [], error: null }));
    await openDiscover();
    await waitFor(() => expect(h.rpc).toHaveBeenCalled(), T);
    await wait(50);
    expect(screen.queryByText('Recommended by viewers')).toBeNull();
    expect(recRow()).toBeNull();
  });

  it('a Kids profile sees only what its certificates allow', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    await openDiscover();
    await screen.findByText('Recommended by viewers', undefined, T);
    const text = recRow()!.textContent!;
    expect(text).toContain('Harbor Lights');
    expect(text).not.toContain('Frontier');
  });

  it('kept like the rest of Discover, except that this viewer\'s own recommendation shows the next time it opens', async () => {
    h.added.mockImplementation(() => h.later(5, [it_('21', 'New Film', { year: 2026 })]));
    await openDiscover();
    await screen.findByText('Recommended by viewers', undefined, T);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    // Out to the menu, up to Home, back down to Discover: the kept row.
    key('ArrowLeft', 37);
    key('ArrowUp', 38);
    await wait(300);
    key('ArrowDown', 40);
    await wait(300);
    key('ArrowRight', 39);
    await screen.findByText('Recommended by viewers', undefined, T);
    await wait(50);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    // Home: hold OK on New Film and recommend it.
    key('ArrowLeft', 37);
    key('ArrowUp', 38);
    await wait(300);
    key('ArrowRight', 39);
    await screen.findByText('New Film', undefined, T);
    key('Enter', 13);
    await wait(700);
    await screen.findByRole('dialog', { name: 'Recommend New Film' }, T);
    keyUp('Enter', 13);
    okPress();
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations']), T);
    // Discover again: asked again.
    key('ArrowLeft', 37);
    key('ArrowDown', 40);
    await wait(300);
    key('ArrowRight', 39);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2), T);
  });

  it('a recommendation from Discover itself is asked for again at once', async () => {
    await openDiscover();
    await screen.findByText('Recommended by viewers', undefined, T);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    key('Enter', 13);
    await wait(700);
    expect(await screen.findByRole('dialog', { name: 'Recommend Harbor Lights' }, T)).toBeTruthy();
    keyUp('Enter', 13);
    okPress();
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations']), T);
    expect(h.ops[0].row).toMatchObject({ user_id: 'user-1', server_id: 'srv', rating_key: '11', type: 'movie', title: 'Harbor Lights' });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(2), T);
  });
});

describe('hold OK on a Home poster', { timeout: 30_000 }, () => {
  beforeEach(() => {
    h.added.mockImplementation(() => h.later(5, [it_('21', 'New Film', { year: 2026, contentRating: 'PG-13' })]));
  });
  const intoHome = async () => {
    await renderPlex();
    await screen.findByText('New Film', undefined, T);
    key('ArrowRight', 39);
  };

  it('a short OK opens the title', async () => {
    await intoHome();
    key('Enter', 13);
    await wait(50);
    // Not on the press: on the release.
    expect(screen.queryByText('DETAIL:New Film')).toBeNull();
    keyUp('Enter', 13);
    expect(await screen.findByText('DETAIL:New Film', undefined, T)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('held: the menu, once; the repeats and the release open nothing; Recommend reaches the account', async () => {
    await intoHome();
    key('Enter', 13);
    for (let i = 0; i < 4; i++) { await wait(100); key('Enter', 13, { repeat: true }); }
    await wait(400);
    for (let i = 0; i < 3; i++) key('Enter', 13, { repeat: true });
    expect(await screen.findByRole('dialog', { name: 'Recommend New Film' }, T)).toBeTruthy();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('Recommend to others')).toBeTruthy();
    keyUp('Enter', 13);
    await wait(20);
    expect(screen.queryByText('DETAIL:New Film')).toBeNull();
    expect(h.ops).toEqual([]);
    // The menu has the remote: ▼ ▲ move in it, not on the rails.
    key('ArrowDown', 40);
    key('ArrowUp', 38);
    okPress();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations']), T);
    expect(h.ops[0].row).toMatchObject({ server_id: 'srv', rating_key: '21', title: 'New Film', type: 'movie' });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Recommended to other viewers', description: 'New Film' }), T);
    // The remote is the rails' again.
    const { isPlexKeyOwner } = await import('./plexKeyOwner');
    expect(isPlexKeyOwner('browse')).toBe(true);
    expect(screen.queryByText('DETAIL:New Film')).toBeNull();
    okPress();
    expect(await screen.findByText('DETAIL:New Film', undefined, T)).toBeTruthy();
  });

  it('already recommended: the menu says so, and Remove takes it back', async () => {
    h.mine = [{ rating_key: '21' }];
    await intoHome();
    key('Enter', 13);
    await wait(700);
    expect(await screen.findByText('Recommended ✓ · Remove', undefined, T)).toBeTruthy();
    keyUp('Enter', 13);
    okPress();
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['delete:plex_recommendations']), T);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Removed', description: 'New Film' }), T);
  });

  it('signed out: the menu says to sign in and sends nothing', async () => {
    (await import('@/lib/viewer')).__setViewerForTests('device');
    await intoHome();
    key('Enter', 13);
    await wait(700);
    expect(await screen.findByText(/Sign in to your Snow Media account to recommend titles/, undefined, T)).toBeTruthy();
    keyUp('Enter', 13);
    okPress();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    expect(h.ops).toEqual([]);
  });

  it('a Kids profile: no menu — OK opens the title on the press, as before', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('teen');
    await intoHome();
    key('Enter', 13);
    expect(await screen.findByText('DETAIL:New Film', undefined, T)).toBeTruthy();
    await wait(700);
    expect(screen.queryByRole('dialog')).toBeNull();
    keyUp('Enter', 13);
  });

  it('Back closes the menu and nothing else', async () => {
    await intoHome();
    key('Enter', 13);
    await wait(700);
    await screen.findByRole('dialog', { name: 'Recommend New Film' }, T);
    key('Escape', 27);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    keyUp('Enter', 13);
    // Still in Plex, on the rails: OK opens the title.
    okPress();
    expect(await screen.findByText('DETAIL:New Film', undefined, T)).toBeTruthy();
    expect(h.ops).toEqual([]);
  });
});

describe('hold OK on a search result', { timeout: 30_000 }, () => {
  it('a short OK opens it when let go; held, the menu', async () => {
    sessionStorage.setItem('smc-plex-voice', JSON.stringify({ query: 'harbor', open: false, at: Date.now() }));
    h.search.mockImplementation(() => h.later(5, [it_('31', 'Harbor Lights', { contentRating: 'PG' }), it_('32', 'Harbor Days', { contentRating: 'PG' })]));
    await renderPlex();
    await screen.findByText('Harbor Days', undefined, T);
    // From the box down into the results, OK as the remote sends it.
    key('ArrowDown', 40);
    key('Enter', 13);
    await wait(50);
    expect(screen.queryByText('DETAIL:Harbor Lights')).toBeNull();
    keyUp('Enter', 13);
    expect(await screen.findByText('DETAIL:Harbor Lights', undefined, T)).toBeTruthy();
  });

  it('held on a result: its menu, and nothing opens', async () => {
    sessionStorage.setItem('smc-plex-voice', JSON.stringify({ query: 'harbor', open: false, at: Date.now() }));
    h.search.mockImplementation(() => h.later(5, [it_('31', 'Harbor Lights', { contentRating: 'PG' })]));
    await renderPlex();
    await screen.findByText('Harbor Lights', undefined, T);
    key('ArrowDown', 40);
    key('Enter', 13);
    await wait(700);
    key('Enter', 13, { repeat: true });
    expect(await screen.findByRole('dialog', { name: 'Recommend Harbor Lights' }, T)).toBeTruthy();
    keyUp('Enter', 13);
    await wait(20);
    expect(screen.queryByText('DETAIL:Harbor Lights')).toBeNull();
  });
});

describe('the menu when Plex loses the remote or the server', { timeout: 30_000 }, () => {
  beforeEach(() => {
    h.added.mockImplementation(() => h.later(5, [it_('21', 'New Film', { year: 2026, contentRating: 'PG-13' })]));
  });
  const holdOnNewFilm = async () => {
    const r = await renderPlex();
    await screen.findByText('New Film', undefined, T);
    key('ArrowRight', 39);
    key('Enter', 13);
    await wait(700);
    await screen.findByRole('dialog', { name: 'Recommend New Film' }, T);
    keyUp('Enter', 13);
    return r;
  };

  it("a notice of the Player's over Plex: the menu goes and leaves the keys to it", async () => {
    const r = await holdOnNewFilm();
    act(() => { r.setActive(false); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(ev); });
    expect(ev.defaultPrevented).toBe(false);
    await wait(20);
    expect(h.ops).toEqual([]);
    // Plex has the remote again: the rails, not a menu.
    act(() => { r.setActive(true); });
    const { isPlexKeyOwner } = await import('./plexKeyOwner');
    expect(isPlexKeyOwner('browse')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the server goes (a reconnect, a sign-in again): the menu goes, the remote is the rails\' again, and it does not come back', async () => {
    await holdOnNewFilm();
    act(() => { h.setAuth?.({ ...h.auth, conn: { ...h.conn, clientIdentifier: undefined as unknown as string } }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    const { isPlexKeyOwner } = await import('./plexKeyOwner');
    expect(isPlexKeyOwner('browse')).toBe(true);
    act(() => { h.setAuth?.(h.auth); });
    await wait(50);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The rails answer OK again.
    okPress();
    expect(await screen.findByText('DETAIL:New Film', undefined, T)).toBeTruthy();
  });

  it('a reconnect (Plex "connecting"): the menu goes and the remote comes back', async () => {
    await holdOnNewFilm();
    act(() => { h.setAuth?.({ ...h.auth, status: 'connecting' }); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), T);
    const { isPlexKeyOwner } = await import('./plexKeyOwner');
    expect(isPlexKeyOwner('browse')).toBe(true);
  });
});
