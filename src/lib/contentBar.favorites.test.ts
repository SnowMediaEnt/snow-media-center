// The content bar's Favorites row: the viewer's Live TV favourites in their
// own order (favoritesOrder), what is on now under each, adult channels left
// out, then Plex My List — or only one of them, as the Source says.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lineA = { host: 'http://a.test', username: 'ua', password: 'p', serverLabel: 'DreamStreams' };
const lineB = { host: 'http://b.test', username: 'ub', password: 'p', serverLabel: 'Vibez' };
let lines: Array<typeof lineA> = [lineA, lineB];
const FAVS: Record<string, Array<{ stream_id: number; name: string; category_id: string; stream_icon?: string }>> = {
  'http://a.test|ua': [
    { stream_id: 1, name: 'News One', category_id: '1', stream_icon: 'logo1' },
    { stream_id: 2, name: 'XXX Late', category_id: '9' },
    { stream_id: 3, name: 'Sports Two', category_id: '1' },
  ],
  'http://b.test|ub': [{ stream_id: 7, name: 'Movies Seven', category_id: '1' }],
};
let plexSignedIn = true;

vi.mock('@/lib/xtream', () => ({
  loadCreds: async () => (lines.length ? lines[0] : null),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'General' }, { category_id: '9', category_name: 'Adults' }],
  getLiveStreams: async () => [],
  getShortEpg: async (_l: unknown, id: number) => ({ epg_listings: [{ title: `Show on ${id}` }] }),
  pickNowNext: (l: Array<{ title: string }>) => ({ now: l[0] }),
}));
vi.mock('@/lib/liveLines', () => ({ buildLines: () => lines }));
vi.mock('@/lib/favoritesSync', () => ({
  lineKey: (l: { host: string; username: string }) => `${l.host}|${l.username}`,
  loadFavoritesForLine: (l: { host: string; username: string }) => new Map((FAVS[`${l.host}|${l.username}`] ?? []).map((f) => [f.stream_id, f])),
}));
vi.mock('@/lib/plex', () => ({
  loadPlexServer: async () => (plexSignedIn ? { base: 'http://plex', token: 'tok' } : null),
  plexImageUrl: (_b: string, thumb?: string) => (thumb ? `img:${thumb}` : undefined),
  getPlexLibraries: async () => [], getPlexRelated: async () => [], getPlexSectionRow: async () => [], getPlexFilterValues: async () => [], kidsOnly: (x: unknown[]) => x,
}));
vi.mock('@/lib/plexFavorites', () => ({
  myList: () => [{ ratingKey: '55', title: 'Moana', type: 'movie', thumb: '/library/metadata/55/thumb' }],
}));
// The viewer's own order: Movies Seven (line B) first, then Sports Two, then the rest as added.
vi.mock('@/lib/favoritesOrder', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesOrder')>()),
  loadFavOrder: () => ({ mode: 'mine', keys: [{ line: 'http://b.test|ub', id: 7, name: 'Movies Seven' }, { line: 'http://a.test|ua', id: 3, name: 'Sports Two' }] }),
}));
vi.mock('@/lib/watchHistory', () => ({
  currentViewer: async () => 'device', loadWatchHistory: () => [], syncWatchHistoryFromCloud: async () => [],
  channelKey: (l: { host: string; username: string }, id: number) => `${l.host}|${l.username}|${id}`,
}));
vi.mock('@/lib/viewer', () => ({ viewerIsAccount: () => false }));

beforeEach(() => { lines = [lineA, lineB]; plexSignedIn = true; });

describe('content bar: Favorites row', () => {
  it('Live TV and Plex: favourites in the viewer\'s own order with what is on now, adult left out, then My List', async () => {
    const { buildFavoritesBar } = await import('./contentBar');
    const { items, hasLines } = await buildFavoritesBar('both');
    expect(hasLines).toBe(true);
    expect(items.map((i) => i.title)).toEqual(['Movies Seven', 'Sports Two', 'News One', 'Moana']);
    expect(items[0].subtitle).toBe('Show on 7');
    expect(items[2].poster).toBe('logo1');
    // A channel tile plays like any bar channel: its line and stream handed to Live TV.
    expect(items[0].channel).toMatchObject({ host: 'http://b.test', username: 'ub', streamId: 7 });
    expect(items[3]).toMatchObject({ ratingKey: '55', poster: 'img:/library/metadata/55/thumb' });
  });

  it('Live TV only leaves My List out; Plex only is My List', async () => {
    const { buildFavoritesBar } = await import('./contentBar');
    expect((await buildFavoritesBar('live')).items.map((i) => i.title)).toEqual(['Movies Seven', 'Sports Two', 'News One']);
    expect((await buildFavoritesBar('plex')).items.map((i) => i.title)).toEqual(['Moana']);
  });

  it('nothing signed in: an empty row, and it says there is no Live TV line', async () => {
    lines = [];
    plexSignedIn = false;
    const { buildFavoritesBar } = await import('./contentBar');
    expect(await buildFavoritesBar('both')).toEqual({ items: [], hasLines: false });
  });
});
