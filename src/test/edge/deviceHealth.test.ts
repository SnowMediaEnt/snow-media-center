// device-health: a box reports what went wrong with its device-inbox key
// (only on the line the key is registered for), within its daily caps, with
// anything that looks like a URL or credential dropped; only admins read the
// reports or switch a box's deep check.
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

const ADMIN = { id: '44444444-4444-4444-8444-444444444444' };
const STRANGER = { id: '66666666-6666-4666-8666-666666666666' };
const CUSTOMER = '77777777-7777-4777-8777-777777777777';
const KEY = 'tv1_' + 'aB3-_'.repeat(8);
const TV = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LINE = { host: 'strmz.xyz', username: 'family@example.com' };
const EV_ID = '99999999-9999-4999-8999-999999999999';
const DAY = 24 * 60 * 60_000;

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
let KEY_HASH = '';

let handler: (req: Request) => Promise<Response> | Response;
beforeAll(async () => {
  KEY_HASH = await sha256(KEY);
  handler = await loadEdgeFunction('device-health');
});

const call = async (body: Record<string, unknown>, as?: string | null) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = `Bearer ${userToken(as)}`;
  const res = await handler(new Request('http://fn.test/device-health', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const queriesOf = (table: string, op?: string) =>
  state.queries.filter((q) => q.table === table && (!op || q.ops.some((o) => o.op === op)));
const hasOp = (q: QueryCall, op: string, ...args: unknown[]) =>
  q.ops.some((o) => o.op === op && args.every((a, i) => o.args[i] === a));

/** What the database holds for this test. */
let db: {
  device: { id: string; panel_host: string; panel_username: string } | null;
  deepUntil: string | null;
  today: { all: number; light: number; checks: number };
  event: Record<string, unknown> | null;
};

const event = (extra: Record<string, unknown> = {}) => ({
  kind: 'stall', verdict: 'device_overload', summary: 'Stalled 12 s on Channel One: box had 38 MB free memory',
  occurredAt: new Date(Date.now() - 60_000).toISOString(), context: 'live', title: 'Channel One',
  data: { stallSec: 12, memAvailMb: 38, lowMemory: true }, ...extra,
});
const report = (events: unknown[], extra: Record<string, unknown> = {}) => call({
  action: 'report', inbox_key: KEY, host: 'strmz.xyz', username: 'Family@Example.com',
  app_version: '1.9.6', version_code: 196, device_model: 'AFTMM', os_version: '9', events, ...extra,
});
const inserted = () => (opArg(queriesOf('device_health_events', 'insert')[0] ?? { table: '', ops: [] }, 'insert') ?? []) as Array<Record<string, unknown>>;

beforeEach(() => {
  state.queries.length = 0;
  state.rpcs.length = 0;
  db = {
    device: { id: TV, panel_host: LINE.host, panel_username: LINE.username },
    deepUntil: null,
    today: { all: 0, light: 0, checks: 0 },
    event: null,
  };
  state.handlers = {
    userForToken: (t) => [ADMIN, STRANGER].find((u) => t === userToken(u.id)) ?? null,
    onRpc: (c) => {
      if (c.name === 'has_role') return { data: c.args._user_id === ADMIN.id && c.args._role === 'admin' };
      if (c.name === 'device_health_box_summary') return { data: [] };
      return undefined;
    },
    onQuery: (q) => {
      if (q.table === 'device_inbox') {
        if (eqValue(q, 'key_hash') === KEY_HASH || eqValue(q, 'id') === TV) {
          return { data: db.device ? { ...db.device, key_hash: KEY_HASH, device_label: 'Bedroom', app_version: '1.9.6', last_seen_at: new Date().toISOString() } : null };
        }
        if (hasOp(q, 'in', 'key_hash')) {
          return { data: db.device ? [{ ...db.device, key_hash: KEY_HASH, device_label: 'Bedroom', app_version: '1.9.6', last_seen_at: null }] : [] };
        }
        return { data: null };
      }
      if (q.table === 'device_health_checks') {
        if (hasOp(q, 'maybeSingle')) return { data: db.deepUntil ? { deep_until: db.deepUntil } : null };
        return { data: [] };
      }
      if (q.table === 'player_signins') {
        return eqValue(q, 'panel_host') === LINE.host && eqValue(q, 'panel_username') === LINE.username
          ? { data: { matched_customer_id: CUSTOMER } } : { data: null };
      }
      if (q.table === 'device_health_events') {
        if (hasOp(q, 'select', 'id')) {
          if (eqValue(q, 'kind') === 'check') return { count: db.today.checks };
          return { count: eqValue(q, 'deep') === false ? db.today.light : db.today.all };
        }
        if (hasOp(q, 'maybeSingle')) return { data: eqValue(q, 'id') === EV_ID ? db.event : null };
        return { data: [] };
      }
      return undefined;
    },
  };
});

describe('device-health: who may report', () => {
  it('refuses a key that is not registered, and one registered for another line', async () => {
    db.device = null;
    expect((await report([event()])).body).toEqual({ ok: false, reason: 'unknown_key' });
    db.device = { id: TV, panel_host: LINE.host, panel_username: 'someone-else' };
    expect((await report([event()])).body).toEqual({ ok: false, reason: 'other_line' });
    // A panel off the allowlist is another line too.
    expect((await report([event()], { host: 'evil.example' })).body).toEqual({ ok: false, reason: 'other_line' });
    expect(queriesOf('device_health_events', 'insert')).toHaveLength(0);
    // status follows the same rule.
    expect((await call({ action: 'status', inbox_key: KEY, host: 'strmz.xyz', username: 'family@example.com' })).body)
      .toEqual({ ok: false, reason: 'other_line' });
  });

  it('looks the key up by its sha256 and never stores the key itself', async () => {
    const out = await report([event()]);
    expect(out.body).toMatchObject({ ok: true, accepted: 1, deep_until: null });
    const lookup = queriesOf('device_inbox').find((q) => eqValue(q, 'key_hash') !== undefined)!;
    expect(eqValue(lookup, 'key_hash')).toBe(KEY_HASH);
    const rows = inserted();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key_hash: KEY_HASH, host: 'strmz.xyz', username: 'family@example.com', customer_id: CUSTOMER,
      app_version: '1.9.6', version_code: 196, device_model: 'AFTMM', kind: 'stall', verdict: 'device_overload',
      context: 'live', title: 'Channel One', deep: false, samples: null,
    });
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });

  it('turns away malformed reports', async () => {
    expect((await report(Array.from({ length: 21 }, () => event()))).status).toBe(400);
    expect((await report('nope' as unknown as unknown[])).status).toBe(400);
    expect((await call({ action: 'report', inbox_key: 'short', host: 'strmz.xyz', username: 'x', events: [] })).status).toBe(400);
    expect((await call({ action: 'nope' })).status).toBe(400);
  });

  it('is rate limited per box', async () => {
    state.handlers.onRpc = (c) => (c.name === 'throttle_hit' ? { data: 999 } : undefined);
    expect((await report([event()])).body).toEqual({ ok: false, reason: 'rate_limited' });
  });
});

