// Some ISPs block the box's player_api.php requests to the provider panel
// while its streams still play. The list reads then go through Snow Media's
// xtream-list-proxy edge function; streams stay direct.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  invoke: vi.fn(),
  demo: false,
  native: true,
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, getPlatform: () => (h.native ? 'android' : 'web') },
  CapacitorHttp: { get: h.get },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));

import {
  authenticate,
  buildLiveStreamUrl,
  buildNativeLiveUrl,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  getVodCategories,
  getSeriesInfo,
  listsViaSnowMedia,
  type XtreamCreds,
} from './xtream';

const CATS = [{ category_id: '1', category_name: 'News' }];
let n = 0;
const line = (): XtreamCreds => ({ host: `http://panel${++n}.test:8080`, username: 'user1', password: 'pass1' } as unknown as XtreamCreds);
const netError = () => Object.assign(new Error('Unable to resolve host'), {});
const proxyOk = (data: unknown) => ({ data, error: null });
const directCalls = () => h.get.mock.calls.length;

beforeEach(() => {
  h.get.mockReset();
  h.invoke.mockReset();
  h.demo = false;
  h.native = true;
  try { localStorage.clear(); } catch { /* ignore */ }
});
afterEach(() => { vi.useRealTimers(); });

describe('Live TV lists when the ISP blocks the provider panel', () => {
  it('works exactly as before when the direct request works', async () => {
    h.get.mockResolvedValue({ status: 200, data: CATS });
    expect(await getLiveCategories(line())).toEqual(CATS);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['a network error / DNS failure', () => Promise.reject(netError())],
    ['a timeout', () => Promise.reject(new Error('timeout'))],
    ['a connection reset', () => Promise.reject(new Error('Connection reset'))],
    ['HTTP 403', () => Promise.resolve({ status: 403, data: '' })],
    ['HTTP 451', () => Promise.resolve({ status: 451, data: '' })],
    ['an HTML block page on a 200', () => Promise.resolve({ status: 200, data: '<html>This site is blocked</html>' })],
  ])('retries through Snow Media after %s', async (_label, fail) => {
    h.get.mockImplementation(fail);
    h.invoke.mockResolvedValue(proxyOk(CATS));
    const c = line();
    expect(await getLiveCategories(c)).toEqual(CATS);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    const [name, opts] = h.invoke.mock.calls[0];
    expect(name).toBe('xtream-list-proxy');
    expect(opts.body).toEqual({ host: c.host, username: 'user1', password: 'pass1', action: 'get_live_categories', params: {} });
  });

  it.each([401, 429, 500])('takes a %s from the panel as the real answer (no proxy)', async (status) => {
    h.get.mockResolvedValue({ status, data: '' });
    await expect(getLiveCategories(line())).rejects.toThrow(`HTTP ${status}`);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('remembers the block for that line: later lists go straight to Snow Media', async () => {
    h.get.mockRejectedValue(netError());
    h.invoke.mockResolvedValue(proxyOk(CATS));
    const c = line();
    await getLiveCategories(c);
    expect(listsViaSnowMedia(c.host)).toBe(true);
    const before = directCalls();
    h.invoke.mockResolvedValue(proxyOk([{ stream_id: 5, name: 'One', category_id: '1' }]));
    expect(await getLiveStreams(c, '1')).toHaveLength(1);
    expect(await getShortEpg(c, 5, 4)).toEqual([{ stream_id: 5, name: 'One', category_id: '1' }]);
    expect(directCalls()).toBe(before);
    expect(h.invoke.mock.calls[1][1].body).toMatchObject({ action: 'get_live_streams', params: { category_id: '1' } });
    expect(h.invoke.mock.calls[2][1].body).toMatchObject({ action: 'get_short_epg', params: { stream_id: '5', limit: '4' } });
    // Another line is not affected.
    h.get.mockResolvedValue({ status: 200, data: CATS });
    const other = line();
    await getLiveCategories(other);
    expect(listsViaSnowMedia(other.host)).toBe(false);
  });

  it('keeps the block across a restart for 30 minutes, then tries direct again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const c = line();
    const host = new URL(c.host).host;
    localStorage.setItem('smc.xtream.listsViaSnowMedia', JSON.stringify({ [host]: Date.now() - 10 * 60 * 1000 }));
    h.invoke.mockResolvedValue(proxyOk(CATS));
    await getVodCategories(c);
    expect(directCalls()).toBe(0);

    const d = line();
    const hostD = new URL(d.host).host;
    localStorage.setItem('smc.xtream.listsViaSnowMedia', JSON.stringify({ [hostD]: Date.now() - 31 * 60 * 1000 }));
    h.get.mockResolvedValue({ status: 200, data: CATS });
    await getVodCategories(d);
    expect(directCalls()).toBe(1);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it('on a remembered line whose proxy fails, tries direct and forgets the block when it works', async () => {
    h.get.mockRejectedValueOnce(netError());
    h.invoke.mockResolvedValueOnce(proxyOk(CATS));
    const c = line();
    await getLiveCategories(c);
    expect(listsViaSnowMedia(c.host)).toBe(true);
    h.invoke.mockResolvedValueOnce(proxyOk({ ok: false, reason: 'panel_unreachable' }));
    h.get.mockResolvedValueOnce({ status: 200, data: { info: { name: 'Film' } } });
    expect(await getSeriesInfo(c, 9)).toEqual({ info: { name: 'Film' } });
    expect(listsViaSnowMedia(c.host)).toBe(false);
  });

  it("passes on the panel's own answer through the proxy (401) without marking the line", async () => {
    h.get.mockRejectedValue(netError());
    h.invoke.mockResolvedValue(proxyOk({ ok: false, reason: 'panel_status', status: 401 }));
    const c = line();
    await expect(authenticate(c)).rejects.toThrow('HTTP 401');
    expect(listsViaSnowMedia(c.host)).toBe(false);
  });

  it('when Snow Media refuses too (e.g. a host not on the list), the original error stands', async () => {
    h.get.mockRejectedValue(new Error('Unable to resolve host'));
    h.invoke.mockResolvedValue(proxyOk({ ok: false, reason: 'host_not_allowed' }));
    const c = line();
    await expect(getLiveCategories(c)).rejects.toThrow('Unable to resolve host');
    expect(listsViaSnowMedia(c.host)).toBe(false);
  });

  it('when the function is not deployed (gateway 404), the original error stands', async () => {
    h.get.mockRejectedValue(new Error('timeout'));
    h.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: { status: 404 } }) });
    const c = line();
    await expect(getLiveCategories(c)).rejects.toThrow('timeout');
    expect(listsViaSnowMedia(c.host)).toBe(false);
  });

  it('never proxies the streams themselves', async () => {
    h.get.mockRejectedValue(netError());
    h.invoke.mockResolvedValue(proxyOk(CATS));
    const c = line();
    await getLiveCategories(c);
    expect(listsViaSnowMedia(c.host)).toBe(true);
    expect(buildLiveStreamUrl(c, 5)).toBe(`${c.host}/live/user1/pass1/5.m3u8`);
    expect(buildNativeLiveUrl(c, 5)).toBe(`${c.host}/live/user1/pass1/5.ts`);
  });

  it('demo mode never calls the proxy (or the panel)', async () => {
    h.demo = true;
    h.get.mockRejectedValue(netError());
    h.invoke.mockResolvedValue(proxyOk(CATS));
    const c = line();
    await getLiveCategories(c);
    await getLiveStreams(c);
    await getVodCategories(c);
    await authenticate(c);
    await getShortEpg(c, 1);
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('a web browser (not the box) never uses the proxy', async () => {
    h.native = false;
    const fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(getLiveCategories(line())).rejects.toThrow('Failed to fetch');
      expect(h.invoke).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
