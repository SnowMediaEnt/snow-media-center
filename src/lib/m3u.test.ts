// An outside service added as an M3U link (lib/m3u): the playlist's groups
// are Live TV's categories, its live entries the channels, each playing from
// its own address. Movies and series are left out, and the reader copes with
// what real playlists look like (quotes, BOMs, CRLF, #EXTGRP, no groups).
// HTTP is mocked: no request ever leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  native: true,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => (h.native ? 'android' : 'web') },
  CapacitorHttp: { get: h.get },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));

import { M3uError, isVodUrl, parseM3u } from './m3u';
import {
  bumpXtreamRefresh,
  buildLiveStreamUrl,
  buildNativeLiveUrl,
  clearLiveCatalogue,
  countLiveStreams,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  type XtreamCreds,
} from './xtream';
import { setKidsLevel } from './kidsFilter';

const PLAYLIST = [
  '#EXTM3U x-tvg-url="http://epg.example/guide.xml"',
  '#EXTINF:-1 tvg-id="news.one" tvg-name="News One" tvg-logo="http://img.example/n1.png" group-title="News",News One HD',
  'http://cdn.example/live/u/p/101.ts',
  '#EXTINF:-1 tvg-id=\'sport.one\' tvg-logo=http://img.example/s1.png group-title="Sports, UK",Sport One',
  '#EXTVLCOPT:http-user-agent=Something',
  'http://cdn.example/live/u/p/201.m3u8',
  '#EXTINF:-1,Plain Channel',
  '#EXTGRP:Music',
  'http://cdn.example/live/u/p/301.ts',
  '#EXTINF:-1 tvg-name="No Group",',
  'http://cdn.example/live/u/p/401.ts',
  '#EXTINF:-1 group-title="Movies: Action",Some Film (2020)',
  'http://cdn.example/movie/u/p/9001.mp4',
  '#EXTINF:-1 group-title="Series",Some Show S01E01',
  'http://cdn.example/series/u/p/9101.mkv',
  '#EXTINF:-1 group-title="Films",A Film File',
  'http://files.example/films/a-film.avi?token=1',
].join('\n');