describe('device-health: what is kept', () => {
  it('drops strings that look like a URL, a credential query or an IP address', async () => {
    await report([event({
      summary: 'Failed http://strmz.xyz/live/u/p/1.ts',
      title: 'Channel ?username=bob&password=x',
      data: {
        stallSec: 4, url: 'https://cdn.example/x.m3u8', q: 'a=1&token=abc', who: 'username=bob',
        server: '203.0.113.7', engine: 'exo', nested: { a: 1 }, list: [1, 2], 'bad key': 1,
      },
    })]);
    const row = inserted()[0];
    expect(row.summary).toBe('');
    expect(row.title).toBeNull();
    expect(row.data).toEqual({ stallSec: 4, engine: 'exo' });
    expect(JSON.stringify(row)).not.toMatch(/:\/\/|token=|password=|username=|203\.0\.113/);
  });

  it('trims the summary and title and drops an event over 4 KB (still counted)', async () => {
    const out = await report([
      event({ summary: 'x'.repeat(500), title: 'y'.repeat(500) }),
      event({ data: { blob: 'z'.repeat(5000) } }),
      event({ kind: 'not-a-kind' }),
    ]);
    expect(out.body).toMatchObject({ ok: true, accepted: 3 });
    const rows = inserted();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].summary)).toHaveLength(200);
    expect(String(rows[0].title)).toHaveLength(120);
    expect((out.body.ids as unknown[]).map((i) => typeof i)).toEqual(['string', 'object', 'object']);
  });

  it('keeps at most 40 light events a day, and 300 in all in a deep check', async () => {
    db.today = { all: 38, light: 38, checks: 0 };
    let out = await report(Array.from({ length: 5 }, () => event()));
    expect(out.body).toMatchObject({ ok: true, accepted: 5 });
    expect(inserted()).toHaveLength(2);

    state.queries.length = 0;
    db.today = { all: 40, light: 40, checks: 0 };
    out = await report([event()]);
    expect(out.body).toMatchObject({ ok: true, accepted: 1, ids: [null] });
    expect(queriesOf('device_health_events', 'insert')).toHaveLength(0);

    // Deep: the light cap no longer applies, the daily 300 does.
    state.queries.length = 0;
    db.deepUntil = new Date(Date.now() + 3 * DAY).toISOString();
    db.today = { all: 297, light: 40, checks: 0 };
    out = await report(Array.from({ length: 5 }, () => event({ kind: 'sample', verdict: 'unknown' })));
    expect(out.body).toMatchObject({ ok: true, accepted: 5, deep_until: db.deepUntil });
    expect(inserted()).toHaveLength(3);
    expect(inserted()[0]).toMatchObject({ deep: true, kind: 'sample' });
  });

  it('keeps app_start / sample only in a deep check', async () => {
    const out = await report([event({ kind: 'sample' }), event({ kind: 'app_start' }), event()]);
    expect(out.body).toMatchObject({ ok: true, accepted: 3 });
    expect(inserted().map((r) => r.kind)).toEqual(['stall']);
  });

  it('hands back deep_until on report and status while a deep check is on', async () => {
    db.deepUntil = new Date(Date.now() + DAY).toISOString();
    expect((await call({ action: 'status', inbox_key: KEY, host: 'https://STRMZ.xyz/', username: 'family@example.com' })).body)
      .toEqual({ ok: true, deep_until: db.deepUntil });
    expect((await report([])).body).toEqual({ ok: true, accepted: 0, ids: [], deep_until: db.deepUntil });
    // Ended: null.
    db.deepUntil = new Date(Date.now() - 1000).toISOString();
    expect((await call({ action: 'status', inbox_key: KEY, host: 'strmz.xyz', username: 'family@example.com' })).body)
      .toEqual({ ok: true, deep_until: null });
  });
});

