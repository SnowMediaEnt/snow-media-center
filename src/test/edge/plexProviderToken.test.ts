// plex-provider-token's per-IP limit is keyed like player-login's:
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
  handler = await loadEdgeFunction('plex-provider-token', { PLEX_PROVIDER_TOKEN: 'plex-token' });
});

beforeEach(() => {
  ipKeys = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: { auth: 0 } })));
  state.handlers = {
    onQuery: (q) => {
      const k = eqValue(q, 'ip_hash');
      if (typeof k === 'string' && k.startsWith('plexip:')) ipKeys.push(k);
      return undefined;
    },
  };
});

const ask = (headers: Record<string, string>) => handler(new Request('http://fn.test/plex-provider-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ host: 'strmz.xyz', username: 'someone@example.com', password: 'guess' }),
}));

describe('plex-provider-token', () => {
  it('counts attempts per real address however the forwarded-for header is forged', async () => {
    await ask({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '1.2.3.4, 198.51.100.20' });
    await ask({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '5.6.7.8, 198.51.100.20' });
    expect(ipKeys).toHaveLength(2);
    expect(ipKeys[0]).toBe(ipKeys[1]);
    // Without cf-connecting-ip the old order still applies.
    await ask({ 'x-forwarded-for': '203.0.113.50' });
    expect(ipKeys[2]).not.toBe(ipKeys[0]);
  });
});
