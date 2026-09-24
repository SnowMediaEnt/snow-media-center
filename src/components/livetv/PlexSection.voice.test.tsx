// PlexSection end to end with the network mocked: a voice command's title,
// Search on a Kids profile, and Home's rails under the D-pad.
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
    libs: vi.fn(), search: vi.fn(), hub: vi.fn(), added: vi.fn(), row: vi.fn(),
    overseerrSearch: vi.fn(), overseerrRequest: vi.fn(), popularSearches: vi.fn(), recentSearches: vi.fn(),
  };
});

vi.mock('@/integrations/supabase/client', () => {
  const result = { data: null, error: null };
  const chain: unknown = new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? (res: (v: unknown) => void) => res(result) : () => chain),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: async () => result,
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
  getPlexHub: h.hub,
  getPlexRecentlyAdded: h.added,
  getPlexSectionRow: h.row,
  getPlexAccount: async () => null,
  loadHiddenPlexLibs: async () => [],
  loadPlexQuality: async () => 'original',
  preloadImages: async () => undefined,
}));
vi.mock('@/lib/overseerr', async (orig) => ({
  ...(await orig<typeof import('@/lib/overseerr')>()),
  overseerrSearch: h.overseerrSearch,
  overseerrRequest: h.overseerrRequest,
}));
vi.mock('@/lib/plexSearches', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexSearches')>()),
  fetchPopularSearches: h.popularSearches,
  loadRecentSearches: h.recentSearches,
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
// Like the real page, it takes its title once, when it mounts (its own stack).
vi.mock('./PlexDetail', async () => {
  const React = await import('react');
  const PlexDetail = ({ item }: { item: PlexItem }) => { const [first] = React.useState(item); return <div>DETAIL:{first.title}</div>; };
  return { default: PlexDetail };
});
vi.mock('./EpisodeAutoplay', () => ({ default: () => null }));
vi.mock('./PlexProgressReporter', () => ({ default: () => null }));
vi.mock('./PlexPlayerOverlay', () => ({ default: () => null }));

// jsdom has no ResizeObserver; the grid's row measure only needs it to exist.
class NoResize { observe() { /* test */ } unobserve() { /* test */ } disconnect() { /* test */ } }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

const LIBS: PlexLibrary[] = [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV Shows', type: 'show' }];
const it_ = (ratingKey: string, title: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey, title, type: 'movie', thumb: `/${ratingKey}`, ...extra });
const VOICE_KEY = 'smc-plex-voice';

// Sent where the remote's key would land: the focused element (Search's box
// takes its keys that way), else the page.
const key = (k: string, keyCode: number) => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k, keyCode }); };
const renderPlex = async () => {
  const { default: PlexSection } = await import('./PlexSection');
  return render(<PlexSection isActive onExitLeft={() => undefined} onExitUp={() => undefined} />);
};

beforeEach(async () => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('./plexKeyOwner')).setPlexKeyOwner('browse');
  h.libs.mockImplementation(() => h.later(5, LIBS));
  h.search.mockImplementation(() => h.later(5, []));
  h.hub.mockImplementation(() => h.later(5, []));
  h.added.mockImplementation(() => h.later(5, []));
  h.row.mockImplementation(() => h.later(5, []));
  h.overseerrSearch.mockImplementation(async () => [{ id: 99, mediaType: 'movie', title: 'Chucky', year: 1988, status: 1, posterUrl: null, overview: 'A doll.' }]);
  h.popularSearches.mockImplementation(async () => ['Deadpool', 'Saw']);
  h.recentSearches.mockImplementation(() => ['Fifty Shades']);
});
afterEach(async () => {
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
});

