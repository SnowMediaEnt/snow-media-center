/**
 * Favorites in the viewer's own order, or A–Z (lib/favoritesOrder): new ones
 * go at the end, gone ones drop out, a re-linked one keeps its place, A–Z is
 * natural and case-blind, switching to A–Z and back keeps the own order,
 * moving goes along the list on screen, and each profile has its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arrangeFavorites,
  azOrder,
  favRefKey,
  favRefsOf,
  FAV_ORDER_EVENT,
  loadFavOrder,
  mineRefs,
  moveFavorite,
  saveFavOrder,
  withOtherLines,
  type FavOrder,
  type FavRef,
} from './favoritesOrder';
import { setViewerProfile } from './viewer';

const A = 'a.test|ann';
const B = 'b.test|bob';
const ref = (line: string, id: number, name: string): FavRef => ({ line, id, name });
const names = (list: FavRef[]) => list.map((r) => r.name);
const keysOf = (list: FavRef[]) => new Set(list.map((r) => favRefKey(r.line, r.id)));
const arrange = (items: FavRef[], order: FavOrder) => names(arrangeFavorites(items, order, (r) => r));

beforeEach(() => {
  localStorage.clear();
  setViewerProfile('main');
});

describe('the viewer’s own order', () => {
  const news = ref(A, 1, 'News');
  const sports = ref(A, 2, 'Sports');
  const movies = ref(A, 3, 'Movies');

  it('with nothing saved is the order they were added', () => {
    expect(arrange([news, sports, movies], { mode: 'mine', keys: [] })).toEqual(['News', 'Sports', 'Movies']);
  });

  it('follows the saved order; one added since (here or by the sync) goes at the end, in the order added', () => {
    const kids = ref(A, 4, 'Kids');
    const music = ref(A, 5, 'Music');
    const order: FavOrder = { mode: 'mine', keys: [movies, news, sports] };
    expect(arrange([news, kids, sports, movies, music], order)).toEqual(['Movies', 'News', 'Sports', 'Kids', 'Music']);
  });

  it('a favourite taken off is simply not shown, and its entry is gone the next time the order is saved', () => {
    const order: FavOrder = { mode: 'mine', keys: [movies, news, sports] };
    expect(arrange([news, movies], order)).toEqual(['Movies', 'News']);
    const next = mineRefs([news, movies], order.keys);
    saveFavOrder({ mode: 'mine', keys: next });
    expect(names(loadFavOrder().keys)).toEqual(['Movies', 'News']);
  });

  it('a favourite the provider re-linked (same name, new stream id) keeps its place', () => {
    const order: FavOrder = { mode: 'mine', keys: [movies, news, sports] };
    const relinked = ref(A, 99, 'news ');
    expect(arrange([relinked, sports, movies], order)).toEqual(['Movies', 'news ', 'Sports']);
    // Only on its own line: another service's channel of that name is new there.
    const otherLine = ref(B, 77, 'News');
    expect(arrange([otherLine, sports, movies], order)).toEqual(['Movies', 'Sports', 'News']);
  });

  it('one order for every line: each line’s list is the shared one with the others left out', () => {
    const vibez = ref(B, 1, 'Vibez Sports');
    const order: FavOrder = { mode: 'mine', keys: [sports, vibez, news] };
    expect(arrange([news, sports, vibez], order)).toEqual(['Sports', 'Vibez Sports', 'News']);
    expect(arrange([news, sports], order)).toEqual(['Sports', 'News']);
    expect(arrange([vibez], order)).toEqual(['Vibez Sports']);
  });

  it('two services can share a stream id: each is its own favourite', () => {
    const a7 = ref(A, 7, 'Alpha');
    const b7 = ref(B, 7, 'Beta');
    expect(arrange([a7, b7], { mode: 'mine', keys: [b7, a7] })).toEqual(['Beta', 'Alpha']);
  });
});

describe('A–Z', () => {
  it('is natural (Channel 2 before Channel 10) and ignores upper and lower case', () => {
    const list = ['channel 10', 'Channel 2', 'ESPN', 'abc News', 'Zee', 'Channel 1'].map((n, i) => ref(A, i + 1, n));
    expect(names(azOrder(list, (r) => r.name))).toEqual(['abc News', 'Channel 1', 'Channel 2', 'channel 10', 'ESPN', 'Zee']);
  });

  it('sorts by the name as shown (a prefix like "US:" counts), the same names keeping the viewer’s order', () => {
    const list = [ref(A, 1, 'US: ESPN'), ref(A, 2, 'ESPN'), ref(B, 3, 'espn'), ref(A, 4, 'Alpha')];
    // More than ten, so a sort that is not stable (Chromium 66's) would show.
    const filler = Array.from({ length: 12 }, (_, i) => ref(A, 100 + i, 'Same'));
    const order: FavOrder = { mode: 'az', keys: [list[2], ...filler.slice().reverse(), list[1]] };
    const got = arrangeFavorites([...list, ...filler], order, (r) => r);
    expect(names(got).slice(0, 3)).toEqual(['Alpha', 'espn', 'ESPN']);
    expect(got.slice(3, 15).map((r) => r.id)).toEqual(filler.slice().reverse().map((r) => r.id));
    expect(names(got)[15]).toBe('US: ESPN');
  });

  it('switching to A–Z keeps the own order; switching back shows it again', () => {
    const list = [ref(A, 1, 'Bravo'), ref(A, 2, 'Alpha'), ref(A, 3, 'Charlie')];
    saveFavOrder({ mode: 'mine', keys: [list[2], list[0], list[1]] });
    expect(arrange(list, loadFavOrder())).toEqual(['Charlie', 'Bravo', 'Alpha']);
    saveFavOrder({ ...loadFavOrder(), mode: 'az' });
    expect(arrange(list, loadFavOrder())).toEqual(['Alpha', 'Bravo', 'Charlie']);
    saveFavOrder({ ...loadFavOrder(), mode: 'mine' });
    expect(arrange(list, loadFavOrder())).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });
});

describe('moving one along the list on screen', () => {
  const a1 = ref(A, 1, 'A1');
  const b1 = ref(B, 1, 'B1');
  const a2 = ref(A, 2, 'A2');
  const a3 = ref(A, 3, 'A3');
  const all = [a1, b1, a2, a3];

  it('in "all services": one place, the other service’s favourites counting', () => {
    const r = moveFavorite(all, keysOf(all), favRefKey(A, 2), -1);
    expect(r && names(r.order)).toEqual(['A1', 'A2', 'B1', 'A3']);
    expect(r?.index).toBe(1);
  });

  it('in one service’s list: past its own neighbour, whatever sits between in the shared order', () => {
    const shown = keysOf([a1, a2, a3]);
    const r = moveFavorite(all, shown, favRefKey(A, 2), -1);
    expect(r && names(r.order)).toEqual(['A2', 'A1', 'B1', 'A3']);
    expect(r?.index).toBe(0);
    const down = moveFavorite(all, shown, favRefKey(A, 1), 1);
    expect(down && names(down.order)).toEqual(['B1', 'A2', 'A1', 'A3']);
    expect(down?.index).toBe(1);
  });

  it('several places at once (a row of the logo wall), held at the ends; never round to the other end', () => {
    const r = moveFavorite(all, keysOf(all), favRefKey(A, 1), 5);
    expect(r && names(r.order)).toEqual(['B1', 'A2', 'A3', 'A1']);
    expect(r?.index).toBe(3);
    expect(moveFavorite(all, keysOf(all), favRefKey(A, 1), -1)).toBeNull();
    expect(moveFavorite(all, keysOf(all), favRefKey(A, 3), 1)).toBeNull();
  });

  it('saving keeps what the order said about a service whose list is not loaded now', () => {
    const gone = ref('c.test|cy', 4, 'C4');
    const next = withOtherLines([a2, a1], [a1, gone, a2, b1], new Set([A, B]));
    expect(names(next)).toEqual(['A2', 'A1', 'C4']);
  });

  it('every line’s favourites, as added, line by line', () => {
    const favs = new Map([
      [A, new Map([[2, { stream_id: 2, name: 'A2' }], [1, { stream_id: 1, name: 'A1' }]])],
      [B, new Map([[1, { stream_id: 1, name: 'B1' }]])],
    ]);
    expect(names(favRefsOf([B, A], favs))).toEqual(['B1', 'A2', 'A1']);
  });
});

describe('kept per profile, on the box', () => {
  it('each profile has its own order and mode', () => {
    saveFavOrder({ mode: 'az', keys: [ref(A, 1, 'One')] });
    setViewerProfile('kid1');
    expect(loadFavOrder()).toEqual({ mode: 'mine', keys: [] });
    saveFavOrder({ mode: 'mine', keys: [ref(A, 2, 'Two')] });
    setViewerProfile('main');
    expect(loadFavOrder()).toEqual({ mode: 'az', keys: [ref(A, 1, 'One')] });
    setViewerProfile('kid1');
    expect(names(loadFavOrder().keys)).toEqual(['Two']);
  });

  it('a save the box will not keep (storage full) is still the order shown, until one that works', () => {
    saveFavOrder({ mode: 'mine', keys: [ref(A, 1, 'One'), ref(A, 2, 'Two')] });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    try {
      expect(saveFavOrder({ mode: 'mine', keys: [ref(A, 2, 'Two'), ref(A, 1, 'One')] })).toBe(false);
      // Not snapped back to the stored copy.
      expect(names(loadFavOrder().keys)).toEqual(['Two', 'One']);
    } finally {
      setItem.mockRestore();
    }
    expect(saveFavOrder({ mode: 'az', keys: [ref(A, 1, 'One')] })).toBe(true);
    expect(loadFavOrder()).toEqual({ mode: 'az', keys: [ref(A, 1, 'One')] });
    expect(JSON.parse(localStorage.getItem('snow-livetv-fav-order-v1:main') ?? '{}').mode).toBe('az');
  });

  it('a save tells every list on screen; a broken copy reads as no order at all', () => {
    let heard = 0;
    const on = () => { heard++; };
    window.addEventListener(FAV_ORDER_EVENT, on);
    saveFavOrder({ mode: 'mine', keys: [ref(A, 1, 'One'), ref(A, 1, 'One')] });
    window.removeEventListener(FAV_ORDER_EVENT, on);
    expect(heard).toBe(1);
    expect(loadFavOrder().keys).toHaveLength(1);
    localStorage.setItem('snow-livetv-fav-order-v1:main', '{not json');
    expect(loadFavOrder()).toEqual({ mode: 'mine', keys: [] });
  });
});
