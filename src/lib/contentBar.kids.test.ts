import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kidsAllowsPlex, setKidsLevel } from '@/lib/kidsFilter';

type Item = { ratingKey: string; title: string; type: string; contentRating: string; thumb: string; genres?: string[]; librarySectionID?: string };

// A Plex server. `withKidsLibrary` adds a "Kids Movies" library; the rows
// answer by library (and genre query) the way the server does.
let withKidsLibrary = true;
let related: Item[] = [];
const rowCalls: Array<{ key: string; query: string }> = [];
const LIB: Record<string, Item[]> = {
  '1': [
    { ratingKey: 'm1', title: 'Super Troopers', type: 'movie', contentRating: 'R', thumb: '/t/m1', genres: ['Comedy'] },
    { ratingKey: 'm4', title: 'Grown-up PG Drama', type: 'movie', contentRating: 'PG', thumb: '/t/m4', genres: ['Drama'] },
    { ratingKey: 'm2', title: 'Moana', type: 'movie', contentRating: 'PG', thumb: '/t/m2', genres: ['Animation', 'Family'] },
  ],
  '2': [
    { ratingKey: 's1', title: 'American Dad!', type: 'show', contentRating: 'TV-14', thumb: '/t/s1', genres: ['Animation', 'Comedy'] },
    { ratingKey: 's2', title: 'Bluey', type: 'show', contentRating: 'TV-Y', thumb: '/t/s2', genres: ['Animation', 'Kids'] },
  ],
  '3': [
    { ratingKey: 'k1', title: 'Cars', type: 'movie', contentRating: 'G', thumb: '/t/k1' },
    { ratingKey: 'k2', title: 'Paw Patrol: The Movie', type: 'movie', contentRating: 'G', thumb: '/t/k2' },
  ],
};
const GENRES: Record<string, Array<{ key: string; title: string }>> = {
  '1': [{ key: '10', title: 'Animation' }, { key: '11', title: 'Family' }, { key: '12', title: 'Drama' }],
  '2': [{ key: '20', title: 'Animation' }, { key: '21', title: 'Kids' }, { key: '22', title: 'Comedy' }],
};
const KID_GENRE_KEYS = new Set(['10', '11', '20', '21']);

vi.mock('@/lib/plex', () => ({
  loadPlexServer: async () => ({ base: 'http://plex', token: 'tok' }),
  getPlexLibraries: async () => [
    { key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV Shows', type: 'show' },
    ...(withKidsLibrary ? [{ key: '3', title: 'Kids Movies', type: 'movie' }] : []),
  ],
  getPlexRelated: async () => related,
  getPlexFilterValues: async (_b: string, _t: string, path: string) => GENRES[path.split('/')[3]] ?? [],
  getPlexSectionRow: async (_b: string, _t: string, key: string, query: string) => {
    rowCalls.push({ key, query });
    const genre = /genre=([^&]+)/.exec(query)?.[1];
    const keys = genre ? decodeURIComponent(genre).split(',') : null;
    return (LIB[key] ?? []).filter((it) => !keys || (keys.some((k) => KID_GENRE_KEYS.has(k)) && (it.genres ?? []).some((g) => /animation|family|kids/i.test(g))));
  },
  kidsOnly: (items: Parameters<typeof kidsAllowsPlex>[0][]) => items.filter((it) => kidsAllowsPlex(it)),
  plexImageUrl: (_b: string, thumb?: string) => (thumb ? `img:${thumb}` : undefined),
}));
vi.mock('@/lib/xtream', () => ({
  loadCreds: async () => null, loadSavedAccounts: async () => [], getLiveCategories: async () => [],
  getLiveStreams: async () => [], getShortEpg: async () => ({ epg_listings: [] }), pickNowNext: () => ({}),
}));
vi.mock('@/lib/liveLines', () => ({ buildLines: () => [] }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map(), lineKey: (l: { host: string; username: string }) => `${l.host}|${l.username}` }));
let history: unknown[] = [];
vi.mock('@/lib/watchHistory', () => ({
  currentViewer: async () => 'device:p:kid', loadWatchHistory: () => history, syncWatchHistoryFromCloud: async () => [],
  channelKey: (_l: unknown, id: number) => String(id),
}));
vi.mock('@/lib/viewer', () => ({ viewerIsAccount: () => false }));

beforeEach(() => { rowCalls.length = 0; withKidsLibrary = true; related = []; history = []; });

describe('content bar on a Kids profile', () => {
  it('uses the kids library when the server has one: most watched first, then new', async () => {
    setKidsLevel('kids');
    const { buildViewerBar } = await import('./contentBar');
    const { items } = await buildViewerBar();
    expect(items.map((i) => i.title)).toEqual(['Cars', 'Paw Patrol: The Movie']);
    expect(items[0].subtitle).toBe('Popular with kids');
    expect(rowCalls.every((c) => c.key === '3')).toBe(true);
    expect(rowCalls.map((c) => c.query).sort()).toEqual(['sort=addedAt:desc', 'sort=viewCount:desc']);
  });

  it('without a kids library, only kids genres — never a grown-up PG or TV-14 title', async () => {
    withKidsLibrary = false;
    setKidsLevel('kids');
    const { buildViewerBar } = await import('./contentBar');
    const titles = (await buildViewerBar()).items.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Moana', 'Bluey']));
    for (const t of ['Super Troopers', 'Grown-up PG Drama', 'American Dad!']) expect(titles).not.toContain(t);
    expect(rowCalls.every((c) => /genre=/.test(c.query))).toBe(true);
  });

  it('"for you" keeps to titles made for children', async () => {
    withKidsLibrary = false;
    setKidsLevel('kids');
    history = [{ key: 'plex:b', kind: 'plex', title: 'Bluey', plex: { ratingKey: 's2', librarySectionID: '2' } }];
    related = [
      { ratingKey: 'r1', title: 'Grown-up PG Drama', type: 'movie', contentRating: 'PG', thumb: '', genres: ['Drama'] },
      { ratingKey: 'r2', title: 'Peppa Pig', type: 'show', contentRating: 'TV-Y', thumb: '', genres: ['Animation', 'Kids'] },
    ];
    const { buildViewerBar } = await import('./contentBar');
    const titles = (await buildViewerBar()).items.map((i) => i.title);
    expect(titles).toContain('Peppa Pig');
    expect(titles).not.toContain('Grown-up PG Drama');
  });

  it('a grown-up profile does not get the kids rows (the shared feed fills its bar)', async () => {
    setKidsLevel(null);
    const { buildViewerBar } = await import('./contentBar');
    expect((await buildViewerBar()).items).toEqual([]);
    expect(rowCalls).toEqual([]);
  });
});