describe('device-health: customer-run 30-second check', () => {
  const samples = Array.from({ length: 30 }, (_, t) => [t, 8.5, 4200, 0, 35, 410, 0]);
  const check = (extra: Record<string, unknown> = {}) => event({
    kind: 'check', verdict: 'server', summary: 'Box fine, internet 48 Mb/s, server sent 3 Mb/s',
    data: { arrivalKbpsAvg: 3000, neededKbps: 5000, internetMbps: 48 }, samples, ...extra,
  });

  it('keeps a check with its samples, without a deep check, and returns its id', async () => {
    const out = await report([check()]);
    expect(out.body).toMatchObject({ ok: true, accepted: 1 });
    const ids = out.body.ids as string[];
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    const row = inserted()[0];
    expect(row).toMatchObject({ id: ids[0], kind: 'check', deep: false, samples });
  });

  it('allows a check up to 12 KB but refuses bad samples, and ignores samples on other kinds', async () => {
    const big = check({ data: { note: 'n'.repeat(100), arrivalKbpsAvg: 1 }, summary: 's'.repeat(190) });
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(1000);
    let out = await report([
      check({ samples: Array.from({ length: 30 }, (_, t) => [t, 1.123456789, 4200.5, 0, 35.25, 410.75, 0, 1]) }), // ~ 6 KB? fits 12 KB
      check({ samples: Array.from({ length: 31 }, () => [1]) }),
      check({ samples: [[1, 2, 3, 4, 5, 6, 7, 8, 9]] }),
      check({ samples: [['x']] }),
      check({ data: { blob: 'z'.repeat(13 * 1024) } }),
      event({ samples: [[1, 2]] }),
    ]);
    expect(out.body).toMatchObject({ ok: true, accepted: 6 });
    expect((out.body.ids as unknown[]).map((i) => i !== null)).toEqual([true, false, false, false, false, true]);
    expect(inserted()[1]).toMatchObject({ kind: 'stall', samples: null });

    // A light event over 4 KB is still too big, even though a check could be.
    state.queries.length = 0;
    out = await report([event({ data: { blob: 'z'.repeat(5000) } })]);
    expect(out.body.ids).toEqual([null]);
  });

  it('keeps at most 6 checks a box a day, apart from the light cap', async () => {
    db.today = { all: 40, light: 40, checks: 5 };
    const out = await report([check(), check(), event()]);
    expect(out.body).toMatchObject({ ok: true, accepted: 3 });
    expect((out.body.ids as unknown[]).map((i) => i !== null)).toEqual([true, false, false]);
    expect(inserted().map((r) => r.kind)).toEqual(['check']);
  });
});