describe('PlexSection — a title asked for by voice', () => {
  it('opens its page even when the library list lands before the search answer', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'The Office', open: true, at: Date.now() }));
    h.libs.mockImplementation(() => h.later(10, LIBS));
    h.search.mockImplementation(() => h.later(80, [it_('o1', 'The Office', { type: 'show', year: 2005 })]));
    await renderPlex();
    // Waiting for it says so; Home is not loaded behind it.
    expect(await screen.findByText(/Finding “The Office” on Plex/)).toBeTruthy();
    expect(await screen.findByText('DETAIL:The Office', undefined, { timeout: 3000 })).toBeTruthy();
    expect(h.libs).toHaveBeenCalled();
    expect(h.added).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(VOICE_KEY)).toBeNull();
  });

  it('still opens it when the server gets a new address mid-search', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'Bluey', open: true, at: Date.now() }));
    h.search.mockImplementation(() => h.later(80, [it_('b1', 'Bluey', { type: 'show', contentRating: 'TV-Y' })]));
    await renderPlex();
    await waitFor(() => expect(h.search).toHaveBeenCalledTimes(1));
    act(() => { h.setAuth?.({ ...h.auth, conn: { ...h.conn, base: 'https://relay.plex.test' } }); });
    expect(await screen.findByText('DETAIL:Bluey', undefined, { timeout: 3000 })).toBeTruthy();
    expect(h.search).toHaveBeenLastCalledWith('https://relay.plex.test', 'tok', 'Bluey');
  });

  it('with no clear match opens Search with the words typed — "play toy story 5 in plex"', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'toy story 5 in plex', open: true, at: Date.now() }));
    h.search.mockImplementation(() => h.later(20, [it_('t1', 'Toy Story', { year: 1995 }), it_('t4', 'Toy Story 4', { year: 2019 })]));
    await renderPlex();
    const box = await screen.findByPlaceholderText('Search movies & shows…', undefined, { timeout: 3000 }) as HTMLInputElement;
    expect(box.value).toBe('toy story 5');
    expect(h.search).toHaveBeenCalledWith('https://plex.test', 'tok', 'toy story 5');
    expect(screen.queryByText(/^DETAIL:/)).toBeNull();
  });

  it('"play toy story 5 in plex" opens Toy Story 5 when the server has it, the library list landing first', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'toy story 5 in plex', open: true, at: Date.now() }));
    h.libs.mockImplementation(() => h.later(5, LIBS));
    h.search.mockImplementation(() => h.later(60, [
      it_('t1', 'Toy Story', { year: 1995 }), it_('t4', 'Toy Story 4', { year: 2019 }), it_('t5', 'Toy Story 5', { year: 2026 }),
    ]));
    await renderPlex();
    expect(await screen.findByText('DETAIL:Toy Story 5', undefined, { timeout: 3000 })).toBeTruthy();
    expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.search).toHaveBeenCalledWith('https://plex.test', 'tok', 'toy story 5');
  });

  it('"toy story five" is looked for as "toy story 5" too', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'toy story five', open: true, at: Date.now() }));
    h.search.mockImplementation((_b: string, _t: string, q: string) =>
      h.later(10, q === 'toy story 5' ? [it_('t5', 'Toy Story 5', { year: 2026 })] : []));
    await renderPlex();
    expect(await screen.findByText('DETAIL:Toy Story 5', undefined, { timeout: 3000 })).toBeTruthy();
    expect(h.search).toHaveBeenCalledWith('https://plex.test', 'tok', 'toy story five');
  });

  it('a title asked for while another title\'s page is up replaces that page', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'Bluey', open: true, at: Date.now() }));
    h.search.mockImplementation(() => h.later(10, [it_('b1', 'Bluey', { type: 'show' })]));
    await renderPlex();
    await screen.findByText('DETAIL:Bluey', undefined, { timeout: 3000 });
    h.search.mockImplementation(() => h.later(10, [it_('d1', 'Dune', { year: 2021 })]));
    act(() => { window.dispatchEvent(new CustomEvent('smc:plex-voice', { detail: { query: 'Dune', open: true, at: Date.now() } })); });
    expect(await screen.findByText('DETAIL:Dune', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('DETAIL:Bluey')).toBeNull();
  });

  it('opens the page when Plex is already open (the event)', async () => {
    await renderPlex();
    await screen.findByText('Recently Added', undefined, { timeout: 3000 });
    h.search.mockImplementation(() => h.later(10, [it_('d1', 'Dune', { year: 2021 })]));
    act(() => { window.dispatchEvent(new CustomEvent('smc:plex-voice', { detail: { query: 'Dune', open: true, at: Date.now() } })); });
    expect(await screen.findByText('DETAIL:Dune', undefined, { timeout: 3000 })).toBeTruthy();
  });

  it('ignores a stored request Plex never picked up', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'Dune', open: true, at: Date.now() - 10 * 60 * 1000 }));
    await renderPlex();
    await screen.findByText('Recently Added', undefined, { timeout: 3000 });
    expect(h.search).not.toHaveBeenCalled();
  });
});

describe('PlexSection — Search on a Kids profile', () => {
  it('never offers to request a title, and OK opens the allowed result', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'chucky', open: false, at: Date.now() }));
    h.search.mockImplementation(() => h.later(5, [it_('k1', 'Chucky Cheese Party', { contentRating: 'G' }), it_('k2', 'Chucky', { contentRating: 'R' })]));
    await renderPlex();
    const box = await screen.findByPlaceholderText('Search movies & shows…', undefined, { timeout: 3000 }) as HTMLInputElement;
    expect(box.value).toBe('chucky');
    await screen.findByText('Chucky Cheese Party', undefined, { timeout: 3000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(h.overseerrSearch).not.toHaveBeenCalled();
    expect(screen.queryByText(/Request it|isn’t on Plex yet/)).toBeNull();
    expect(screen.queryByText('Chucky')).toBeNull();
    // Down into the results, Down again (nothing below), OK as the remote sends it.
    key('ArrowDown', 40);
    key('ArrowDown', 40);
    key('Enter', 13);
    expect(await screen.findByText('DETAIL:Chucky Cheese Party')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Request this title?' })).toBeNull();
  });

  it('shows no grown-up suggestions (popular across the fleet, recent on the box)', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('little');
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'x', open: false, at: Date.now() }));
    await renderPlex();
    const box = await screen.findByPlaceholderText('Search movies & shows…', undefined, { timeout: 3000 }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: '' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByText('Popular searches')).toBeNull();
    expect(screen.queryByText('Recent on this box')).toBeNull();
    expect(screen.queryByText('Fifty Shades')).toBeNull();
    expect(h.popularSearches).not.toHaveBeenCalled();
  });

  it('a grown-up profile still gets the Request row and the suggestions', async () => {
    sessionStorage.setItem(VOICE_KEY, JSON.stringify({ query: 'chucky', open: false, at: Date.now() }));
    await renderPlex();
    expect(await screen.findByText(/isn’t on Plex yet/, undefined, { timeout: 3000 })).toBeTruthy();
    expect(h.overseerrSearch).toHaveBeenCalledWith('chucky');
    const box = screen.getByPlaceholderText('Search movies & shows…') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '' } });
    expect(await screen.findByText('Popular searches')).toBeTruthy();
    expect(screen.getByText('Recent on this box')).toBeTruthy();
  });
});