describe('reading a playlist', () => {
  it('reads attributes in double, single and no quotes, and the title after the first comma outside quotes', () => {
    const p = parseM3u(PLAYLIST);
    const names = p.streams.map((s) => s.name);
    expect(names).toEqual(['News One HD', 'Sport One', 'Plain Channel', 'No Group']);
    const news = p.streams[0];
    expect(news.stream_icon).toBe('http://img.example/n1.png');
    expect(news.epg_channel_id).toBe('news.one');
    expect(news.stream_type).toBe('live');
    const sport = p.streams[1];
    expect(sport.epg_channel_id).toBe('sport.one');
    expect(sport.stream_icon).toBe('http://img.example/s1.png');
  });

  it('makes categories of the groups: group-title (commas and all), #EXTGRP, and "Other" for none', () => {
    const p = parseM3u(PLAYLIST, { otherGroup: 'Other' });
    expect(p.categories.map((c) => c.category_name)).toEqual(['News', 'Sports, UK', 'Music', 'Other']);
    const byName = new Map(p.categories.map((c) => [c.category_name, c.category_id]));
    expect(p.streams[2].category_id).toBe(byName.get('Music'));
    expect(p.streams[3].category_id).toBe(byName.get('Other'));
    expect(p.byCat.get(byName.get('News')!)!.map((s) => s.name)).toEqual(['News One HD']);
  });

  it('leaves movies and series out (/movie/, /series/, video files) and counts them', () => {
    const p = parseM3u(PLAYLIST);
    expect(p.skippedVod).toBe(3);
    expect(p.categories.map((c) => c.category_name)).not.toContain('Series');
    expect(isVodUrl('http://x.example/live/u/p/1.ts')).toBe(false);
    expect(isVodUrl('http://x.example/movie/u/p/1.mkv')).toBe(true);
    expect(isVodUrl('http://x.example/clip.MP4?x=1')).toBe(true);
  });

  it('gives every entry a stable id from its address, so favourites survive a reload', () => {
    const a = parseM3u(PLAYLIST);
    // Same channels, another order and other groups: the ids follow the addresses.
    const shuffled = parseM3u([
      '#EXTM3U',
      '#EXTINF:-1 group-title="Elsewhere",Sport One',
      'http://cdn.example/live/u/p/201.m3u8',
      '#EXTINF:-1,News One HD',
      'http://cdn.example/live/u/p/101.ts',
    ].join('\n'));
    const idOf = (list: typeof a.streams, name: string) => list.find((s) => s.name === name)!.stream_id;
    expect(idOf(shuffled.streams, 'News One HD')).toBe(idOf(a.streams, 'News One HD'));
    expect(idOf(shuffled.streams, 'Sport One')).toBe(idOf(a.streams, 'Sport One'));
    for (const s of a.streams) {
      expect(Number.isInteger(s.stream_id)).toBe(true);
      expect(s.stream_id).toBeGreaterThan(0);
      expect(s.stream_id).toBeLessThanOrEqual(0x7fffffff);
    }
    expect(new Set(a.streams.map((s) => s.stream_id)).size).toBe(a.streams.length);
    // The same address twice (one channel in two groups) still gets two ids.
    const twice = parseM3u('#EXTM3U\n#EXTINF:-1 group-title="A",X\nhttp://c.example/1.ts\n#EXTINF:-1 group-title="B",X\nhttp://c.example/1.ts\n');
    expect(new Set(twice.streams.map((s) => s.stream_id)).size).toBe(2);
    expect(twice.urls.get(twice.streams[1].stream_id)).toBe('http://c.example/1.ts');
  });

  it('copes with a byte-order mark, CRLF and old CR-only line endings', () => {
    const crlf = `\uFEFF${PLAYLIST.split('\n').join('\r\n')}\r\n`;
    expect(parseM3u(crlf).streams.map((s) => s.name)).toEqual(['News One HD', 'Sport One', 'Plain Channel', 'No Group']);
    const latin1Bom = `\u00EF\u00BB\u00BF${PLAYLIST}`;
    expect(parseM3u(latin1Bom).streams).toHaveLength(4);
    const cr = PLAYLIST.split('\n').join('\r');
    expect(parseM3u(cr).streams).toHaveLength(4);
  });

  it('takes the channel number from tvg-chno when there is one', () => {
    const p = parseM3u('#EXTM3U\n#EXTINF:-1 tvg-chno="42",Forty Two\nhttp://c.example/42.ts\n#EXTINF:-1,Next\nhttp://c.example/43.ts\n');
    expect(p.streams.map((s) => s.num)).toEqual([42, 2]);
  });

  it('stops at the cap and says the rest was left out', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 10; i++) lines.push(`#EXTINF:-1,Ch ${i}`, `http://c.example/${i}.ts`);
    const p = parseM3u(lines.join('\n'), { maxEntries: 4 });
    expect(p.streams).toHaveLength(4);
    expect(p.truncated).toBe(true);
  });

  it.each([
    ['a web page', '<!DOCTYPE html><html><body>Login</body></html>'],
    ['JSON', '{"user_info":{"auth":0}}'],
    ['one HLS stream', '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nseg1.ts\n'],
    ['plain text', 'hello there\nnothing here'],
  ])('refuses %s: it is not a channel list', (_l, text) => {
    expect(() => parseM3u(text)).toThrow(M3uError);
  });

  it('an empty playlist (or only movies) is a playlist with no channels', () => {
    expect(parseM3u('#EXTM3U\n').streams).toEqual([]);
    expect(parseM3u('#EXTM3U\n#EXTINF:-1,Film\nhttp://c.example/movie/1.mp4\n').streams).toEqual([]);
  });
});

