import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setKidsLevel } from './kidsFilter';
import { bumpXtreamRefresh, getSeries, getSeriesCategories, getVodCategories, getVodStreams, type XtreamCreds } from './xtream';

// A provider panel: two categories, one of them for children.
const CATS = [{ category_id: '1', category_name: 'Kids Movies' }, { category_id: '2', category_name: 'Action' }];
const ITEMS = [{ name: 'Cars', category_id: '1' }, { name: 'Die Hard', category_id: '2' }];
let failCategories = false;
const fetchMock = vi.fn(async (url: string) => {
  const action = new URL(url).searchParams.get('action') ?? '';
  if (failCategories && action.endsWith('_categories')) return { ok: false, status: 429, json: async () => null };
  const cat = new URL(url).searchParams.get('category_id');
  const body = action.endsWith('_categories') ? CATS : ITEMS.filter((it) => !cat || it.category_id === cat);
  return { ok: true, status: 200, json: async () => body };
});
const calls = (action: string) => fetchMock.mock.calls.filter(([u]) => new URL(String(u)).searchParams.get('action') === action).length;

let n = 0;
const line = (): XtreamCreds => ({ host: `http://panel${++n}.test`, username: 'u', password: 'p' } as unknown as XtreamCreds);

beforeEach(() => {
  fetchMock.mockClear();
  failCategories = false;
  vi.stubGlobal('fetch', fetchMock);
  setKidsLevel('kids');
});
afterEach(() => { setKidsLevel(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('movie and series category lists on a Kids profile', () => {
  it('are fetched once for the sidebar and every movie list opened after it', async () => {
    const c = line();
    expect((await getVodCategories(c)).map((x) => x.category_name)).toEqual(['Kids Movies']);
    expect((await getVodStreams(c, '1')).map((x) => x.name)).toEqual(['Cars']);
    expect((await getVodStreams(c, '2')).map((x) => x.name)).toEqual([]);
    expect((await getVodStreams(c)).map((x) => x.name)).toEqual(['Cars']);
    expect(calls('get_vod_categories')).toBe(1);
    expect(calls('get_vod_streams')).toBe(3);
  });

  it('series too', async () => {
    const c = line();
    await getSeriesCategories(c);
    expect((await getSeries(c)).map((x) => x.name)).toEqual(['Cars']);
    await getSeries(c, '1');
    expect(calls('get_series_categories')).toBe(1);
  });

  it('Update Channels and a few minutes both mean a fresh list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const c = line();
    await getVodStreams(c);
    await getVodStreams(c);
    expect(calls('get_vod_categories')).toBe(1);
    bumpXtreamRefresh();
    await getVodStreams(c);
    expect(calls('get_vod_categories')).toBe(2);
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    await getVodStreams(c);
    expect(calls('get_vod_categories')).toBe(3);
  });

  it('does not keep a failed request', async () => {
    const c = line();
    failCategories = true;
    await expect(getVodCategories(c)).rejects.toThrow('HTTP 429');
    failCategories = false;
    expect((await getVodCategories(c)).map((x) => x.category_name)).toEqual(['Kids Movies']);
    expect(calls('get_vod_categories')).toBe(2);
  });
});
