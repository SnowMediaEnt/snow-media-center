import { beforeEach, describe, expect, it, vi } from 'vitest';

// plexReq is the only network call; answer from a table keyed by path.
const answers: Record<string, unknown> = {};
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
}));

const meta = (list: Array<Record<string, unknown>>) => ({ MediaContainer: { Metadata: list } });

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body = answers[path];
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
  }));
});

describe('episode markers and next episode', () => {
  it('reads intro and credits markers in seconds', async () => {
    answers['/library/metadata/11'] = meta([{
      ratingKey: '11', type: 'episode', title: 'Pilot', index: 1, parentIndex: 1, parentRatingKey: '10', grandparentRatingKey: '1', duration: 1_800_000,
      Marker: [{ type: 'intro', startTimeOffset: 30_000, endTimeOffset: 95_000 }, { type: 'credits', startTimeOffset: 1_740_000, endTimeOffset: 1_800_000 }],
    }]);
    const { getPlexEpisodeInfo } = await import('./plex');
    const info = await getPlexEpisodeInfo('http://pms', 't', '11');
    expect(info?.markers).toEqual([{ type: 'intro', start: 30, end: 95 }, { type: 'credits', start: 1740, end: 1800 }]);
    expect(info?.duration).toBe(1800);
  });

  it('is null for a movie', async () => {
    answers['/library/metadata/5'] = meta([{ ratingKey: '5', type: 'movie', title: 'Film' }]);
    const { getPlexEpisodeInfo } = await import('./plex');
    expect(await getPlexEpisodeInfo('http://pms', 't', '5')).toBeNull();
  });

  it('finds the next episode, then the next season, then nothing', async () => {
    answers['/library/metadata/10/children'] = meta([
      { ratingKey: '12', type: 'episode', title: 'Two', index: 2 },
      { ratingKey: '11', type: 'episode', title: 'Pilot', index: 1 },
    ]);
    answers['/library/metadata/1/children'] = meta([
      { ratingKey: '10', type: 'season', index: 1 },
      { ratingKey: '20', type: 'season', index: 2 },
    ]);
    answers['/library/metadata/20/children'] = meta([{ ratingKey: '21', type: 'episode', title: 'S2 opener', index: 1 }]);
    const { getNextPlexEpisode } = await import('./plex');
    const base = { title: '', markers: [], seasonKey: '10', showKey: '1', seasonIndex: 1 };
    expect((await getNextPlexEpisode('http://pms', 't', { ...base, ratingKey: '11', index: 1 }))?.ratingKey).toBe('12');
    const n = await getNextPlexEpisode('http://pms', 't', { ...base, ratingKey: '12', index: 2 });
    expect(n?.ratingKey).toBe('21');
    expect(n?.seasonIndex).toBe(2);
    answers['/library/metadata/20/children'] = meta([{ ratingKey: '21', type: 'episode', title: 'S2 opener', index: 1 }]);
    expect(await getNextPlexEpisode('http://pms', 't', { ...base, ratingKey: '21', index: 1, seasonKey: '20', seasonIndex: 2 })).toBeNull();
  });
});