describe('Live TV reads an M3U line through xtream.ts', () => {
  const PL_URL = 'http://lists.example/my.m3u?token=abc';
  const line = (): XtreamCreds => ({
    host: 'http://lists.example', username: 'm3u-1234abcd', password: '', output: 'm3u8', serverLabel: 'My Box', outside: true, m3u: PL_URL,
  });

  beforeEach(() => {
    h.get.mockReset();
    h.invoke.mockReset();
    h.native = true;
    setKidsLevel(null);
    bumpXtreamRefresh();
    h.get.mockResolvedValue({ status: 200, data: PLAYLIST, headers: {} });
  });
  afterEach(() => { setKidsLevel(null); bumpXtreamRefresh(); });

  it('categories, channels and counts come from ONE download of the playlist, straight from the provider', async () => {
    const c = line();
    const cats = await getLiveCategories(c);
    expect(cats.map((x) => x.category_name)).toEqual(['News', 'Sports, UK', 'Music', 'Other']);
    const news = await getLiveStreams(c, cats[0].category_id);
    expect(news.map((s) => s.name)).toEqual(['News One HD']);
    expect((await getLiveStreams(c)).length).toBe(4);
    const counted = await countLiveStreams(c);
    expect(counted.total).toBe(4);
    expect(counted.byCat[cats[0].category_id]).toBe(1);
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get.mock.calls[0][0].url).toBe(PL_URL);
    expect(h.get.mock.calls[0][0].responseType).toBe('text');
    // Never through Snow Media.
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('plays each entry from its own address (no .ts swap); no guide', async () => {
    const c = line();
    const [news, sport] = await getLiveStreams(c);
    expect(buildNativeLiveUrl(c, news.stream_id)).toBe('http://cdn.example/live/u/p/101.ts');
    expect(buildNativeLiveUrl(c, sport.stream_id)).toBe('http://cdn.example/live/u/p/201.m3u8');
    expect(buildLiveStreamUrl(c, sport.stream_id)).toBe('http://cdn.example/live/u/p/201.m3u8');
    expect(buildLiveStreamUrl(c, 12345)).toBe('');
    expect(await getShortEpg(c, news.stream_id)).toEqual({ epg_listings: [] });
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('"Update Channels" (the refresh) reads the playlist again', async () => {
    const c = line();
    await getLiveCategories(c);
    bumpXtreamRefresh();
    await getLiveCategories(c);
    expect(h.get).toHaveBeenCalledTimes(2);
  });

  it('the channel playing through "Update Channels" keeps its address until the new copy is in; leaving Live TV drops it', async () => {
    const c = line();
    const [news] = await getLiveStreams(c);
    let release: () => void = () => {};
    h.get.mockImplementationOnce(() => new Promise((r) => { release = () => r({ status: 200, data: PLAYLIST }); }));
    bumpXtreamRefresh();
    const again = getLiveCategories(c);
    await vi.waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    expect(buildNativeLiveUrl(c, news.stream_id)).toBe('http://cdn.example/live/u/p/101.ts');
    release();
    await again;
    expect(buildNativeLiveUrl(c, news.stream_id)).toBe('http://cdn.example/live/u/p/101.ts');
    // Leaving Live TV (Plex, closing the Player) lets the whole playlist go.
    clearLiveCatalogue();
    expect(buildNativeLiveUrl(c, news.stream_id)).toBe('');
  });

  it('a failed read is not kept: the next ask tries again', async () => {
    h.get.mockResolvedValueOnce({ status: 403, data: '' });
    await expect(getLiveCategories(line())).rejects.toThrow('HTTP 403');
    expect((await getLiveCategories(line())).length).toBe(4);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('a Kids profile sees only the kids categories of the playlist, as with any line', async () => {
    h.get.mockResolvedValue({
      status: 200,
      data: '#EXTM3U\n#EXTINF:-1 group-title="Kids",Cartoon Fun\nhttp://c.example/k1.ts\n#EXTINF:-1 group-title="News",Grown-up News\nhttp://c.example/n1.ts\n',
    });
    setKidsLevel('kids');
    const c = line();
    expect((await getLiveCategories(c)).map((x) => x.category_name)).toEqual(['Kids']);
    expect((await getLiveStreams(c)).map((s) => s.name)).toEqual(['Cartoon Fun']);
    expect((await countLiveStreams(c)).total).toBe(1);
  });
});
