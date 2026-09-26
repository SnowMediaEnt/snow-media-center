// xtream-list-proxy relays the Player's player_api.php list reads for a box
// whose internet blocks the provider panel. It must never become an open
// proxy: only player-login's panel hosts, only the read actions SMC uses, and
// never a credential or full panel URL in the logs.
import { readFileSync } from 'fs';
import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction } from './fakeSupabase';

const fetchMock = vi.fn();
let handler: (req: Request) => Promise<Response> | Response;
let mod: {
  ALLOWED_HOSTS: readonly string[];
  checkRequest: (body: unknown) => { ok: true; url: string; action: string } | { ok: false; reason: string };
};

const SECRET_USER = 'someone@example.com';
const SECRET_PASS = 'pa55-word&x';

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('xtream-list-proxy');
  // Same module instance loadEdgeFunction just imported (kept out of tsc's
  // reach like the other edge tests: it is Deno code).
  const file = new URL('../../../supabase/functions/xtream-list-proxy/index.ts', import.meta.url).pathname;
  mod = await import(/* @vite-ignore */ file);
});

const logs: unknown[][] = [];
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('[{"category_id":"1"}]', { status: 200 }));
  logs.length = 0;
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a); });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  // Nothing the function printed may carry the line's credentials or the panel URL.
  const printed = JSON.stringify(logs.map((a) => a.map((x) => (x instanceof Error ? x.message : x))));
  expect(printed).not.toContain(SECRET_PASS);
  expect(printed).not.toContain(encodeURIComponent(SECRET_PASS));
  expect(printed).not.toContain(SECRET_USER);
  expect(printed).not.toContain('player_api.php?');
});

const body = (over: Record<string, unknown> = {}) => ({
  host: 'http://dstreams.xyz:8080',
  username: SECRET_USER,
  password: SECRET_PASS,
  action: 'get_live_categories',
  ...over,
});
const call = (b: unknown, method = 'POST') => handler(new Request('http://fn.test/xtream-list-proxy', {
  method,
  headers: { 'Content-Type': 'application/json' },
  body: method === 'POST' ? JSON.stringify(b) : undefined,
}));

describe('xtream-list-proxy allowlist (pure)', () => {
  it('shares its host list with player-login', () => {
    const src = readFileSync(path.resolve(__dirname, '../../../supabase/functions/player-login/index.ts'), 'utf8');
    const m = /const ALLOWED_HOSTS = \[([^\]]*)\]/.exec(src);
    expect(m).toBeTruthy();
    const loginHosts = [...(m![1].matchAll(/'([^']+)'/g))].map((x) => x[1]);
    expect([...mod.ALLOWED_HOSTS].sort()).toEqual(loginHosts.sort());
  });

  it.each([
    'http://evil.test',
    'http://dstreams.xyz:9999',
    'http://dstreams.xyz',
    'https://strmz.xyz.evil.test',
    'http://evil.test#@strmz.xyz',
    'http://user:pw@strmz.xyz',
    'https://strmz.xyz/other',
    'https://strmz.xyz/?x=1',
    'ftp://strmz.xyz',
    'file:///etc/passwd',
    'strmz.xyz',
    '',
    42,
  ])('refuses host %s', (host) => {
    expect(mod.checkRequest(body({ host }))).toEqual({ ok: false, reason: 'host_not_allowed' });
  });

  it.each(['http://dstreams.xyz:8080', 'HTTPS://STRMZ.XYZ', 'https://strmz.xyz/', 'https://dstreams.xyz:2083', 'https://strmz.xyz:443'])(
    'accepts host %s', (host) => {
      expect(mod.checkRequest(body({ host })).ok).toBe(true);
    });

  it.each(['get_live_categories', 'get_live_streams', 'get_vod_categories', 'get_vod_streams', 'get_series_categories', 'get_series', 'get_short_epg', 'get_vod_info', 'get_series_info', undefined])(
    'accepts the read action %s', (action) => {
      const params = action === 'get_short_epg' ? { stream_id: 5, limit: 10 }
        : action === 'get_vod_info' ? { vod_id: 7 }
        : action === 'get_series_info' ? { series_id: 9 }
        : {};
      expect(mod.checkRequest(body({ action, params })).ok).toBe(true);
    });

  it.each(['get_simple_data_table', 'get_epg', 'create_user', 'GET_LIVE_STREAMS', '../x', ''])('refuses action %s', (action) => {
    expect(mod.checkRequest(body({ action }))).toEqual({ ok: false, reason: 'action_not_allowed' });
  });

  it('refuses unknown or unsafe params, and requires the id an info call needs', () => {
    expect(mod.checkRequest(body({ action: 'get_live_streams', params: { foo: '1' } }))).toEqual({ ok: false, reason: 'bad_params' });
    expect(mod.checkRequest(body({ action: 'get_live_streams', params: { category_id: '1&action=x' } }))).toEqual({ ok: false, reason: 'bad_params' });
    expect(mod.checkRequest(body({ action: 'get_vod_info', params: {} }))).toEqual({ ok: false, reason: 'bad_params' });
    expect(mod.checkRequest(body({ action: 'get_live_categories', params: { username: 'other' } }))).toEqual({ ok: false, reason: 'bad_params' });
  });

  it('refuses a missing username or password', () => {
    expect(mod.checkRequest(body({ username: '' }))).toEqual({ ok: false, reason: 'bad_credentials' });
    expect(mod.checkRequest(body({ password: 7 }))).toEqual({ ok: false, reason: 'bad_credentials' });
  });

  it('builds the panel URL from the allowed parts only, credentials encoded', () => {
    const r = mod.checkRequest(body({ action: 'get_live_streams', params: { category_id: '12', _: 3 } }));
    expect(r.ok).toBe(true);
    const u = new URL((r as { url: string }).url);
    expect(u.origin).toBe('http://dstreams.xyz:8080');
    expect(u.pathname).toBe('/player_api.php');
    expect(u.searchParams.get('username')).toBe(SECRET_USER);
    expect(u.searchParams.get('password')).toBe(SECRET_PASS);
    expect(u.searchParams.get('action')).toBe('get_live_streams');
    expect(u.searchParams.get('category_id')).toBe('12');
    expect(u.searchParams.get('_')).toBe('3');
  });

  it('the account info call has no action at all', () => {
    const r = mod.checkRequest(body({ action: undefined }));
    expect(new URL((r as { url: string }).url).searchParams.has('action')).toBe(false);
  });
});

