// player-login's per-IP limit is keyed the same way as everywhere else:
// cf-connecting-ip, not the first x-forwarded-for entry a caller can forge.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, type FakeHandlers } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return { createClient: () => fakeSupabase(state.handlers).client };
});

const fetchMock = vi.fn();
let handler: (req: Request) => Promise<Response> | Response;
let ipKeys: string[];

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('player-login');
});

beforeEach(() => {
  ipKeys = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: { auth: 0 } })));
  state.handlers = {
    onQuery: (q) => {
      const k = eqValue(q, 'ip_hash');
      if (q.table === 'player_login_throttle' && typeof k === 'string' && !k.startsWith('line:')) ipKeys.push(k);
      return undefined;
    },
  };
});

const login = (headers: Record<string, string>) => handler(new Request('http://fn.test/player-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ host: 'strmz.xyz', username: 'someone@example.com', password: 'guess' }),
}));

describe('player-login', () => {
  it('counts attempts per real address however the forwarded-for header is forged', async () => {
    await login({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '1.2.3.4, 198.51.100.20' });
    await login({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '5.6.7.8, 198.51.100.20' });
    expect(ipKeys).toHaveLength(2);
    expect(ipKeys[0]).toBe(ipKeys[1]);
  });

  it('treats an IPv6 /64 as one caller', async () => {
    await login({ 'cf-connecting-ip': '2001:db8:aa:bb::1' });
    await login({ 'cf-connecting-ip': '2001:db8:aa:bb:ffff:1:2:3' });
    await login({ 'cf-connecting-ip': '2001:db8:aa:bc::1' });
    expect(ipKeys[0]).toBe(ipKeys[1]);
    expect(ipKeys[2]).not.toBe(ipKeys[0]);
  });
});
