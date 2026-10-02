import { describe, expect, it } from 'vitest';
import { nextEpisode, seriesSeasons } from './xtreamSeasons';
import type { XtreamEpisode, XtreamSeriesInfo } from './xtream';

const ep = (id: string, n: number | string, extra: Record<string, unknown> = {}): XtreamEpisode =>
  ({ id, episode_num: n, title: `E${n}`, container_extension: 'mp4', ...extra }) as XtreamEpisode;

describe('seriesSeasons', () => {
  it('builds the seasons from the episodes when the panel sends no seasons', () => {
    const s = seriesSeasons({ episodes: { '2': [ep('b', 1)], '1': [ep('a', 1)] } });
    expect(s.map((x) => x.number)).toEqual([1, 2]);
    expect(s[0].episodes.map((e) => e.id)).toEqual(['a']);
  });

  it('skips listed seasons with no episodes, keeps their names otherwise', () => {
    const info: XtreamSeriesInfo = {
      seasons: [{ season_number: 0, name: 'Specials' }, { season_number: 1, name: 'The First' }],
      episodes: { '1': [ep('a', 1)] },
    };
    expect(seriesSeasons(info)).toEqual([{ number: 1, name: 'The First', episodes: [ep('a', 1)] }]);
  });

  it('orders episodes by number, the unnumbered last in the panel order', () => {
    const s = seriesSeasons({ episodes: { '1': [ep('c', 3), ep('x', 'bonus'), ep('a', '1'), ep('b', 2)] } });
    expect(s[0].episodes.map((e) => e.id)).toEqual(['a', 'b', 'c', 'x']);
  });

  it('an array of episodes goes by each episode\'s own season', () => {
    const info = { episodes: [[ep('a', 1, { season: 1 })], [ep('b', 1, { season: 3 }), ep('c', 2, { season: '3' })]] } as unknown as XtreamSeriesInfo;
    const s = seriesSeasons(info);
    expect(s.map((x) => x.number)).toEqual([1, 3]);
    expect(s[1].episodes.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('nothing to show: no info, empty or broken episodes', () => {
    expect(seriesSeasons(null)).toEqual([]);
    expect(seriesSeasons({})).toEqual([]);
    expect(seriesSeasons({ episodes: { '1': null as unknown as XtreamEpisode[] } })).toEqual([]);
  });
});

describe('nextEpisode', () => {
  const seasons = seriesSeasons({ episodes: { '1': [ep('a', 1), ep('b', 2)], '2': [ep('c', 1)] } });
  it('the next in the season, then the next season, then nothing', () => {
    expect(nextEpisode(seasons, 0, 0)).toEqual({ season: 0, episode: 1 });
    expect(nextEpisode(seasons, 0, 1)).toEqual({ season: 1, episode: 0 });
    expect(nextEpisode(seasons, 1, 0)).toBeNull();
  });
});
