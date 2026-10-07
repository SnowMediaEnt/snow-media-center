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
      {
        key: 'strmz.xyz|7', host: 'strmz.xyz', stream_id: 7, name: 'CNN', reports: 1, failures: 0, working: 0, cleared: 0, ignored: 250, last: '2026-09-24T10:00:00Z', down: true,
        // Buffering and who reported (migration 20261007060000): none here.
        buffering: 0, buffering_now: false, reporters: [],
      },
    ]);
    expect(state.queries.some((q) => q.table === 'channel_signals')).toBe(false);
  });
});

describe('channel-status: buffering reports', () => {
  it('stores a buffering report from a known box, with the line’s username and connections only', async () => {
    lineDevices = ['real-box-0003'];
    const out = await call(
      { op: 'signal', host: 'strmz.xyz', stream_id: 42, name: 'ESPN', kind: 'buffering', device_id: 'real-box-0003', line_user: 'jsmith', active_cons: 2, max_cons: 3, password: 'hunter2', url: 'http://x/live/jsmith/hunter2/42.ts' },
      { 'cf-connecting-ip': '203.0.113.9' },
    );
    expect(out.body.ok).toBe(true);
    expect(inserted()[0]).toMatchObject({ kind: 'buffering', trusted: true, line_user: 'jsmith', active_cons: 2, max_cons: 3 });
    expect(JSON.stringify(inserted())).not.toContain('hunter2');
  });

  it('counts buffering reports with the viewer’s own reports (ten an hour per device)', async () => {
    signalsByDevice = Array(10).fill('buffering');
    expect((await signal('down', 'busy-device-02')).body.reason).toBe('rate_limited');
    expect((await signal('buffering', 'busy-device-02')).body.reason).toBe('rate_limited');
  });

  it('automatic signals carry no line, whatever is sent', async () => {
    await call({ op: 'signal', host: 'strmz.xyz', stream_id: 42, name: 'ESPN', kind: 'fail', device_id: 'some-device-1', line_user: 'jsmith' });
    expect(inserted()[0]).not.toHaveProperty('line_user');
  });

  it('a bad connection count is dropped, the report still counts', async () => {
    await call({ op: 'signal', host: 'strmz.xyz', stream_id: 42, kind: 'down', device_id: 'some-device-2', line_user: 'jsmith', active_cons: 'lots', max_cons: -1 });
    expect(inserted()[0]).toMatchObject({ line_user: 'jsmith', active_cons: null, max_cons: null });
  });

  it('a database without the line columns yet still takes the report', async () => {
    let first = true;
    const prev = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => {
      if (q.table === 'channel_signals' && opArg(q, 'insert')) {
        const row = opArg(q, 'insert') as Record<string, unknown>;
        if (first && 'line_user' in row) { first = false; return { error: { message: 'column "line_user" does not exist' } }; }
        return { error: null };
      }
      return prev(q);
    };
    const out = await call({ op: 'signal', host: 'strmz.xyz', stream_id: 42, kind: 'down', device_id: 'some-device-3', line_user: 'jsmith' });
    expect(out.body.ok).toBe(true);
    expect(inserted().map((r) => 'line_user' in r)).toEqual([true, false]);
  });
});

describe('channel-status: a whole category', () => {
  const catInserted = () => state.queries.filter((q) => q.table === 'category_signals').map((q) => opArg(q, 'insert')).filter(Boolean) as Array<Record<string, unknown>>;
  const report = (device: string, extra: Record<string, unknown> = {}) =>
    call({ op: 'signal_category', host: 'dstreams.xyz:8080', category_id: '12', name: 'NFL Sunday', kind: 'down', device_id: device, ...extra }, { 'cf-connecting-ip': '203.0.113.9' });

  it('stores a report from a known box as trusted, with its line', async () => {
    lineDevices = ['real-box-0004'];
    const out = await report('real-box-0004', { line_user: 'jsmith', active_cons: 1, max_cons: 2 });
    expect(out.body.ok).toBe(true);
    expect(catInserted()[0]).toMatchObject({ host: 'dstreams.xyz:8080', category_id: '12', category_name: 'NFL Sunday', kind: 'down', trusted: true, line_user: 'jsmith', active_cons: 1, max_cons: 2 });
    expect(typeof catInserted()[0].ip_hash).toBe('string');
    const lookup = state.queries.find((q) => q.table === 'player_signins')!;
    expect(eqValue(lookup, 'panel_host')).toBe('dstreams.xyz:8080');
  });

  it('stores one from a box it does not know as untrusted', async () => {
    await report('made-up-device-7');
    expect(catInserted()[0]).toMatchObject({ trusted: false });
  });

  it('allows three category reports an hour per device', async () => {
    const prev = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => (q.table === 'category_signals' && eqValue(q, 'device_hash') ? { data: [{ kind: 'down' }, { kind: 'down' }, { kind: 'down' }] } : prev(q));
    expect((await report('busy-device-03')).body).toEqual({ ok: false, reason: 'rate_limited' });
    // A clear is still taken.
    const clear = await call({ op: 'signal_category', host: 'dstreams.xyz:8080', category_id: '12', kind: 'clear', device_id: 'busy-device-03' });
    expect(clear.body.ok).toBe(true);
  });

  it('refuses a bad category id or kind', async () => {
    expect((await report('some-device-4', { category_id: '12; drop table' })).status).toBe(400);
    expect((await report('some-device-4', { kind: 'buffering' })).status).toBe(400);
  });

  it('lets an admin mark a category working, and clear the mark', async () => {
    state.handlers.onRpc = (c) => (c.name === 'has_role' ? { data: true } : undefined);
    const auth = { Authorization: `Bearer ${ADMIN_TOKEN}` };
    expect((await call({ op: 'admin_set', host: 'dstreams.xyz:8080', category_id: '12', name: 'NFL Sunday', status: 'ok', hours: 2 }, auth)).body.ok).toBe(true);
    const up = state.queries.find((q) => q.table === 'category_overrides' && opArg(q, 'upsert'))!;
    expect(opArg(up, 'upsert')).toMatchObject({ host: 'dstreams.xyz:8080', category_id: '12', status: 'ok', set_by: ADMIN.id });
    expect((await call({ op: 'admin_set', host: 'dstreams.xyz:8080', category_id: '12', status: null }, auth)).body.ok).toBe(true);
    expect(state.queries.some((q) => q.table === 'category_overrides' && q.ops.some((o) => o.op === 'delete'))).toBe(true);
    // Not for anyone else.
    expect((await call({ op: 'admin_set', host: 'dstreams.xyz:8080', category_id: '12', status: 'down' })).status).toBe(401);
  });
});

