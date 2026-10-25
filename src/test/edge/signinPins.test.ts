// signin-pins: the hub's PIN screens (admins only) and the hooks' 'ensure'
// (internal secret only). One PIN per line: ensure is idempotent, a renewal
// through giveaway-bridge keeps the digits, new_pin changes the hash, and a
// delete is soft (nothing makes the line a PIN again but the hub).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall, type RpcCall } from './fakeSupabase';
import { TEST_PANEL_KEY, loadShared, pinStore } from './fakePinStore';

type PinMod = { pinHmac: (pin: string) => Promise<string | null> };

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, queries: [] as QueryCall[], rpcs: [] as RpcCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => fakeSupabase({
      ...state.handlers,
      onQuery: (q) => { state.queries.push(q); return state.handlers.onQuery?.(q); },
      onRpc: (c) => { state.rpcs.push(c); return state.handlers.onRpc?.(c); },
    }).client,
  };
});

const ADMIN = { id: '44444444-4444-4444-8444-444444444444' };
const MEMBER = { id: '55555555-5555-4555-8555-555555555555' };
const CUSTOMER = '66666666-6666-4666-8666-666666666666';
const SERVICE = '77777777-7777-4777-8777-777777777777';
const SECRET = 'internal-secret-123';
const ENV = {
  PANEL_CRED_KEY: TEST_PANEL_KEY, INTERNAL_FN_SECRET: SECRET, SMC_HUB_SECRET: 'hub-secret',
  SITE_PROVISION_SECRET: 'site-secret', SMC_ADMIN_KEY: 'admin-key',
};

const fetchMock = vi.fn();
let pinsFn: (req: Request) => Promise<Response> | Response;
let bridgeFn: (req: Request) => Promise<Response> | Response;
let pins: PinMod;
let store: ReturnType<typeof pinStore>;
let extra: (q: QueryCall) => { data?: unknown; error?: unknown } | undefined;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  pinsFn = await loadEdgeFunction('signin-pins', ENV);
  bridgeFn = await loadEdgeFunction('giveaway-bridge', ENV);
  pins = await loadShared<PinMod>('signinPin.ts');
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{}'));
  state.queries.length = 0;
  state.rpcs.length = 0;
  store = pinStore();
  extra = () => undefined;
  state.handlers = {
    userForToken: (t) => (t === userToken(ADMIN.id) ? ADMIN : t === userToken(MEMBER.id) ? MEMBER : null),
    onRpc: (c) => (c.name === 'has_role' ? { data: c.args._user_id === ADMIN.id } : undefined),
    onQuery: (q) => extra(q) ?? store.answer(q),
  };
});

