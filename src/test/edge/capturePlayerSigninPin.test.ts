// capture-player-signin asks signin-pins for the line's PIN after a verified
// sign-in, in the background: it never waits for it and never fails on it.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, type FakeHandlers } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return { createClient: () => fakeSupabase(state.handlers).client };
});

const fetchMock = vi.fn();
let handler: (req: Request) => Promise<Response> | Response;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('capture-player-signin', { INTERNAL_FN_SECRET: 'internal-secret-123' });
});

beforeEach(() => {
  fetchMock.mockReset();
  state.handlers = { onRpc: (c) => (c.name === 'capture_player_signin' ? { data: { ok: true, linked: false } } : undefined) };
});

const panelAnd = (pinCall: () => Promise<Response>) =>
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/functions/v1/signin-pins')
      ? pinCall()
      : new Response(JSON.stringify({ user_info: { auth: 1, status: 'Active' } })));

const capture = async () => {
  const res = await handler(new Request('http://fn.test/capture-player-signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host: 'strmz.xyz', username: 'Viewer@Example.com', password: 'pw', reason: 'signin' }),
  }));
  return res.json();
};
const pinCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/functions/v1/signin-pins'));

describe('capture-player-signin: the sign-in PIN', () => {
  it("asks for the line's PIN after the panel accepted it, with the internal secret", async () => {
    panelAnd(async () => new Response('{"ok":true}'));
    expect(await capture()).toEqual({ ok: true, linked: false });
    expect(pinCalls()).toHaveLength(1);
    const [url, init] = pinCalls()[0] as [string, RequestInit];
    expect(url).toBe('http://supabase.test/functions/v1/signin-pins');
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('internal-secret-123');
    expect(JSON.parse(String(init.body))).toEqual({
      action: 'ensure', host: 'strmz.xyz', username: 'Viewer@Example.com', customer_id: null, source: 'capture',
    });
  });

  it('does not wait for it', async () => {
    panelAnd(() => new Promise<Response>(() => {})); // never answers
    const out = await Promise.race([capture(), new Promise((r) => setTimeout(() => r('waited'), 2000))]);
    expect(out).toEqual({ ok: true, linked: false });
  });

  it('never fails on it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      panelAnd(async () => { throw new Error('network down'); });
      expect(await capture()).toEqual({ ok: true, linked: false });
    } finally {
      warn.mockRestore();
    }
  });

  it('asks nothing for a line the panel refused', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: { auth: 0 } })));
    expect(await capture()).toEqual({ ok: false, reason: 'not_verified' });
    expect(pinCalls()).toHaveLength(0);
  });
});
