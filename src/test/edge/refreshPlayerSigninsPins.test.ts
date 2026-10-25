// refresh-player-signins makes the missing sign-in PINs at the end of a run,
// and a PIN failure never fails the run.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, type FakeHandlers } from './fakeSupabase';
import { TEST_PANEL_KEY, pinStore } from './fakePinStore';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return { createClient: () => fakeSupabase(state.handlers).client };
});

let handler: (req: Request) => Promise<Response> | Response;
let store: ReturnType<typeof pinStore>;

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  handler = await loadEdgeFunction('refresh-player-signins', { PANEL_CRED_KEY: TEST_PANEL_KEY, CRON_REFRESH_SECRET: 'cron' });
});

beforeEach(() => {
  store = pinStore();
  state.handlers = {
    onQuery: (q) => {
      if (q.table === 'customer_services') {
        return { data: [{ customer_id: null, panel_host: 'strmz.xyz', panel_username: 'renewed1', service_type: 'vibeztv', expiration_date: '2999-01-01' }] };
      }
      if (q.table === 'player_signins') return { data: [] };
      return store.answer(q);
    },
  };
});

const run = async () => {
  const res = await handler(new Request('http://fn.test/refresh-player-signins', { method: 'POST', headers: { 'x-cron-secret': 'cron' } }));
  return (await res.json()) as Record<string, unknown>;
};

describe('refresh-player-signins: sign-in PINs', () => {
  it('makes the PINs lines are missing at the end of the run', async () => {
    const out = await run();
    expect(out).toMatchObject({ ok: true, pins: { created: 1, failed: 0, more: false } });
    expect(store.rows.map((r) => [r.line_key, r.source])).toEqual([['strmz.xyz:renewed1', 'backfill']]);
  });

  it('still finishes the run when PINs cannot be made', async () => {
    const answer = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => (q.table === 'signin_pins' ? { data: null, error: { code: '42P01' } } : answer(q));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await run();
    expect(out).toMatchObject({ ok: true, pins: { error: 'not_set_up' } });
  });
});