describe('device-health: admin', () => {
  const actions = [
    { action: 'admin_set_deep', device_ref: TV },
    { action: 'admin_stop_deep', device_ref: TV },
    { action: 'admin_events' },
    { action: 'admin_event', id: EV_ID },
    { action: 'admin_devices' },
  ];

  it('needs a signed-in admin for every admin_* action', async () => {
    for (const body of actions) {
      expect(await call(body)).toEqual({ status: 401, body: { ok: false, reason: 'not_signed_in' } });
      expect(await call(body, STRANGER.id)).toEqual({ status: 403, body: { ok: false, reason: 'not_admin' } });
    }
    expect(queriesOf('device_health_checks', 'upsert')).toHaveLength(0);
    expect(queriesOf('device_health_checks', 'update')).toHaveLength(0);
  });

  it('starts a deep check for 7 days by default (1-14) and stops it', async () => {
    const out = await call({ action: 'admin_set_deep', device_ref: TV }, ADMIN.id);
    expect(out.body).toMatchObject({ ok: true, device_ref: TV });
    const until = Date.parse(out.body.deep_until as string);
    expect(Math.abs(until - (Date.now() + 7 * DAY))).toBeLessThan(5000);
    const row = opArg(queriesOf('device_health_checks', 'upsert')[0], 'upsert') as Record<string, unknown>;
    expect(row).toMatchObject({ key_hash: KEY_HASH, requested_by: ADMIN.id });

    expect((await call({ action: 'admin_set_deep', device_ref: TV, days: 15 }, ADMIN.id)).status).toBe(400);
    expect((await call({ action: 'admin_set_deep', key_hash: KEY_HASH, days: 2 }, ADMIN.id)).body).toMatchObject({ ok: true, device_ref: TV });

    expect((await call({ action: 'admin_stop_deep', device_ref: TV }, ADMIN.id)).body).toEqual({ ok: true, device_ref: TV, deep_until: null });
    expect(queriesOf('device_health_checks', 'update')).toHaveLength(1);

    db.device = null;
    expect((await call({ action: 'admin_set_deep', device_ref: TV }, ADMIN.id)).body).toEqual({ ok: false, reason: 'unknown_device' });
  });

  it('lists events with the device ref, never the key hash, and filters kind=check', async () => {
    state.handlers.onQuery = ((orig) => (q: QueryCall) => {
      if (q.table === 'device_health_events' && hasOp(q, 'order')) {
        return { data: [{ id: EV_ID, key_hash: KEY_HASH, kind: 'check', verdict: 'server', summary: 's', samples: [[0, 1]] }] };
      }
      return orig?.(q);
    })(state.handlers.onQuery);
    const out = await call({ action: 'admin_events', kind: 'check', limit: 9999 }, ADMIN.id);
    expect(out.body).toMatchObject({ ok: true, events: [{ id: EV_ID, device_ref: TV, label: 'Bedroom', kind: 'check' }] });
    expect(JSON.stringify(out.body)).not.toContain(KEY_HASH);
    const q = queriesOf('device_health_events', 'order')[0];
    expect(eqValue(q, 'kind')).toBe('check');
    expect(q.ops.find((o) => o.op === 'limit')?.args[0]).toBe(500);
    expect((await call({ action: 'admin_events', kind: 'bogus' }, ADMIN.id)).status).toBe(400);
  });

  it('opens one event by id', async () => {
    expect((await call({ action: 'admin_event', id: EV_ID }, ADMIN.id)).body).toEqual({ ok: false, reason: 'not_found' });
    db.event = { id: EV_ID, key_hash: KEY_HASH, kind: 'check', samples: [[0, 1]] };
    const out = await call({ action: 'admin_event', id: EV_ID }, ADMIN.id);
    expect(out.body).toEqual({ ok: true, event: { id: EV_ID, kind: 'check', samples: [[0, 1]], device_ref: TV, label: 'Bedroom' } });
    expect((await call({ action: 'admin_event', id: 'nope' }, ADMIN.id)).status).toBe(400);
  });

  it("a customer's events include their boxes' events a report could not tie to them", async () => {
    state.handlers.onQuery = ((orig) => (q: QueryCall) => {
      if (q.table === 'player_signins' && eqValue(q, 'matched_customer_id') === CUSTOMER) {
        return { data: [{ panel_host: LINE.host, panel_username: LINE.username }] };
      }
      if (q.table === 'device_inbox' && eqValue(q, 'panel_host') === LINE.host) return { data: [{ key_hash: KEY_HASH }] };
      if (q.table === 'device_health_events' && hasOp(q, 'order')) return { data: [] };
      return orig?.(q);
    })(state.handlers.onQuery);
    expect((await call({ action: 'admin_events', customer_id: CUSTOMER }, ADMIN.id)).body).toEqual({ ok: true, events: [] });
    const q = queriesOf('device_health_events', 'order')[0];
    expect(q.ops.find((o) => o.op === 'or')?.args[0]).toBe(`customer_id.eq.${CUSTOMER},key_hash.in.(${KEY_HASH})`);
  });

  it('admin_devices by device_ref returns just that box, even with nothing wrong', async () => {
    db.device = { id: TV, panel_host: LINE.host, panel_username: LINE.username };
    state.handlers.onQuery = ((orig) => (q: QueryCall) => {
      if (q.table === 'device_inbox' && eqValue(q, 'panel_host') === LINE.host && hasOp(q, 'order')) {
        return { data: [{ id: TV, key_hash: KEY_HASH, panel_host: LINE.host, panel_username: LINE.username, device_label: 'Bedroom', app_version: '1.9.8', last_seen_at: new Date().toISOString() },
          { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', key_hash: 'b'.repeat(64), panel_host: LINE.host, panel_username: LINE.username, device_label: 'Kitchen', app_version: '1.9.8', last_seen_at: null }] };
      }
      return orig?.(q);
    })(state.handlers.onQuery);
    const out = await call({ action: 'admin_devices', device_ref: TV }, ADMIN.id);
    expect(out.body.ok).toBe(true);
    const devices = out.body.devices as Array<Record<string, unknown>>;
    expect(devices.map((d) => d.device_ref)).toEqual([TV]);
    expect(devices[0]).toMatchObject({ label: 'Bedroom', problems_30d: 0 });
    expect((await call({ action: 'admin_devices', device_ref: 'nope' }, ADMIN.id)).status).toBe(400);
  });

  it('summarises boxes per device ref, worst first, with a line\'s quiet boxes', async () => {
    state.handlers.onRpc = (c) => {
      if (c.name === 'has_role') return { data: c.args._user_id === ADMIN.id };
      if (c.name === 'device_health_box_summary') {
        return { data: [{ key_hash: KEY_HASH, host: LINE.host, username: LINE.username, customer_id: CUSTOMER, device_model: 'AFTMM',
          app_version: '1.9.6', counts: { device_overload: 5, internet: 1 }, problems_7d: 2, problems_30d: 6,
          last_kind: 'stall', last_verdict: 'device_overload', last_summary: 'Stalled', last_title: null, last_at: new Date().toISOString() }] };
      }
      return undefined;
    };
    const out = await call({ action: 'admin_devices', host: 'strmz.xyz', username: 'Family@Example.com' }, ADMIN.id);
    expect(out.body.ok).toBe(true);
    const devices = out.body.devices as Array<Record<string, unknown>>;
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ device_ref: TV, label: 'Bedroom', model: 'AFTMM', counts: { device_overload: 5, internet: 1 }, problems_30d: 6 });
    expect(JSON.stringify(out.body)).not.toContain(KEY_HASH);
    const rpc = state.rpcs.find((c) => c.name === 'device_health_box_summary')!;
    expect(rpc.args).toMatchObject({ p_host: 'strmz.xyz', p_username: 'family@example.com', p_customer_id: null });
  });
});
