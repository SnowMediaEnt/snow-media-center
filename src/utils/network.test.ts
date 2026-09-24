import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let native = false;
vi.mock('./platform', () => ({ isNativePlatform: () => native }));
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request: vi.fn() } }));

const fetched: string[] = [];
beforeEach(() => {
  fetched.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { fetched.push(u); return new Response('', { status: 503 }); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); native = false; });

describe('isProxySafe', () => {
  it('lets a plain public GET through', async () => {
    const { isProxySafe } = await import('./network');
    expect(isProxySafe('https://snowmediaapps.com/smc/update.json?ts=1', { headers: { Accept: 'application/json' } })).toBe(true);
  });

  it('keeps anything carrying a credential direct', async () => {
    const { isProxySafe } = await import('./network');
    expect(isProxySafe('https://snowmediaapps.com/guesswhat/apps.json.php?k=abc&ts=1')).toBe(false);
    expect(isProxySafe('http://line.example/player_api.php?username=u&password=p')).toBe(false);
    expect(isProxySafe('https://x.example/cb?access_token=t')).toBe(false);
    expect(isProxySafe('https://user:pw@x.example/')).toBe(false);
    expect(isProxySafe('https://x.example/', { headers: { Authorization: 'Bearer t' } })).toBe(false);
    expect(isProxySafe('https://x.example/', { headers: [['apikey', 'k']] })).toBe(false);
    expect(isProxySafe('https://x.example/', { headers: new Headers({ 'x-admin-key': 'k' }) })).toBe(false);
    expect(isProxySafe('https://x.example/', { method: 'POST', body: '{}' })).toBe(false);
    expect(isProxySafe('https://x.example/', { credentials: 'include' })).toBe(false);
    expect(isProxySafe('https://abc.supabase.co/functions/v1/news-feed-proxy')).toBe(false);
  });
});

describe('robustFetch', () => {
  it('never uses a third-party proxy on the TV', async () => {
    native = true;
    const { robustFetch } = await import('./network');
    await expect(robustFetch('https://example.com/smc/update.json?ts=1', { retries: 1, useCorsProxy: true })).rejects.toThrow();
    expect(fetched).toEqual(['https://example.com/smc/update.json?ts=1']);
  });

  it('on the web, falls back to a proxy only for a safe request', async () => {
    const { robustFetch } = await import('./network');
    await expect(robustFetch('https://example.com/feed.xml', { retries: 1 })).rejects.toThrow();
    expect(fetched.length).toBe(3);
    fetched.length = 0;
    await expect(robustFetch('https://example.com/apps.json.php?k=secret', { retries: 1 })).rejects.toThrow();
    expect(fetched).toEqual(['https://example.com/apps.json.php?k=secret']);
  });

  it('keeps keys out of the log', async () => {
    const log = vi.mocked(console.log);
    const warn = vi.mocked(console.warn);
    const { robustFetch } = await import('./network');
    await expect(robustFetch('https://example.com/apps.json.php?k=secret', { retries: 1 })).rejects.toThrow();
    const logged = [...log.mock.calls, ...warn.mock.calls].flat().join('\n');
    expect(logged).toContain('https://example.com/apps.json.php');
    expect(logged).not.toContain('secret');
  });
});