type Out = Record<string, unknown> & { ok: boolean; reason?: string; pin?: unknown };
const call = async (body: Record<string, unknown>, headers: Record<string, string> = { Authorization: `Bearer ${userToken(ADMIN.id)}` }) => {
  const res = await pinsFn(new Request('http://fn.test/signin-pins', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: (await res.json()) as Out };
};
const ensure = (host: string, username: string, more: Record<string, unknown> = {}) =>
  call({ action: 'ensure', host, username, ...more }, { 'x-internal-secret': SECRET });

const serviceRow = (over: Record<string, unknown> = {}) => (q: QueryCall) =>
  q.table === 'customer_services'
    ? { data: { id: SERVICE, customer_id: CUSTOMER, panel_host: 'http://dstreams.xyz:8080', panel_username: 'Line42', service_type: 'dreamstreams', ...over } }
    : undefined;

describe('signin-pins: who may call', () => {
  it('refuses no session, a member, and the internal secret for anything but ensure', async () => {
    expect((await call({ action: 'list' }, {})).status).toBe(401);
    expect((await call({ action: 'list' }, { Authorization: `Bearer ${userToken(MEMBER.id)}` })).body.reason).toBe('unauthorized');
    expect((await call({ action: 'list' }, { 'x-internal-secret': SECRET })).status).toBe(401);
    expect((await call({ action: 'ensure', host: 'strmz.xyz', username: 'a' }, { 'x-internal-secret': 'wrong' })).status).toBe(401);
    // ensure is the hooks' only: an admin session doesn't unlock it either.
    expect((await call({ action: 'ensure', host: 'strmz.xyz', username: 'a' })).body.reason).toBe('invalid');
    expect(store.rows).toHaveLength(0);
  });

  it('lets an admin list', async () => {
    await ensure('strmz.xyz', 'viewer1');
    const out = await call({ action: 'list' });
    expect(out.body.ok).toBe(true);
    expect(out.body.pins).toEqual([{
      id: store.rows[0].id, server: 'Vibez', panel_hostname: 'strmz.xyz', panel_username: 'viewer1', customer_id: null,
      customer_name: null, pin: expect.stringMatching(/^\d{10}$/), status: 'working', expires_at: null, last_used_at: null,
      use_count: 0, created_at: store.rows[0].created_at, source: 'line-created',
    }]);
  });

  it("lists each PIN with its line's latest expiry and its status", async () => {
    await ensure('strmz.xyz', 'old1', { customer_id: CUSTOMER });
    await ensure('dstreams.xyz', 'new1');
    await ensure('strmz.xyz', 'off1');
    await call({ action: 'set_disabled', id: store.rows[2].id, disabled: true });
    extra = (q) => {
      if (q.table === 'customer_services') {
        return { data: [
          { panel_host: 'strmz.xyz', panel_username: 'OLD1', service_type: 'vibeztv', expiration_date: '2020-05-01' },
          { panel_host: 'http://dstreams.xyz:8080', panel_username: 'new1', service_type: 'dreamstreams', expiration_date: '2020-05-01' },
        ] };
      }
      if (q.table === 'player_signins') return { data: [{ panel_host: 'dstreams.xyz:2083', panel_username: 'new1', expiration_date: '2999-01-01' }] };
      if (q.table === 'customers') return { data: [{ id: CUSTOMER, name: 'Pat', email: null }] };
      return undefined;
    };
    const pins = (await call({ action: 'list' })).body.pins as Array<Record<string, unknown>>;
    const by = (u: string) => pins.find((p) => p.panel_username === u)!;
    expect(by('old1')).toMatchObject({ status: 'expired', expires_at: '2020-05-01', customer_name: 'Pat' });
    expect(by('new1')).toMatchObject({ status: 'working', expires_at: '2999-01-01', server: 'DreamStreams' });
    expect(by('off1')).toMatchObject({ status: 'off' });
  });
});

describe('signin-pins: ensure', () => {
  it('is idempotent: a line that has a PIN keeps it, and only the call that made it sees the digits', async () => {
    const a = await ensure('http://dstreams.xyz:8080', 'Line42', { customer_id: CUSTOMER, source: 'capture' });
    expect(a.body).toEqual({ ok: true, created: true, has_pin: true, pin: expect.stringMatching(/^\d{10}$/) });
    const hmac = store.rows[0].pin_hmac;
    // Any later caller with the internal secret learns only that a PIN exists.
    const b = await ensure('dstreams.xyz:2083', 'line42');
    expect(b.body).toEqual({ ok: true, created: false, has_pin: true, pin: null });
    expect(store.rows[0].pin_hmac).toBe(hmac);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ panel_hostname: 'dstreams.xyz', line_key: 'dstreams.xyz:line42', customer_id: CUSTOMER, source: 'capture' });
    // Stored as a lookup key and ciphertext only.
    expect(store.rows[0].pin_hmac).toBe(await pins.pinHmac(String(a.body.pin)));
    expect(store.rows[0].pin_enc).toMatch(/^enc:v1:/);
    expect(JSON.stringify(store.rows[0])).not.toContain(String(a.body.pin));
  });

  it('refuses a line on another panel', async () => {
    expect((await ensure('evil.example', 'x')).body).toEqual({ ok: false, reason: 'bad_line' });
    expect(store.rows).toHaveLength(0);
  });

  it('keeps one PIN when the same line is ensured twice at once', async () => {
    const [a, b] = await Promise.all([ensure('strmz.xyz', 'twin'), ensure('strmz.xyz', 'twin')]);
    expect(store.rows).toHaveLength(1);
    const handedOut = [a.body.pin, b.body.pin].filter((p) => p !== null);
    expect(handedOut).toHaveLength(1);
    expect(store.rows[0].pin_hmac).toBe(await pins.pinHmac(String(handedOut[0])));
  });
});

