import { afterEach, describe, expect, it } from 'vitest';
import { foldRecentlyAdded } from './plex';
import { setKidsLevel } from './kidsFilter';

afterEach(() => setKidsLevel(null));

// As /library/recentlyAdded lists them: newest first, TV additions named by
// their season, or by a lone episode.
const raw = [
  { ratingKey: 's12', type: 'season', title: 'Season 2', parentRatingKey: 'show1', parentTitle: 'Bluey', parentThumb: '/show1/thumb', librarySectionID: 2 },
  { ratingKey: 'm1', type: 'movie', title: 'Toy Story 5', year: 2026, thumb: '/m1/thumb', contentRating: 'G', librarySectionID: 1 },
  { ratingKey: 'e9', type: 'episode', title: 'Pilot', grandparentRatingKey: 'show2', grandparentTitle: 'Severance', grandparentThumb: '/show2/thumb', contentRating: 'TV-MA', librarySectionID: 2 },
  { ratingKey: 's11', type: 'season', title: 'Season 1', parentRatingKey: 'show1', parentTitle: 'Bluey', parentThumb: '/show1/thumb', librarySectionID: 2 },
  { ratingKey: 'm2', type: 'movie', title: 'Deadpool', year: 2016, thumb: '/m2/thumb', contentRating: 'R', librarySectionID: 1 },
  { ratingKey: 'e10', type: 'episode', title: 'Ep 3', grandparentRatingKey: 'show3', grandparentTitle: 'Bluey Minisodes', grandparentThumb: '/show3/thumb', contentRating: 'TV-Y', librarySectionID: 2 },
];

describe('foldRecentlyAdded', () => {
  it('keeps films and folds each season or episode into its show, once, newest first', () => {
    const out = foldRecentlyAdded(raw);
    expect(out.map((it) => `${it.type}:${it.ratingKey}:${it.title}`)).toEqual([
      'show:show1:Bluey', 'movie:m1:Toy Story 5', 'show:show2:Severance', 'movie:m2:Deadpool', 'show:show3:Bluey Minisodes',
    ]);
    // The show's poster, not a season's or an episode's still.
    expect(out[0].thumb).toBe('/show1/thumb');
    expect(out[2].thumb).toBe('/show2/thumb');
    expect(out[0].librarySectionID).toBe('2');
  });

  it('on a Kids profile keeps only what a certificate allows — a show from a season has none', () => {
    setKidsLevel('little');
    expect(foldRecentlyAdded(raw).map((it) => it.ratingKey)).toEqual(['m1', 'show3']);
  });
});
