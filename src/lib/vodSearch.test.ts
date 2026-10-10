// Movies › Search and Series › Search never show adult titles, as Live TV's
// search never shows adult channels: a title the panel flags, one in an
// adult category, one whose own name says so; whatever is typed, "xxx" and
// "adult" included. Invented names only.
import { describe, expect, it } from 'vitest';
import { searchVodTitles } from './vodSearch';

const CATS = [{ category_id: '1', category_name: 'Drama' }, { category_id: '9', category_name: 'For Adults' }];
const MOVIES = [
  { stream_id: 1, name: 'Encore Harbor', category_id: '1' },
  { stream_id: 2, name: 'Encounters After Dark', category_id: '9' },
  { stream_id: 3, name: 'Encore XXX Night', category_id: '1' },
  { stream_id: 4, name: 'Encore Flagged', category_id: '1', is_adult: '1' },
  { stream_id: 5, name: 'Encore Summit', category_id: '2' },
];
const names = (l: { name: string }[]) => l.map((m) => m.name);

describe('Movies / Series search', () => {
  it('"enc": the titles with the letters, no adult one, whichever way it is adult', () => {
    expect(names(searchVodTitles('enc', MOVIES, CATS))).toEqual(['Encore Harbor', 'Encore Summit']);
  });

  it('"xxx", "adult", "after dark": nothing adult', () => {
    for (const q of ['xxx', 'adult', 'after dark', 'flagged']) expect(searchVodTitles(q, MOVIES, CATS)).toEqual([]);
  });

  it('nothing typed, no catalogue yet, or past the limit', () => {
    expect(searchVodTitles('  ', MOVIES, CATS)).toEqual([]);
    expect(searchVodTitles('enc', null, CATS)).toEqual([]);
    expect(searchVodTitles('enc', MOVIES, CATS, 1)).toHaveLength(1);
  });
});
