// Settings › Add another service › Test (lib/outsideProbe): an Xtream sign-in
// that answers from another address (http → https) is saved with that one; an
// Xtream get.php link whose API is blocked or unreachable is tried again as
// the M3U link it also is; a definite wrong login is not. HTTP is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ get: vi.fn(), counted: [] as Array<{ host: string; m3u?: string }> }));
vi.mock('@/lib/directHttp', () => ({ directGet: h.get, contentLength: async () => null }));
vi.mock('@/lib/xtream', () => ({
  getLiveCategories: async (c: { host: string; m3u?: string }) => { h.counted.push({ host: c.host, m3u: c.m3u }); return [{ category_id: '1', category_name: 'News' }]; },
  countLiveStreams: async (c: { m3u?: string }) => ({ total: c.m3u ? 7 : 12, byCat: {} }),
}));

import { testOutsideSource } from './outsideProbe';
import { parseOutsideInput, type OutsideInput } from './outsideSource';
import { XtreamHttpError } from './xtreamListProxy';

const LINK = 'http://other.tv:8000/get.php?username=bob&password=hunter22&type=m3u_plus';
const input: OutsideInput = { kind: 'm3u', url: LINK };
const source = () => { const r = parseOutsideInput(input, 1); if (!r.ok) throw new Error('bad'); return r.source; };
const signedIn = (url: string, ui: Record<string, unknown> = { auth: 1, status: 'Active' }) => ({ status: 200, data: { user_info: ui }, url, headers: {} });

beforeEach(() => { h.get.mockReset(); h.counted = []; });

describe('Test', () => {
  it('an Xtream link: signs in and counts; a server that moved to https is saved at its new address', async () => {
    h.get.mockResolvedValueOnce(signedIn('https://other.tv/player_api.php?username=bob&password=hunter22'));
    const res = await testOutsideSource(source(), input);
    expect(res).toMatchObject({ ok: true, channels: 12, source: { kind: 'xtream', host: 'https://other.tv', username: 'bob' } });
    expect(h.counted).toEqual([{ host: 'https://other.tv', m3u: undefined }]);
    expect(h.get.mock.calls[0][0]).toBe('http://other.tv:8000/player_api.php?username=bob&password=hunter22');
  });

  it.each([
    ['unreachable', () => Promise.reject(new Error('Unable to resolve host'))],
    ['blocked (403)', () => Promise.reject(new XtreamHttpError(403))],
    ['a block page', () => Promise.resolve({ status: 200, data: '<html>blocked</html>', url: 'x', headers: {} })],
  ])('its API %s: tried again as the M3U link, and saved as that', async (_l, fail) => {
    h.get.mockImplementationOnce(fail);
    const res = await testOutsideSource(source(), input);
    expect(res).toMatchObject({ ok: true, channels: 7, source: { kind: 'm3u', url: LINK } });
  });

  it('a definite wrong login (auth 0) is not tried again', async () => {
    h.get.mockResolvedValueOnce(signedIn('http://other.tv:8000/player_api.php', { auth: 0 }));
    expect(await testOutsideSource(source(), input)).toEqual({ ok: false, error: 'wrongLogin' });
    expect(h.counted).toEqual([]);
  });

  it('typed as an Xtream login (not a link): no fallback', async () => {
    h.get.mockRejectedValueOnce(new Error('Unable to resolve host'));
    expect(await testOutsideSource(source(), { kind: 'xtream', server: 'other.tv:8000', username: 'bob', password: 'hunter22' }))
      .toEqual({ ok: false, error: 'unreachable' });
  });
});