describe('xtream-list-proxy handler', () => {
  it('answers CORS preflight and refuses anything but POST', async () => {
    const pre = await call(null, 'OPTIONS');
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await (await call(null, 'GET')).json()).toEqual({ ok: false, reason: 'method_not_allowed' });
  });

  it('never contacts a host outside the list', async () => {
    const res = await call(body({ host: 'http://evil.test' }));
    expect(await res.json()).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('relays the panel JSON as is, with its status, as a GET', async () => {
    const res = await call(body({ action: 'get_live_streams', params: { category_id: '3' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual([{ category_id: '1' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).searchParams.get('action')).toBe('get_live_streams');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
    expect((init as RequestInit).redirect).toBe('manual');
  });

  it('says so when the panel answers with a page, not JSON', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>blocked</html>', { status: 200 }));
    expect(await (await call(body())).json()).toEqual({ ok: false, reason: 'not_json' });
  });

  it("carries the panel's own refusal status in the body (never confused with a gateway error)", async () => {
    fetchMock.mockImplementation(async () => new Response('<html>401</html>', { status: 401 }));
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'panel_status', status: 401 });
  });

  it('refuses a list larger than the cap', async () => {
    fetchMock.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Length': String(200 * 1024 * 1024) } }));
    expect(await (await call(body())).json()).toEqual({ ok: false, reason: 'too_large' });
  });

  it('does not follow a redirect off the list', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { Location: 'http://evil.test/player_api.php' } }));
    expect(await (await call(body())).json()).toEqual({ ok: false, reason: 'panel_redirect' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to an allowed panel host', async () => {
    fetchMock
      .mockImplementationOnce(async () => new Response(null, { status: 301, headers: { Location: 'https://dstreams.xyz:2083/player_api.php?x=1' } }))
      .mockImplementationOnce(async () => new Response('{"user_info":{"auth":1}}', { status: 200 }));
    expect(await (await call(body({ action: undefined }))).json()).toEqual({ user_info: { auth: 1 } });
    expect(new URL(String(fetchMock.mock.calls[1][0])).host).toBe('dstreams.xyz:2083');
  });

  it('reports an unreachable panel without logging the URL or credentials', async () => {
    fetchMock.mockImplementation(async (u: string) => { throw new Error(`connect failed ${u}`); });
    expect(await (await call(body())).json()).toEqual({ ok: false, reason: 'panel_unreachable' });
  });
});
