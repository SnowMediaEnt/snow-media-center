// Live TV › Search: adult channels never show, whatever is typed ("NC" brought
// up channels from the adult categories), hidden categories stay out, and
// names starting with the letters come first. Invented names only.
import { afterEach, describe, expect, it } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';
import { leftOutOfSearch, searchLiveChannels, type LiveSearchLine } from './liveSearch';
import { adultCategoryIds } from './adultSearch';
import { setKidsLevel } from './kidsFilter';

const ch = (stream_id: number, name: string, category_id: string, extra: Partial<XtreamLiveStream> = {}): XtreamLiveStream =>
  ({ stream_id, name, category_id, ...extra });

const CATS = [
  { category_id: '1', category_name: 'News' },
  { category_id: '2', category_name: 'Regional' },
  { category_id: '9', category_name: 'XXX | For Adults' },
  { category_id: '7', category_name: 'Late Night', is_adult: '1' },
];
const LIST: XtreamLiveStream[] = [
  ch(1, 'Bounce Central', '2'),            // "nc" inside a word
  ch(2, 'Hot Encounters', '9'),            // adult category
  ch(3, 'US | NC Harbor News', '1'),       // a word starts with it
  ch(4, 'NC | Pinecrest Weather', '2'),    // starts with it
  ch(5, 'Velvet Encore', '7'),             // panel-flagged adult category
  ch(6, 'Moonlit NC XXX', '2'),            // its own name says adult
  ch(7, 'Encounter Flagged', '1', { is_adult: 1 } as Partial<XtreamLiveStream>),
];
const line = (extra: Partial<LiveSearchLine> = {}): LiveSearchLine => ({ list: LIST, adultCats: adultCategoryIds(CATS), ...extra });
const names = (list: XtreamLiveStream[]) => list.map((s) => s.name);

afterEach(() => { setKidsLevel(null); });

describe('Live TV search', () => {
  it('"NC": no adult channel, whichever way it is adult; names starting with NC first', () => {
    const got = names(searchLiveChannels('NC', [line()]));
    expect(got).toEqual(['NC | Pinecrest Weather', 'US | NC Harbor News', 'Bounce Central']);
  });

  it('typing "xxx", "adult" or "18+" finds no adult channel either', () => {
    const list = [...LIST, ch(8, 'Adult Lounge', '9'), ch(9, 'Midnight 18+', '2'), ch(10, 'Adults Only Hour', '1')];
    expect(searchLiveChannels('xxx', [line({ list })])).toEqual([]);
    expect(searchLiveChannels('adult', [line({ list })])).toEqual([]);
    expect(searchLiveChannels('18+', [line({ list })])).toEqual([]);
    expect(searchLiveChannels('encounters', [line({ list })])).toEqual([]);
    expect(searchLiveChannels('velvet', [line({ list })])).toEqual([]);
  });

  it('the same on a Kids profile', () => {
    setKidsLevel('teen');
    expect(searchLiveChannels('xxx', [line()])).toEqual([]);
    expect(names(searchLiveChannels('nc', [line()]))).not.toContain('Hot Encounters');
  });

  it('a category hidden in Hide Categories is not found either', () => {
    const got = names(searchLiveChannels('nc', [line({ hidden: new Set(['2']) })]));
    expect(got).toEqual(['US | NC Harbor News']);
  });

  it('searches every line, keeps each group in line-up order, and stops at the limit', () => {
    const other: LiveSearchLine = { list: [ch(11, 'NC Second Line', '1'), ch(12, 'Lance View', '1')] };
    expect(names(searchLiveChannels('nc', [line(), other]))).toEqual([
      'NC | Pinecrest Weather', 'NC Second Line', 'US | NC Harbor News', 'Bounce Central', 'Lance View',
    ]);
    expect(searchLiveChannels('nc', [line(), other], 2)).toHaveLength(2);
    expect(searchLiveChannels('  ', [line()])).toEqual([]);
  });

  it('leftOutOfSearch: what a channel asked for by name skips too', () => {
    const l = line({ hidden: new Set(['2']) });
    expect(leftOutOfSearch(LIST[1], l)).toBe(true);  // adult category
    expect(leftOutOfSearch(LIST[0], l)).toBe(true);  // hidden category
    expect(leftOutOfSearch(LIST[2], l)).toBe(false);
  });
});