describe('channel-status list: buffering and categories', () => {
  it('hands a box the down channels, the buffering ones and the down categories', async () => {
    state.handlers.onRpc = (c) => {
      if (c.name === 'channel_down_list') return { data: [{ host: 'tv1.example', stream_id: 1 }] };
      if (c.name === 'channel_buffering_list') return { data: [{ host: 'tv1.example', stream_id: 2 }] };
      if (c.name === 'category_down_list') return { data: [{ host: 'tv1.example', category_id: '44' }] };
      return undefined;
    };
    const out = await call({ op: 'list', hosts: ['tv1.example'] });
    expect(out.body).toEqual({ ok: true, down: ['tv1.example|1'], buffering: ['tv1.example|2'], categories: ['tv1.example|44'] });
  });

  it('before the migration (the new lists fail) still hands out the down channels', async () => {
    state.handlers.onRpc = (c) => {
      if (c.name === 'channel_down_list') return { data: [{ host: 'tv2.example', stream_id: 5 }] };
      return { error: { message: 'function channel_buffering_list does not exist' } };
    };
    const out = await call({ op: 'list', hosts: ['tv2.example'] });
    expect(out.body).toEqual({ ok: true, down: ['tv2.example|5'], buffering: [], categories: [] });
  });

  it('caps the categories at 100', async () => {
    state.handlers.onRpc = (c) => (c.name === 'category_down_list'
      ? { data: Array.from({ length: 150 }, (_, i) => ({ host: 'tv3.example', category_id: String(i) })) }
      : c.name === 'channel_down_list' ? { data: [] } : undefined);
    const out = await call({ op: 'list', hosts: ['tv3.example'] });
    expect((out.body.categories as string[]).length).toBe(100);
  });
});

describe('channel-status admin_list: buffering, categories and who reported', () => {
  it('adds buffering counts, the categories and the reporters’ lines', async () => {
    state.handlers.onRpc = (c) => {
      if (c.name === 'has_role') return { data: true };
      if (c.name === 'channel_signal_summary') return { data: [{ host: 'strmz.xyz', stream_id: 9, channel_name: 'ESPN', reports: 0, failures: 0, working: 0, cleared: 0, ignored: 0, last_at: '2026-10-07T10:00:00Z' }] };
      if (c.name === 'channel_buffering_summary') return { data: [{ host: 'strmz.xyz', stream_id: 9, channel_name: 'ESPN', buffering: 2, last_at: '2026-10-07T10:00:00Z' }] };
      if (c.name === 'channel_buffering_list') return { data: [{ host: 'strmz.xyz', stream_id: 9 }] };
      if (c.name === 'category_signal_summary') return { data: [{ host: 'strmz.xyz', category_id: '12', category_name: 'NFL', reports: 1, working: 0, cleared: 0, ignored: 3, last_at: '2026-10-07T09:00:00Z' }] };
      if (c.name === 'category_down_list') return { data: [{ host: 'strmz.xyz', category_id: '12' }] };
      if (c.name === 'report_lines') {
        return { data: [
          { scope: 'channel', host: 'strmz.xyz', stream_id: 9, category_id: null, kind: 'buffering', line_user: 'amy', active_cons: 1, max_cons: 2, created_at: '2026-10-07T10:00:00Z' },
          { scope: 'category', host: 'strmz.xyz', stream_id: null, category_id: '12', kind: 'down', line_user: 'bob', active_cons: null, max_cons: 3, created_at: '2026-10-07T09:00:00Z' },
        ] };
      }
      if (c.name === 'channel_down_list') return { data: [] };
      return undefined;
    };
    const out = await call({ op: 'admin_list' }, { Authorization: `Bearer ${ADMIN_TOKEN}` });
    expect(out.body.channels).toEqual([expect.objectContaining({
      key: 'strmz.xyz|9', buffering: 2, buffering_now: true, down: false,
      reporters: [{ kind: 'buffering', user: 'amy', active_cons: 1, max_cons: 2, at: '2026-10-07T10:00:00Z' }],
    })]);
    expect(out.body.categories).toEqual([{
      key: 'strmz.xyz|12', host: 'strmz.xyz', category_id: '12', name: 'NFL', reports: 1, working: 0, cleared: 0, ignored: 3,
      last: '2026-10-07T09:00:00Z', down: true,
      reporters: [{ kind: 'down', user: 'bob', active_cons: null, max_cons: 3, at: '2026-10-07T09:00:00Z' }],
    }]);
  });
});
