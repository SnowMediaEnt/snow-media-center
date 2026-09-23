import { describe, expect, it } from 'vitest';

const d = (m: number, day: number) => new Date(2026, m - 1, day, 12);

describe('activeSeason', () => {
  it('is Halloween from Sep 20 through Nov 2', () => {
    expect(activeSeason(d(9, 20))?.id).toBe('halloween');
    expect(activeSeason(d(10, 31))?.id).toBe('halloween');
    expect(activeSeason(d(11, 2))?.id).toBe('halloween');
  });
  it('is nothing outside it', () => {
    expect(activeSeason(d(9, 19))).toBeNull();
    expect(activeSeason(d(11, 3))).toBeNull();
    expect(activeSeason(d(7, 4))).toBeNull();
  });
});

import { activeSeason, loadSeasonRows, matches, normTitle, type Season } from './plexSeasonal';
import type { PlexItem } from '@/lib/plex';

describe('normTitle / matches', () => {
  it('ignores case, punctuation, leading articles and &', () => {
    expect(normTitle('The Addams Family')).toBe(normTitle('Addams Family'));
    expect(normTitle("Trick 'r Treat")).toBe(normTitle('Trick r Treat'));
    expect(normTitle('Wendell & Wild')).toBe(normTitle('Wendell and Wild'));
  });
  it('tells remakes and kinds apart', () => {
    const h78 = { ratingKey: '1', title: 'Halloween', type: 'movie', year: 1978 } as PlexItem;
    expect(matches(h78, { t: 'Halloween', y: 1978 })).toBe(true);
    expect(matches(h78, { t: 'Halloween', y: 2018 })).toBe(false);
    expect(matches(h78, { t: 'Halloween', y: 1978, s: true })).toBe(false);
  });
});

describe('loadSeasonRows', () => {
  const lib = (key: string) => ({ key, title: key, type: 'movie' });
  const item = (ratingKey: string, title: string, year: number, sec = '1'): PlexItem =>
    ({ ratingKey, title, year, type: 'movie', librarySectionID: sec });
  const season: Season = {
    id: 'halloween', title: 'Halloween', from: [9, 20], to: [11, 2],
    rows: [
      { id: 'a', title: 'A', items: [{ t: 'Halloween', y: 1978 }, { t: 'Halloween II', y: 1981 }, { t: 'Missing', y: 2000 }] },
      { id: 'b', title: 'B', items: [{ t: 'Halloween', y: 2018 }, { t: 'Hidden', y: 2001 }] },
    ],
  };
  it('keeps list order, skips missing and hidden-library titles, reuses earlier searches', async () => {
    const server: Record<string, PlexItem[]> = {
      Halloween: [item('2', 'Halloween II', 1981), item('1', 'Halloween', 1978), item('3', 'Halloween', 2018)],
      Hidden: [item('9', 'Hidden', 2001, '7')],
    };
    const asked: string[] = [];
    const got: Record<string, string[]> = {};
    await loadSeasonRows('b', 't', [lib('1')], season,
      (r, items) => { got[r.id] = items.map((i) => i.ratingKey); }, () => false, () => false,
      async (q) => { asked.push(q); return server[q] ?? []; });
    expect(got).toEqual({ a: ['1', '2'], b: ['3'] });
    expect(asked.sort()).toEqual(['Halloween', 'Hidden', 'Missing']);
  });
});
