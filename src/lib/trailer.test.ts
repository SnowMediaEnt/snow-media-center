/**
 * A title's trailer (Tronix 78d8b7d, 13015b8, 1039497): the panel's trailer
 * field made into a video id (a bare id, a watch / short / embed link;
 * anything else is none), the search used without one ("<title> <year>
 * trailer"), the embed's address, and how it opens: a video inside the app
 * (the page's layer), a search outside (AppManager.openUrl: the video app's
 * own link first on Android, then the web page), one open per press, the
 * viewer told when nothing could open it, and nothing at all on a Kids profile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', async (orig) => {
  const real = await orig<typeof import('@capacitor/core')>();
  return { ...real, Capacitor: { ...real.Capacitor, isNativePlatform: () => h.native } };
});
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { openUrl: vi.fn() } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import { AppManager } from '@/capacitor/AppManager';
import { toast } from '@/hooks/use-toast';
import { setKidsLevel } from '@/lib/kidsFilter';
import {
  TRAILER_EMBED_ORIGINS, __resetTrailerForTests, movieTrailer, openTrailer, openTrailerOutside, seriesTrailer,
  trailerEmbedUrl, trailerIdOf, trailerSearchQuery, trailerTarget, trailerTitle, trailerWebUrl, trailerYear,
} from '@/lib/trailer';
import type { XtreamSeries } from '@/lib/xtream';

const ID = 'Ab3_dE-9xYz';
const openUrl = vi.mocked(AppManager.openUrl);

describe('trailerIdOf: the panel\'s trailer field', () => {
  it.each([
    [ID],
    [`  ${ID}\n`],
    [`https://www.youtube.com/watch?v=${ID}`],
    [`http://youtube.com/watch?v=${ID}&t=30s`],
    [`https://m.youtube.com/watch?feature=share&v=${ID}`],
    [`youtube.com/watch?v=${ID}`],
    [`www.youtube.com/watch?v=${ID}#t=10`],
    [`https://youtu.be/${ID}`],
    [`youtu.be/${ID}?t=5`],
    [`https://www.youtube.com/embed/${ID}?autoplay=1`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/v/${ID}`],
  ])('%s → the id', (raw) => {
    expect(trailerIdOf(raw)).toBe(ID);
  });

  it.each([
    [''], ['   '], ['null'], ['0'], ['N/A'], ['none'],
    ['Ab3_dE-9xY'], // 10 characters
    ['Ab3_dE-9xYz0'], // 12
    ['Ab3 dE-9xYz'],
    ['https://www.youtube.com/watch?v=short'],
    [`https://www.youtube.com/watch?v=${ID}0`],
    ['https://www.youtube.com/@somechannel'],
    ['https://www.youtube.com/results?search_query=harbor+lights'],
    [`https://videos.example.test/watch?v=${ID}`],
    [`https://youtube.com.example.test/watch?v=${ID}`],
    [`javascript:alert(1)//${ID}`],
    ['<script>alert(1)</script>'],
    [`${'x'.repeat(400)}`],
  ])('%s → none', (raw) => {
    expect(trailerIdOf(raw)).toBeNull();
  });

  it('a field that is not text is none', () => {
    for (const raw of [null, undefined, 0, 12345678901, {}, [ID], true]) expect(trailerIdOf(raw)).toBeNull();
  });
});

describe('the search used without a video', () => {
  it('a name as a person would type it: no provider tags, brackets, years in brackets or quality marks', () => {
    expect(trailerTitle('EN - Harbor Lights (2005) [4K]')).toBe('Harbor Lights');
    expect(trailerTitle('|EN| Harbor Lights')).toBe('Harbor Lights');
    expect(trailerTitle('[MULTI] FR | Les Étoiles du Nord')).toBe('Les Étoiles du Nord');
    expect(trailerTitle('4K| Night Ferry 1080p')).toBe('Night Ferry');
    expect(trailerTitle('Night Ferry - 2011')).toBe('Night Ferry');
    expect(trailerTitle('Night Ferry HEVC 4K')).toBe('Night Ferry');
    // Titles that only look like tags stay whole.
    expect(trailerTitle('SOS: Harbor Patrol')).toBe('SOS: Harbor Patrol');
    expect(trailerTitle('The Sub')).toBe('The Sub');
    expect(trailerTitle('Harbor 2049')).toBe('Harbor 2049');
    expect(trailerTitle('  Two\u0000Rivers\t  ')).toBe('Two Rivers');
    expect(trailerTitle(undefined)).toBe('');
    expect(trailerTitle('x'.repeat(300))).toHaveLength(100);
  });

  it('the year: the first 1900-2099 year among a date, a year and the name', () => {
    expect(trailerYear('2005-04-01', '1999')).toBe('2005');
    expect(trailerYear(undefined, '', '2011')).toBe('2011');
    expect(trailerYear(null, 'Harbor Lights (1999)')).toBe('1999');
    expect(trailerYear(2003)).toBe('2003');
    expect(trailerYear('1080p', '2160p', 'n/a')).toBeNull();
    expect(trailerYear()).toBeNull();
  });

  it('"<title> <year> trailer", the year once', () => {
    expect(trailerSearchQuery('EN - Harbor Lights (2005)', '2005')).toBe('Harbor Lights 2005 trailer');
    expect(trailerSearchQuery('Night Ferry', null)).toBe('Night Ferry trailer');
    expect(trailerSearchQuery('Harbor 2049', '2049')).toBe('Harbor 2049 trailer');
    expect(trailerSearchQuery('[4K]', '2005')).toBeNull();
    expect(trailerSearchQuery('', null)).toBeNull();
  });
});

describe('trailerTarget', () => {
  it('the panel\'s video when it has one (either field name), else a search', () => {
    expect(trailerTarget({ fields: { youtube_trailer: `https://youtu.be/${ID}` }, name: 'Night Ferry' })).toEqual({ kind: 'video', id: ID });
    expect(trailerTarget({ fields: { youtube_trailer: '', trailer: ID }, name: 'Night Ferry' })).toEqual({ kind: 'video', id: ID });
    expect(trailerTarget({ fields: { youtube_trailer: 'null' }, name: 'EN - Night Ferry', years: ['2011-03-02'] }))
      .toEqual({ kind: 'search', query: 'Night Ferry 2011 trailer' });
    // The panel's undecorated title wins over the decorated name; the name's year still counts.
    expect(trailerTarget({ fields: null, name: 'EN - Night Ferry (2011)', title: 'Night Ferry' }))
      .toEqual({ kind: 'search', query: 'Night Ferry 2011 trailer' });
    expect(trailerTarget({ fields: {}, name: '' })).toBeNull();
  });

  it('a film from its page\'s get_vod_info; a series from its get_series_info', () => {
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry', year: '2011' }, { info: { youtube_trailer: ID } })).toEqual({ kind: 'video', id: ID });
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry', year: '2011' }, { info: { releasedate: '2010-12-31' } }))
      .toEqual({ kind: 'search', query: 'Night Ferry 2010 trailer' });
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry', year: '2011' }, null)).toEqual({ kind: 'search', query: 'Night Ferry 2011 trailer' });
    expect(seriesTrailer({ series_id: 2, name: 'Harbor Patrol' }, { info: { youtube_trailer: `https://www.youtube.com/watch?v=${ID}` } }))
      .toEqual({ kind: 'video', id: ID });
    expect(seriesTrailer({ series_id: 2, name: 'Harbor Patrol', release_date: '2016-01-10' } as XtreamSeries, { info: {} }))
      .toEqual({ kind: 'search', query: 'Harbor Patrol 2016 trailer' });
    expect(seriesTrailer({ series_id: 2, name: 'Harbor Patrol', releaseDate: '2014-05-01' }, null))
      .toEqual({ kind: 'search', query: 'Harbor Patrol 2014 trailer' });
  });

  it('the web page: the watch page or the results page, the words encoded', () => {
    expect(trailerWebUrl({ kind: 'video', id: ID })).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(trailerWebUrl({ kind: 'search', query: 'Night & Day 2011 trailer' }))
      .toBe('https://www.youtube.com/results?search_query=Night%20%26%20Day%202011%20trailer');
  });
});

describe('the embed', () => {
  it('its address: the privacy-enhanced host and its documented parameters; the origin and language only when sound', () => {
    const u = new URL(trailerEmbedUrl(ID, 'https://localhost', 'fr'));
    expect(u.origin).toBe(TRAILER_EMBED_ORIGINS[0]);
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toMatch(/-nocookie\./);
    expect(u.pathname).toBe(`/embed/${ID}`);
    expect(Object.fromEntries(u.searchParams)).toEqual({
      autoplay: '1', controls: '1', rel: '0', playsinline: '1', iv_load_policy: '3', fs: '0', enablejsapi: '1',
      origin: 'https://localhost', hl: 'fr',
    });
    const bare = new URL(trailerEmbedUrl(ID, 'null', 'french'));
    expect(bare.searchParams.has('origin')).toBe(false);
    expect(bare.searchParams.has('hl')).toBe(false);
    expect(new URL(trailerEmbedUrl(ID, 'https://x.test/path?a=1')).searchParams.has('origin')).toBe(false);
    expect(TRAILER_EMBED_ORIGINS.every((o) => /^https:\/\/[^/]+$/.test(o))).toBe(true);
  });
});

describe('opening it', () => {
  beforeEach(() => {
    __resetTrailerForTests();
    h.native = false;
    openUrl.mockReset();
    openUrl.mockResolvedValue(undefined);
    vi.mocked(toast).mockClear();
  });
  afterEach(() => { setKidsLevel(null); });

  it('the panel\'s video: inside the app (the page\'s layer gets its id), nothing outside', async () => {
    const inside = vi.fn();
    h.native = true;
    expect(await openTrailer({ kind: 'video', id: ID }, 'series', inside)).toBe(true);
    expect(inside).toHaveBeenCalledWith(ID);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('a search: the results page, outside the app (the web build\'s new tab, Android\'s ACTION_VIEW)', async () => {
    const inside = vi.fn();
    expect(await openTrailer({ kind: 'search', query: 'Night Ferry trailer' }, 'movie', inside)).toBe(true);
    expect(openUrl).toHaveBeenCalledWith({ url: 'https://www.youtube.com/results?search_query=Night%20Ferry%20trailer' });
    expect(inside).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('one press, one search: a second OK right after is ignored', async () => {
    const q = { kind: 'search', query: 'Night Ferry trailer' } as const;
    expect(await openTrailer(q, 'movie', vi.fn())).toBe(true);
    expect(await openTrailer(q, 'movie', vi.fn())).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('"Open outside the app" on Android: the video app\'s own link first, the watch page when nothing takes it', async () => {
    h.native = true;
    expect(await openTrailerOutside({ kind: 'video', id: ID }, 'movie')).toBe(true);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(openUrl).toHaveBeenLastCalledWith({ url: `vnd.youtube:${ID}` });
    openUrl.mockReset();
    openUrl.mockRejectedValueOnce(new Error('No Activity found')).mockResolvedValueOnce(undefined);
    expect(await openTrailerOutside({ kind: 'video', id: ID }, 'movie')).toBe(true);
    expect(openUrl.mock.calls.map((c) => c[0].url)).toEqual([`vnd.youtube:${ID}`, `https://www.youtube.com/watch?v=${ID}`]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('the web build: the watch page only (no app link in a browser tab)', async () => {
    expect(await openTrailerOutside({ kind: 'video', id: ID }, 'movie')).toBe(true);
    expect(openUrl.mock.calls.map((c) => c[0].url)).toEqual([`https://www.youtube.com/watch?v=${ID}`]);
  });

  it('nothing on the device could open it: the viewer is told, and the next press tries again', async () => {
    h.native = true;
    openUrl.mockRejectedValue(new Error('No Activity found'));
    expect(await openTrailerOutside({ kind: 'video', id: ID }, 'movie')).toBe(false);
    expect(toast).toHaveBeenCalledWith({ title: 'No app on this device can show the trailer.' });
    expect(await openTrailer({ kind: 'search', query: 'Night Ferry trailer' }, 'movie', vi.fn())).toBe(false);
    expect(openUrl).toHaveBeenLastCalledWith({ url: 'https://www.youtube.com/results?search_query=Night%20Ferry%20trailer' });
    expect(toast).toHaveBeenCalledTimes(2);
  });
});

describe('Kids profiles: no Trailer', () => {
  beforeEach(() => { __resetTrailerForTests(); openUrl.mockReset(); vi.mocked(toast).mockClear(); });
  afterEach(() => { setKidsLevel(null); });

  it.each(['little', 'kids', 'teen'] as const)('%s: a film or a series has none, even with the panel\'s video', (level) => {
    setKidsLevel(level);
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry' }, { info: { youtube_trailer: ID } })).toBeNull();
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry', year: '2011' }, null)).toBeNull();
    expect(seriesTrailer({ series_id: 2, name: 'Harbor Patrol' }, { info: { youtube_trailer: ID } })).toBeNull();
    setKidsLevel(null);
    expect(movieTrailer({ stream_id: 1, name: 'Night Ferry' }, { info: { youtube_trailer: ID } })).toEqual({ kind: 'video', id: ID });
  });

  it('and nothing opens one there, inside or out (nor tells the child anything)', async () => {
    setKidsLevel('kids');
    const inside = vi.fn();
    expect(await openTrailer({ kind: 'video', id: ID }, 'movie', inside)).toBe(false);
    expect(await openTrailer({ kind: 'search', query: 'Night Ferry trailer' }, 'movie', inside)).toBe(false);
    expect(await openTrailerOutside({ kind: 'video', id: ID }, 'movie')).toBe(false);
    expect(inside).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
