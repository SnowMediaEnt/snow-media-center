// Straight-to-the-provider requests (lib/directHttp): on the box CapacitorHttp
// does not follow a redirect from http to https, so they are followed by
// hand — absolute or relative Location, up to five hops. HTTP is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  CapacitorHttp: { request: h.request },
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { MAX_HOPS, contentLength, directGet } from './directHttp';

const ok = (data: unknown, headers: Record<string, string> = {}) => ({ status: 200, data, headers, url: '' });
const moved = (location: string, status = 301) => ({ status, data: '', headers: { Location: location }, url: '' });
const asked = () => h.request.mock.calls.map((c) => c[0].url);

beforeEach(() => { h.request.mockReset(); });

describe('directGet', () => {
  it('follows http → https and a relative Location, and says where the answer came from', async () => {
    h.request
      .mockResolvedValueOnce(moved('https://other.tv/list.m3u'))
      .mockResolvedValueOnce(moved('../v2/list.m3u?t=1', 302))
      .mockResolvedValueOnce(ok('#EXTM3U'));
    const res = await directGet('http://other.tv/a/list.m3u', { responseType: 'text' });
    expect(res.data).toBe('#EXTM3U');
    expect(res.url).toBe('https://other.tv/v2/list.m3u?t=1');
    expect(asked()).toEqual(['http://other.tv/a/list.m3u', 'https://other.tv/list.m3u', 'https://other.tv/v2/list.m3u?t=1']);
    expect(h.request.mock.calls.every((c) => c[0].disableRedirects === true)).toBe(true);
  });

  it(`gives up after ${MAX_HOPS} redirects`, async () => {
    h.request.mockResolvedValue(moved('http://loop.example/again'));
    await expect(directGet('http://loop.example/start')).rejects.toThrow('HTTP 310');
    expect(h.request).toHaveBeenCalledTimes(MAX_HOPS + 1);
  });

  it('a refusal is the panel\'s status', async () => {
    h.request.mockResolvedValueOnce({ status: 403, data: '', headers: {} });
    await expect(directGet('http://other.tv/x')).rejects.toMatchObject({ status: 403 });
  });

  it('contentLength: the HEAD\'s Content-Length, null when it isn\'t said or HEAD fails', async () => {
    h.request.mockResolvedValueOnce(ok('', { 'Content-Length': '1234' }));
    expect(await contentLength('http://other.tv/x')).toBe(1234);
    expect(h.request.mock.calls[0][0].method).toBe('HEAD');
    h.request.mockResolvedValueOnce(ok('', {}));
    expect(await contentLength('http://other.tv/x')).toBeNull();
    h.request.mockRejectedValueOnce(new Error('405'));
    expect(await contentLength('http://other.tv/x')).toBeNull();
  });
});