describe('giveaway-bridge line-created', () => {
  const lineCreated = async (expires_at: string) => {
    const res = await bridgeFn(new Request('http://fn.test/giveaway-bridge', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'hub-secret' },
      body: JSON.stringify({ action: 'line-created', host: 'dstreams.xyz:8080', username: 'Renew77', expires_at, source: 'whmcs' }),
    }));
    return (await res.json()) as Out;
  };

  it('returns the PIN it made; a renewal keeps that PIN and never hands its digits out again', async () => {
    extra = (q) => {
      if (q.table === 'customer_services' && q.ops.some((o) => o.op === 'order')) {
        return { data: [{ customer_id: CUSTOMER, panel_username: 'renew77', panel_host: 'dstreams.xyz:8080' }] };
      }
      if (q.table === 'customers') return { data: { id: CUSTOMER, user_id: null, name: 'Pat', email: null, phone: null } };
      if (q.table === 'customer_services') return { data: [{ id: SERVICE, panel_line_id: null, panel_password: 'x' }] };
      return undefined;
    };
    const first = await lineCreated('2026-11-24');
    expect(first).toMatchObject({ ok: true, customer_id: CUSTOMER, pin: expect.stringMatching(/^\d{10}$/) });
    expect(first.has_pin).toBe(true);
    const hmac = store.rows[0].pin_hmac;
    expect(hmac).toBe(await pins.pinHmac(String(first.pin)));
    const renewed = await lineCreated('2026-12-24');
    expect(renewed).toMatchObject({ ok: true, pin: null, has_pin: true });
    expect(store.rows[0].pin_hmac).toBe(hmac);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ line_key: 'dstreams.xyz:renew77', panel_username: 'Renew77', source: 'line-created', customer_id: CUSTOMER });
  });

  it('still answers when the PIN cannot be made', async () => {
    extra = (q) => {
      if (q.table === 'signin_pins') return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
      if (q.table === 'customers') return { data: { id: CUSTOMER, user_id: null, name: 'Pat', email: null, phone: null } };
      if (q.table === 'customer_services' && q.ops.some((o) => o.op === 'order')) {
        return { data: [{ customer_id: CUSTOMER, panel_username: 'renew77', panel_host: 'dstreams.xyz:8080' }] };
      }
      return undefined;
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await lineCreated('2026-11-24')).toMatchObject({ ok: true, customer_id: CUSTOMER, pin: null, has_pin: false });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('giveaway-bridge site-provision', () => {
  const provision = async () => {
    const res = await bridgeFn(new Request('http://fn.test/giveaway-bridge', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': 'site-secret' },
      body: JSON.stringify({ action: 'site-provision', order_number: 'SNW-12345', line_index: 0, email: 'buyer@example.com',
        months: 1, connections: 1, amount: 15, paypal_txn: 'ABCDEFGHIJKLMNOPQ' }),
    }));
    return (await res.json()) as Out;
  };

  it("hands out the new line's PIN once; a replayed order gets has_pin only", async () => {
    let replayed = false;
    fetchMock.mockImplementation(async () => {
      const reply = { ok: true, username: 'Site9', password: 'p', host: 'http://dstreams.xyz:8080', expires: '2026-12-01', serviceId: 5, replayed };
      replayed = true;
      return new Response(JSON.stringify(reply));
    });
    const first = await provision();
    expect(first).toMatchObject({ ok: true, has_pin: true, pin: expect.stringMatching(/^\d{10}$/) });
    const again = await provision();
    expect(again).toMatchObject({ ok: true, replayed: true, has_pin: true, pin: null });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ line_key: 'dstreams.xyz:site9', source: 'site-provision' });
  });
});

