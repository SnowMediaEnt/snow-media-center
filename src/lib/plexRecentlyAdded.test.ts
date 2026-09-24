import { describe, expect, it } from 'vitest';
import { foldRecentlyAdded, newestAdded, type PlexItem } from './plex';

const it_ = (ratingKey: string, addedAt?: number, type = 'movie'): PlexItem => ({ ratingKey, title: ratingKey, type, addedAt } as PlexItem);

describe('Recently Added', () => {
  it('merges the server-wide list with each library by date added, newest first, each once', () => {
    const serverWide = [it_('old-film', 1000), it_('show-a', 2000, 'show')];
    const perLibrary = [it_('new-download', 5000), it_('show-a', 6000, 'show'), it_('undated')];
    expect(newestAdded([serverWide, perLibrary]).map((i) => i.ratingKey)).toEqual(['show-a', 'new-download', 'old-film', 'undated']);
  });

  it("a new episode brings its series forward, dated by the episode's addition", () => {
    const folded = foldRecentlyAdded([
      { type: 'episode', ratingKey: 'e9', title: 'Ep 9', grandparentRatingKey: 'S1', grandparentTitle: 'The Show', addedAt: 1_700_000_000 },
      { type: 'episode', ratingKey: 'e8', title: 'Ep 8', grandparentRatingKey: 'S1', grandparentTitle: 'The Show', addedAt: 1_600_000_000 },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ ratingKey: 'S1', type: 'show', title: 'The Show', addedAt: 1_700_000_000_000 });
  });

  it('caps the row', () => {
    const many = Array.from({ length: 80 }, (_, i) => it_(`m${i}`, i));
    expect(newestAdded([many], 30)).toHaveLength(30);
  });
});
