// channel-status: one known box's report still counts for everyone, but
// made-up device ids are limited per IP, signals from boxes we don't know
// never reach the list, and the list is capped.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall, type RpcCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, queries: [] as QueryCall[], rpcs: [] as RpcCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => fakeSupabase({
      ...state.handlers,
      onQuery: (q) => { if (!state.queries.includes(q)) state.queries.push(q); return state.handlers.onQuery?.(q); },
      onRpc: (c) => { state.rpcs.push(c); return state.handlers.onRpc?.(c); },
    }).client,
  };
});

let handler: (req: Request) => Promise<Response> | Response;
const ADMIN = { id: '33333333-3333-4333-8333-333333333333', email: 'admin@example.com' };
const ADMIN_TOKEN = userToken(ADMIN.id);

// What the fake database holds for this test.
let signalsByDevice: string[];
let signalsByIp: string[];
let lineDevices: string[];
let analyticsDevices: string[];

beforeAll(async () => {
  handler = await loadEdgeFunction('channel-status');
});

beforeEach(() => {
  state.queries.length = 0;
  state.rpcs.length = 0;
  signalsByDevice = [];
  signalsByIp = [];
  lineDevices = [];
  analyticsDevices = [];
  state.handlers = {
    userForToken: (t) => (t === ADMIN_TOKEN ? ADMIN : null),
    onQuery: (q) => {
      if (q.table === 'channel_signals' && eqValue(q, 'device_hash')) return { data: signalsByDevice.map((kind) => ({ kind })) };
      if (q.table === 'channel_signals' && eqValue(q, 'ip_hash')) return { data: signalsByIp.map((kind) => ({ kind })) };
      if (q.table === 'player_signins') return { data: lineDevices.includes(String(eqValue(q, 'device_id'))) ? [{ id: 'row' }] : [] };
      if (q.table === 'analytics_sessions') return { data: analyticsDevices.includes(String(eqValue(q, 'device_id'))) ? [{ id: 'row' }] : [] };
      if (q.table === 'channel_overrides') return { data: [] };
      return undefined;
    },
  };
});

const call = async (body: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handler(new Request('http://fn.test/channel-status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const signal = (kind: string, device: string, host = 'strmz.xyz') =>
  call({ op: 'signal', host, stream_id: 42, name: 'ESPN', kind, device_id: device }, { 'cf-connecting-ip': '203.0.113.9' });
const inserted = () => state.queries.filter((q) => q.table === 'channel_signals').map((q) => opArg(q, 'insert')).filter(Boolean) as Array<Record<string, unknown>>;

describe('channel-status signal', () => {
  it('stores a report from a box it does not know, but as untrusted', async () => {
    const out = await signal('down', 'made-up-device-1');
    expect(out.body.ok).toBe(true);
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0]).toMatchObject({ kind: 'down', trusted: false });
    expect(typeof inserted()[0].ip_hash).toBe('string');
  });

  it('trusts a box that signed a line in on that host', async () => {
    lineDevices = ['real-box-0001'];
    await signal('down', 'real-box-0001');
    expect(inserted()[0]).toMatchObject({ trusted: true });
    const lookup = state.queries.find((q) => q.table === 'player_signins')!;
    expect(eqValue(lookup, 'panel_host')).toBe('strmz.xyz');
  });

  it('trusts a box that has been sending analytics', async () => {
    analyticsDevices = ['real-box-0002'];
    await signal('clear', 'real-box-0002');
    expect(inserted()[0]).toMatchObject({ kind: 'clear', trusted: true });
  });

  it('limits reports per IP, whatever device id each one claims', async () => {
    signalsByIp = Array(20).fill('down');
    const out = await signal('down', 'brand-new-device-99');
    expect(out.body).toEqual({ ok: false, reason: 'rate_limited' });
    expect(inserted()).toHaveLength(0);
    // Automatic signals still have room at that address.
    const ok = await signal('ok', 'brand-new-device-99');
    expect(ok.body.ok).toBe(true);
  });

  it('limits a device’s own reports and clears to ten an hour', async () => {
    signalsByDevice = Array(10).fill('clear');
    expect((await signal('down', 'busy-device-01')).body.reason).toBe('rate_limited');
    expect((await signal('fail', 'busy-device-01')).body.ok).toBe(true);
  });
});

describe('channel-status list', () => {
  it('never hands a box more than 500 channels', async () => {
    state.handlers.onRpc = (c) => (c.name === 'channel_down_list'
      ? { data: Array.from({ length: 600 }, (_, i) => ({ host: 'dstreams.xyz:8080', stream_id: i + 1 })) }
      : undefined);
    const out = await call({ op: 'list', hosts: ['dstreams.xyz:8080'] });
    expect((out.body.down as string[]).length).toBe(500);
  });
});

describe('channel-status admin_list', () => {
  it('reads per-channel counts from SQL, including what was ignored', async () => {
    state.handlers.onRpc = (c) => {
      if (c.name === 'has_role') return { data: true };
      if (c.name === 'channel_signal_summary') {
        return { data: [{ host: 'strmz.xyz', stream_id: 7, channel_name: 'CNN', reports: 1, failures: 0, working: 0, cleared: 0, ignored: 250, last_at: '2026-09-24T10:00:00Z' }] };
      }
      if (c.name === 'channel_down_list') return { data: [{ host: 'strmz.xyz', stream_id: 7 }] };
      return undefined;
    };
    const out = await call({ op: 'admin_list' }, { Authorization: `Bearer ${ADMIN_TOKEN}` });
    expect(out.body.channels).toEqual([
      { key: 'strmz.xyz|7', host: 'strmz.xyz', stream_id: 7, name: 'CNN', reports: 1, failures: 0, working: 0, cleared: 0, ignored: 250, last: '2026-09-24T10:00:00Z', down: true },
    ]);
    expect(state.queries.some((q) => q.table === 'channel_signals')).toBe(false);
  });
});