describe('signin-pins: the hub', () => {
  it("get shows a service line's PIN, null until it has one; create {serviceId} makes it once", async () => {
    extra = serviceRow();
    expect((await call({ action: 'get', serviceId: SERVICE })).body).toEqual({ ok: true, pin: null });
    const made = await call({ action: 'create', serviceId: SERVICE });
    expect(made.body).toMatchObject({ ok: true, pin: { server: 'DreamStreams', panel_hostname: 'dstreams.xyz', panel_username: 'Line42', customer_id: CUSTOMER, source: 'hub', status: 'working' } });
    const again = await call({ action: 'create', serviceId: SERVICE });
    expect(store.rows).toHaveLength(1);
    expect((again.body.pin as { pin: string }).pin).toBe((made.body.pin as { pin: string }).pin);
    const got = await call({ action: 'get', serviceId: SERVICE });
    expect((got.body.pin as { pin: string }).pin).toBe((made.body.pin as { pin: string }).pin);
    expect(store.rows[0].created_by).toBe(ADMIN.id);
  });

  it('refuses a service that is not a DreamStreams or Vibez line', async () => {
    extra = serviceRow({ panel_host: null, service_type: 'plex' });
    expect((await call({ action: 'create', serviceId: SERVICE })).body).toMatchObject({ ok: false, reason: 'not_a_line' });
  });

  it('new_pin changes the digits and the hash; the old PIN no longer matches', async () => {
    const first = await ensure('strmz.xyz', 'viewer2');
    const oldHmac = store.rows[0].pin_hmac;
    const out = await call({ action: 'new_pin', id: store.rows[0].id });
    const fresh = (out.body.pin as { pin: string }).pin;
    expect(fresh).toMatch(/^\d{10}$/);
    expect(fresh).not.toBe(first.body.pin);
    expect(store.rows[0].pin_hmac).not.toBe(oldHmac);
    expect(store.rows[0].pin_hmac).toBe(await pins.pinHmac(fresh));
    expect(store.rows.some((r) => r.pin_hmac === oldHmac)).toBe(false);
    // ensure keeps the new one, and doesn't hand it out.
    expect((await ensure('strmz.xyz', 'viewer2')).body).toEqual({ ok: true, pin: null, created: false, has_pin: true });
    expect(store.rows[0].pin_hmac).toBe(await pins.pinHmac(fresh));
  });

  it('switches a PIN off and on, and deletes it', async () => {
    await ensure('strmz.xyz', 'viewer3');
    const id = store.rows[0].id;
    expect((await call({ action: 'set_disabled', id, disabled: true })).body.pin).toMatchObject({ status: 'off' });
    expect((await ensure('strmz.xyz', 'viewer3')).body).toEqual({ ok: true, pin: null, created: false, has_pin: true });
    expect((await call({ action: 'set_disabled', id, disabled: false })).body.pin).toMatchObject({ status: 'working' });
    expect((await call({ action: 'delete', id })).body).toEqual({ ok: true });
    expect(store.rows[0].deleted_at).toEqual(expect.any(String));
    expect((await call({ action: 'set_disabled', id, disabled: true })).body).toEqual({ ok: false, reason: 'not_found' });
    expect((await call({ action: 'delete', id })).body).toEqual({ ok: false, reason: 'not_found' });
  });

  it('a deleted PIN stays gone: no list, no get, no ensure, no backfill', async () => {
    extra = serviceRow();
    const made = await call({ action: 'create', serviceId: SERVICE });
    const oldPin = (made.body.pin as { pin: string }).pin;
    await call({ action: 'delete', id: store.rows[0].id });
    extra = (q) => {
      if (q.table === 'customer_services' && q.ops.some((o) => o.op === 'range')) {
        return { data: [{ customer_id: CUSTOMER, panel_host: 'http://dstreams.xyz:8080', panel_username: 'Line42', service_type: 'dreamstreams', expiration_date: '2999-01-01' }] };
      }
      return serviceRow()(q);
    };
    expect((await call({ action: 'list' })).body).toEqual({ ok: true, pins: [] });
    expect((await call({ action: 'get', serviceId: SERVICE })).body).toEqual({ ok: true, pin: null });
    expect((await ensure('dstreams.xyz:8080', 'Line42', { source: 'capture' })).body).toEqual({ ok: true, pin: null, created: false, has_pin: false });
    expect((await call({ action: 'ensure_missing' })).body).toEqual({ ok: true, created: 0, more: false });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].deleted_at).toEqual(expect.any(String));

    // An explicit hub create brings the line back, with new digits.
    const back = await call({ action: 'create', serviceId: SERVICE });
    const newDigits = (back.body.pin as { pin: string }).pin;
    expect(newDigits).toMatch(/^\d{10}$/);
    expect(newDigits).not.toBe(oldPin);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].deleted_at).toBeNull();
    expect(store.rows[0].pin_hmac).toBe(await pins.pinHmac(newDigits));
  });

  it('new_pin on a deleted PIN brings it back with new digits', async () => {
    await ensure('strmz.xyz', 'viewer4');
    const oldHmac = store.rows[0].pin_hmac;
    await call({ action: 'delete', id: store.rows[0].id });
    const out = await call({ action: 'new_pin', id: store.rows[0].id });
    expect(out.body).toMatchObject({ ok: true, pin: { panel_username: 'viewer4', status: 'working' } });
    expect(store.rows[0].deleted_at).toBeNull();
    expect(store.rows[0].pin_hmac).not.toBe(oldHmac);
  });

  it('checks a typed line once on its panel before making its PIN', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: { auth: 0 } })));
    expect((await call({ action: 'create', server: 'Vibez', username: 'typed1', password: 'nope' })).body)
      .toMatchObject({ ok: false, reason: 'line_refused' });
    expect(store.rows).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    const exp = Math.floor(Date.UTC(2027, 0, 15) / 1000);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(exp) } })));
    const ok = await call({ action: 'create', server: 'Vibez', username: 'Typed1', password: 'right-pass' });
    expect(ok.body).toMatchObject({ ok: true, pin: { server: 'Vibez', panel_username: 'Typed1', source: 'hub' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('strmz.xyz');
    // Recorded where pin-signin reads the password from.
    const rec = state.queries.find((q) => q.table === 'player_signins' && q.ops.some((o) => o.op === 'upsert'))!;
    expect(opArg(rec, 'upsert')).toMatchObject({ panel_host: 'strmz.xyz', panel_username: 'typed1', panel_password: 'right-pass', expiration_date: '2027-01-15' });
    expect(JSON.stringify(store.rows)).not.toContain('right-pass');
    // The line's limit is keyed by a hash, never the username.
    const keys = state.rpcs.filter((c) => c.name === 'throttle_hit').map((c) => String(c.args.p_key).toLowerCase());
    expect(keys.some((k) => /^signin-pins:line:[0-9a-f]{64}$/.test(k))).toBe(true);
    for (const k of keys) expect(k).not.toContain('typed1');
  });

  it('ensure_missing makes PINs for lines not over that have none', async () => {
    await ensure('strmz.xyz', 'has-one');
    const before = store.rows[0].pin_hmac;
    extra = (q) => {
      if (q.table === 'customer_services') {
        return { data: [
          { customer_id: CUSTOMER, panel_host: 'http://dstreams.xyz:8080', panel_username: 'Active1', service_type: 'dreamstreams', expiration_date: '2999-01-01' },
          { customer_id: CUSTOMER, panel_host: null, panel_username: 'NoHost1', service_type: 'vibeztv', expiration_date: null },
          { customer_id: CUSTOMER, panel_host: 'http://dstreams.xyz:8080', panel_username: 'Gone1', service_type: 'dreamstreams', expiration_date: '2020-01-01' },
          { customer_id: CUSTOMER, panel_host: null, panel_username: 'Plex1', service_type: 'plex', expiration_date: null },
        ] };
      }
      if (q.table === 'player_signins') {
        return { data: [
          { panel_host: 'strmz.xyz', panel_username: 'has-one', matched_customer_id: null, expiration_date: '2999-01-01' },
          { panel_host: 'dstreams.xyz:2083', panel_username: 'gone1', matched_customer_id: null, expiration_date: '2999-02-01' },
        ] };
      }
      return undefined;
    };
    const out = await call({ action: 'ensure_missing' });
    expect(out.body).toEqual({ ok: true, created: 3, more: false });
    expect(store.rows.map((r) => r.line_key).sort()).toEqual(['dstreams.xyz:active1', 'dstreams.xyz:gone1', 'strmz.xyz:has-one', 'strmz.xyz:nohost1']);
    expect(store.rows.find((r) => r.line_key === 'strmz.xyz:has-one')!.pin_hmac).toBe(before);
    expect(store.rows.filter((r) => r.source === 'backfill')).toHaveLength(3);
    expect((await call({ action: 'ensure_missing' })).body).toMatchObject({ ok: true, created: 0 });
  });
});
