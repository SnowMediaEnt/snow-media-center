import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kidsAllowsPlex, setKidsLevel } from '@/lib/kidsFilter';

// A Plex server with a movie and a TV library; the section rows answer by
// certificate the way the real server does for kidsRatingQuery.
const rowCalls: Array<{ key: string; query: string }> = [];
const LIB: Record<string, Array<{ ratingKey: string; title: string; type: string; contentRating: string; thumb: string }>> = {
  '1': [
    { ratingKey: 'm1', title: 'Super Troopers', type: 'movie', contentRating: 'R', thumb: '/t/m1' },
    { ratingKey: 'm2', title: 'Moana', type: 'movie', contentRating: 'PG', thumb: '/t/m2' },
    { ratingKey: 'm3', title: 'Cars', type: 'movie', contentRating: 'G', thumb: '/t/m3' },
  ],
  '2': [
    { ratingKey: 's1', title: 'American Dad!', type: 'show', contentRating: 'TV-14', thumb: '/t/s1' },
    { ratingKey: 's2', title: 'Bluey', type: 'show', contentRating: 'TV-Y', thumb: '/t/s2' },
  ],
};

vi.mock('@/lib/plex', () => ({
  loadPlexServer: async () => ({ base: 'http://plex', token: 'tok' }),
  getPlexLibraries: async () => [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'TV Shows', type: 'show' }],
  getPlexRelated: async () => [],
  getPlexSectionRow: async (_b: string, _t: string, key: string, query: string) => { rowCalls.push({ key, query }); return LIB[key] ?? []; },
  kidsOnly: (items: Parameters<typeof kidsAllowsPlex>[0][]) => items.filter((it) => kidsAllowsPlex(it)),
  plexImageUrl: (_b: string, thumb?: string) => (thumb ? `img:${thumb}` : undefined),
}));
vi.mock('@/lib/xtream', () => ({
  loadCreds: async () => null, loadSavedAccounts: async () => [], getLiveCategories: async () => [],
  getLiveStreams: async () => [], getShortEpg: async () => ({ epg_listings: [] }), pickNowNext: () => ({}),
}));
vi.mock('@/lib/liveLines', () => ({ buildLines: () => [] }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map(), lineKey: (l: { host: string; username: string }) => `${l.host}|${l.username}` }));
vi.mock('@/lib/watchHistory', () => ({
  currentViewer: async () => 'device:p:kid', loadWatchHistory: () => [], syncWatchHistoryFromCloud: async () => [],
  channelKey: (_l: unknown, id: number) => String(id),
}));
vi.mock('@/lib/viewer', () => ({ viewerIsAccount: () => false }));

beforeEach(() => { rowCalls.length = 0; });

describe('content bar on a Kids profile', () => {
  it('fills with the newest titles of its own rating, never grown-up ones', async () => {
    setKidsLevel('kids');
    const { buildViewerBar } = await import('./contentBar');
    const { items } = await buildViewerBar();
    const titles = items.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(['Moana', 'Cars', 'Bluey']));
    expect(titles).not.toContain('Super Troopers');
    expect(titles).not.toContain('American Dad!');
    expect(rowCalls.map((c) => c.query)).toEqual(['sort=addedAt:desc', 'sort=addedAt:desc']);
    // Movies and shows take turns.
    expect(titles.slice(0, 2)).toEqual(['Moana', 'Bluey']);
    expect(items.find((i) => i.title === 'Bluey')?.librarySectionID).toBe('2');
  });

  it('Teen allows up to PG-13 / TV-14', async () => {
    setKidsLevel('teen');
    const { buildViewerBar } = await import('./contentBar');
    const titles = (await buildViewerBar()).items.map((i) => i.title);
    expect(titles).toContain('American Dad!');
    expect(titles).not.toContain('Super Troopers');
  });

  it('a grown-up profile does not get the kids row (the shared feed fills its bar)', async () => {
    setKidsLevel(null);
    const { buildViewerBar } = await import('./contentBar');
    const { items } = await buildViewerBar();
    expect(items).toEqual([]);
    expect(rowCalls).toEqual([]);
  });
});
