import { beforeEach, describe, expect, it, vi } from 'vitest';

const seasons = [{ ratingKey: 'S0', title: 'Specials', index: 0 }, { ratingKey: 'S1', title: 'Season 1', index: 1 }, { ratingKey: 'S2', title: 'Season 2', index: 2 }];
const episodes: Record<string, Array<{ ratingKey: string; title: string; index: number }>> = {
  S0: [{ ratingKey: 'x', title: 'Special', index: 1 }],
  S1: [{ ratingKey: 'e1', title: 'One', index: 1 }, { ratingKey: 'e2', title: 'Two', index: 2 }],
  S2: [{ ratingKey: 'f1', title: 'New Season', index: 1 }],
};
const calls = { seasons: 0 };
vi.mock('@/lib/plex', () => ({
  getPlexSeasons: async () => { calls.seasons += 1; return seasons; },
  getPlexEpisodes: async (_b: string, _t: string, key: string) => episodes[key] ?? [],
}));

beforeEach(async () => { (await import('./plexUpNext')).__resetUpNextForTests(); calls.seasons = 0; });

describe('plexUpNext', () => {
  it('gives the next episode, then the next season, then nothing at the end', async () => {
    const { nextEpisode } = await import('./plexUpNext');
    const show = { showKey: 'SH', showTitle: 'Show', season: 1, index: 1, t: 5 };
    expect((await nextEpisode('b', 't', show))?.ratingKey).toBe('e2');
    const e = await nextEpisode('b', 't', { ...show, index: 2 });
    expect([e?.ratingKey, e?.parentIndex, e?.index, e?.thumb, e?.lastViewedAt]).toEqual(['f1', 2, 1, '/library/metadata/SH/thumb', 5]);
    expect(await nextEpisode('b', 't', { ...show, season: 2, index: 1 })).toBeNull();
  });

  it('asks the server once per finished episode', async () => {
    const { nextEpisode } = await import('./plexUpNext');
    const show = { showKey: 'SH', season: 1, index: 1, t: 5 };
    await nextEpisode('b', 't', show);
    await nextEpisode('b', 't', show);
    expect(calls.seasons).toBe(1);
  });
});