describe('PlexSection — Home', () => {
  it('Popular deals films and series out in turn, though a series\' plays are its episodes\' added up', async () => {
    h.row.mockImplementation((_b: string, _t: string, _section: string, query: string) => {
      if (query.startsWith('type=1&sort=viewCount')) return h.later(5, [it_('f1', 'Film A', { viewCount: 50 }), it_('f2', 'Film B', { viewCount: 40 })]);
      if (query.startsWith('type=2&sort=viewCount')) {
        return h.later(5, [
          it_('s1', 'Series A', { type: 'show', viewCount: 900 }), it_('s2', 'Series B', { type: 'show', viewCount: 700 }),
          it_('s3', 'Series C', { type: 'show', viewCount: 500 }),
        ]);
      }
      return h.later(5, []);
    });
    await renderPlex();
    await screen.findByText('Popular on Snow Media', undefined, { timeout: 3000 });
    const row = document.querySelector('[data-plex-row="popular"]')!.textContent!;
    const at = (t: string) => row.indexOf(t);
    for (const t of ['Series A', 'Film A', 'Series B', 'Film B', 'Series C']) expect(at(t)).toBeGreaterThanOrEqual(0);
    expect(at('Series A')).toBeLessThan(at('Film A'));
    expect(at('Film A')).toBeLessThan(at('Series B'));
    expect(at('Series B')).toBeLessThan(at('Film B'));
    expect(at('Film B')).toBeLessThan(at('Series C'));
  });

  it('blends films and series, adds Popular on Snow Media and New Episodes, and the D-pad reaches them', async () => {
    h.added.mockImplementation(() => h.later(5, [it_('a1', 'New Film', { year: 2026 }), it_('a2', 'New Series', { type: 'show' })]));
    h.row.mockImplementation((_b: string, _t: string, section: string, query: string) => {
      if (query.startsWith('type=1&sort=originallyAvailableAt')) return h.later(5, [it_('r1', 'Released Film', { year: 2026 })]);
      if (query.startsWith('type=1&sort=viewCount')) return h.later(5, [it_('p1', 'Played Film', { viewCount: 5 })]);
      if (query.startsWith('type=2&sort=viewCount')) return h.later(5, [it_('p2', 'Played Series', { type: 'show', viewCount: 9 })]);
      if (query.startsWith('type=4') && section === '2') {
        return h.later(5, [
          it_('e3', 'Ep 3', { type: 'episode', grandparentTitle: 'Show X', parentIndex: 1, index: 3 }),
          it_('e2', 'Ep 2', { type: 'episode', grandparentTitle: 'Show X', parentIndex: 1, index: 2 }),
          it_('y1', 'Pilot', { type: 'episode', grandparentTitle: 'Show Y', parentIndex: 1, index: 1 }),
        ]);
      }
      return h.later(5, []);
    });
    await renderPlex();
    await screen.findByText('Popular on Snow Media', undefined, { timeout: 3000 });
    expect(await screen.findByText('New Episodes', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('New Series')).toBeTruthy();
    const headings = Array.from(document.querySelectorAll('[data-plex-row]')).map((el) => el.getAttribute('data-plex-row'));
    expect(headings).toEqual(['added', 'released', 'popular', 'episodes']);
    // Most plays first, films and series together.
    const popular = document.querySelector('[data-plex-row="popular"]')!.textContent!;
    expect(popular.indexOf('Played Series')).toBeLessThan(popular.indexOf('Played Film'));
    // One tile per series: its newest episode.
    const eps = document.querySelector('[data-plex-row="episodes"]')!.textContent!;
    expect(eps).toContain('S1 E3');
    expect(eps).not.toContain('S1 E2');
    // Into Home, down to New Episodes, OK.
    key('ArrowRight', 39);
    key('ArrowDown', 40);
    key('ArrowDown', 40);
    key('ArrowDown', 40);
    key('Enter', 13);
    expect(await screen.findByText('DETAIL:Ep 3')).toBeTruthy();
  });
});
