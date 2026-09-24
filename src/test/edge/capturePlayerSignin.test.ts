// capture-player-signin writes a line into the CRM only after the panel has
// accepted it, and records what the panel says about it, not what the
// request says.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSupabase, loadEdgeFunction, eqValue, type FakeHandlers } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, fake: null as null | ReturnType<typeof import('./fakeSupabase').fakeSupabase> }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase: make } = await import('./fakeSupabase');
  return {
    createClient: () => {
      state.fake = make(state.handlers);
      return state.fake.client;
    },
  };
});

let handler: (req: Request) => Promise<Response> | Response;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('capture-player-signin');
});

beforeEach(() => {
  fetchMock.mockReset();
  state.handlers = { onRpc: (c) => (c.name === 'capture_player_signin' ? { data: { ok: true, linked: true } } : undefined) };
  state.fake = null;
});

const panelSays = (userInfo: Record<string, unknown>) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: userInfo, server_info: {} }), { status: 200 }));

const capture = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handler(new Request('http://fn.test/capture-player-signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return (await res.json()) as { ok: boolean; reason?: string; linked?: boolean };
};

const line = {
  host: 'strmz.xyz', username: 'Victim@Example.com', password: 'secret-pass', reason: 'signin', device_id: 'box-12345678',
  // What a caller claims. Must never reach the database.
  exp_date: String(Math.floor(Date.UTC(2099, 0, 1) / 1000)), status: 'Active', max_connections: 9, is_trial: 0,
};

const captureRpc = () => state.fake?.rpcs.find((c) => c.name === 'capture_player_signin');

describe('capture-player-signin', () => {
  it('writes nothing when the panel refuses the line', async () => {
    panelSays({ auth: 0 });
    const out = await capture(line);
    expect(out).toEqual({ ok: false, reason: 'not_verified' });
    expect(captureRpc()).toBeUndefined();
    expect(state.fake?.queries.some((q) => q.table === 'customer_services')).toBe(false);
  });

  it('writes nothing without a password, and never asks the panel', async () => {
    const out = await capture({ ...line, password: undefined, reason: 'reconcile' });
    expect(out).toEqual({ ok: false, reason: 'not_verified' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captureRpc()).toBeUndefined();
  });

  it('writes nothing when the panel cannot be reached', async () => {
    fetchMock.mockImplementation(async () => new Response('<html>blocked</html>', { status: 401 }));
    const out = await capture(line);
    expect(out.reason).toBe('not_verified');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // every base and agent was tried
    expect(captureRpc()).toBeUndefined();
  });

  it('records the expiry, status, connections and trial the panel gives', async () => {
    const exp = Math.floor(Date.UTC(2026, 10, 30) / 1000);
    panelSays({ auth: 1, status: 'Expired', exp_date: String(exp), max_connections: '2', is_trial: '1' });
    const out = await capture(line);
    expect(out).toEqual({ ok: true, linked: true });
    const args = captureRpc()!.args;
    expect(args).toMatchObject({
      p_host: 'strmz.xyz',
      p_username: 'victim@example.com',
      p_password: 'secret-pass',
      p_expiration_date: '2026-11-30',
      p_status: 'Expired',
      p_max_connections: 2,
      p_is_trial: true,
    });
    // The panel was asked about exactly this line, as typed.
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('strmz.xyz');
    expect(url).toContain(`username=${encodeURIComponent('Victim@Example.com')}`);
  });

  it('limits each line on its own, before the panel is asked', async () => {
    panelSays({ auth: 1, status: 'Active' });
    state.handlers.onQuery = (q) => {
      if (q.table === 'player_signin_throttle' && String(eqValue(q, 'ip_hash')).startsWith('capture-line:')) {
        return { data: { window_start: new Date().toISOString(), count: 8 } };
      }
      return undefined;
    };
    const out = await capture(line);
    expect(out).toEqual({ ok: false, reason: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys the per-IP limit on cf-connecting-ip, not the caller-chosen first forwarded hop', async () => {
    panelSays({ auth: 0 });
    const keys: unknown[] = [];
    state.handlers.onQuery = (q) => {
      if (q.table === 'player_signin_throttle') {
        const k = eqValue(q, 'ip_hash');
        if (typeof k === 'string' && !k.startsWith('capture-line:')) keys.push(k);
      }
      return undefined;
    };
    await capture(line, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' });
    await capture(line, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
    expect(keys.length).toBe(2);
    expect(new Set(keys).size).toBe(1);
    // Without cf-connecting-ip the old order still applies.
    await capture(line, { 'x-forwarded-for': '198.51.100.4' });
    expect(new Set(keys).size).toBe(2);
  });
});
