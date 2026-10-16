// device-inbox: a TV puts its inbox on a line only once the line's panel
// accepts it, picks each message up once, and only the line's owner or an
// admin can list a line's TVs or message them.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, queries: [] as QueryCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => fakeSupabase({
      ...state.handlers,
      onQuery: (q) => { if (!state.queries.includes(q)) state.queries.push(q); return state.handlers.onQuery?.(q); },
    }).client,
  };
});

const ADMIN = { id: '44444444-4444-4444-8444-444444444444', email: 'support@example.com' };
const OWNER = { id: '55555555-5555-4555-8555-555555555555', email: 'family@example.com' };
const STRANGER = { id: '66666666-6666-4666-8666-666666666666', email: 'someone@example.com' };
const CUSTOMER = '77777777-7777-4777-8777-777777777777';
const KEY = 'tv1_' + 'aB3-_'.repeat(8);
const PASSWORD = 'line-pass-123';
const LINE = { host: 'strmz.xyz', username: 'family@example.com' };
const TV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TV_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ELSEWHERE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';

const sha256 = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let handler: (req: Request) => Promise<Response> | Response;
const fetchMock = vi.fn();

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('device-inbox');
});

const call = async (body: Record<string, unknown>, as?: string | null) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' };
  if (as) headers.Authorization = `Bearer ${userToken(as)}`;
  const res = await handler(new Request('http://fn.test/device-inbox', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const panelSays = (userInfo: Record<string, unknown>) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ user_info: userInfo, server_info: {} }), { status: 200 }));

const queriesOf = (table: string, op?: string) =>
  state.queries.filter((q) => q.table === table && (!op || q.ops.some((o) => o.op === op)));
const opArgs = (q: QueryCall, op: string) => q.ops.find((o) => o.op === op)?.args;

// The line's TVs as the database holds them (key_hash included, as a
// select * would return it).
const LINE_TVS = [
  { id: TV_A, key_hash: 'f'.repeat(64), device_label: 'Bedroom', app_version: '1.9.2', last_seen_at: ago(60 * MIN), watching_at: null, registered_at: ago(3 * DAY) },
  { id: TV_B, key_hash: 'e'.repeat(64), device_label: 'Kitchen', app_version: '1.9.1', last_seen_at: ago(1 * MIN), watching_at: ago(10 * MIN), registered_at: ago(9 * DAY) },
  { id: TV_C, key_hash: 'd'.repeat(64), device_label: 'Living room', app_version: '1.9.2', last_seen_at: ago(120 * MIN), watching_at: ago(1 * MIN), registered_at: ago(1 * DAY) },
];

/** device_inbox as seen by devices/send: the line's TVs, narrowed by .in('id', refs) like the database would. */
const lineTvsQuery = (q: QueryCall) => {
  const refs = opArgs(q, 'in')?.[1] as string[] | undefined;
  return { data: LINE_TVS.filter((t) => !refs || refs.includes(t.id)) };
};

beforeEach(() => {
  fetchMock.mockReset();
  state.queries.length = 0;
  state.handlers = {
    userForToken: (t) => [ADMIN, OWNER, STRANGER].find((u) => t === userToken(u.id)) ?? null,
    onRpc: (c) => (c.name === 'has_role' ? { data: c.args._user_id === ADMIN.id && c.args._role === 'admin' } : undefined),
    onQuery: (q) => {
      if (q.table === 'player_login_throttle') return { data: null };
      if (q.table === 'player_signins') {
        return eqValue(q, 'panel_host') === LINE.host && eqValue(q, 'panel_username') === LINE.username
          ? { data: { matched_customer_id: CUSTOMER } } : { data: null };
      }
      if (q.table === 'customers') {
        return eqValue(q, 'id') === CUSTOMER && eqValue(q, 'user_id') === OWNER.id ? { data: { id: CUSTOMER } } : { data: null };
      }
      if (q.table === 'device_inbox' && eqValue(q, 'key_hash') === undefined) return lineTvsQuery(q);
      return undefined;
    },
  };
});

afterEach(() => vi.restoreAllMocks());

describe('device-inbox: register', () => {
  const register = (extra: Record<string, unknown> = {}) =>
    call({ action: 'register', host: 'strmz.xyz', username: 'Family@Example.com', password: PASSWORD, inbox_key: KEY, ...extra });

  it('registers nothing when the panel refuses the line or cannot be reached', async () => {
    panelSays({ auth: 0 });
    expect((await register()).body).toEqual({ ok: false, reason: 'bad_line' });
    fetchMock.mockImplementation(async () => new Response('<html>blocked</html>', { status: 401 }));
    expect((await register()).body).toEqual({ ok: false, reason: 'panel_unreachable' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // every base and agent was tried
    expect(queriesOf('device_inbox')).toHaveLength(0);
  });

  it('keeps the key as its sha256, names the line as player_signins does, and tidies the label', async () => {
    panelSays({ auth: 1, status: 'Active' });
    const out = await register({
      host: ' HTTPS://STRMZ.XYZ/ ', username: ' Family@Example.com ',
      device_label: '  Living\nroom   TV ' + 'x'.repeat(100), app_version: '1.9.2 (build 70) with a long suffix',
    });
    expect(out).toEqual({ status: 200, body: { ok: true } });
    // The panel was asked about this line, as typed.
    expect(String(fetchMock.mock.calls[0][0])).toContain(`username=${encodeURIComponent('Family@Example.com')}`);
    const up = queriesOf('device_inbox', 'upsert')[0];
    const row = opArg(up, 'upsert') as Record<string, string | null>;
    expect(opArgs(up, 'upsert')?.[1]).toEqual({ onConflict: 'key_hash' });
    expect(row).toMatchObject({ key_hash: await sha256(KEY), panel_host: 'strmz.xyz', panel_username: 'family@example.com', watching_at: null });
    expect(row.device_label).toMatch(/^Living room TV x+$/);
    expect(Array.from(row.device_label!).length).toBe(60);
    expect(row.app_version).toBe('1.9.2 (build 70) wit');
    expect(row.registered_at).toBe(row.last_seen_at);
    // Neither the key nor the password is stored.
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);

    // dstreams.xyz is named the way capture-player-signin names it.
    state.queries.length = 0;
    await register({ host: 'http://dstreams.xyz' });
    expect(opArg(queriesOf('device_inbox', 'upsert')[0], 'upsert')).toMatchObject({ panel_host: 'dstreams.xyz:8080' });
  });

  it('moves a key that registers for another line, and leaves the label alone when none is sent', async () => {
    panelSays({ auth: 1 });
    const hash = await sha256(KEY);
    let current = { panel_host: 'strmz.xyz', panel_username: 'old-line@example.com' };
    const base = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => (q.table === 'device_inbox' && eqValue(q, 'key_hash') === hash && opArg(q, 'select') ? { data: current } : base(q));
    await register();
    const moved = opArg(queriesOf('device_inbox', 'upsert')[0], 'upsert') as Record<string, unknown>;
    expect(moved).toMatchObject({ panel_username: 'family@example.com', watching_at: null });
    expect(moved.registered_at).toBeTruthy();
    expect(moved).not.toHaveProperty('device_label');

    // Same line again: still registered since the first time.
    state.queries.length = 0;
    current = { panel_host: 'strmz.xyz', panel_username: 'family@example.com' };
    await register({ device_label: 'Den' });
    const again = opArg(queriesOf('device_inbox', 'upsert')[0], 'upsert') as Record<string, unknown>;
    expect(again).not.toHaveProperty('registered_at');
    expect(again).toMatchObject({ device_label: 'Den', last_seen_at: expect.any(String) });
  });

  it('refuses a malformed request or a panel off the allowlist without asking anyone', async () => {
    panelSays({ auth: 1 });
    for (const inbox_key of ['short', 'x'.repeat(129), 'has spaces in it but is long enough ok', 'bad!' + 'a'.repeat(40), 42]) {
      expect(await register({ inbox_key })).toEqual({ status: 400, body: { ok: false, reason: 'bad_request' } });
    }
    expect(await register({ password: '' })).toMatchObject({ status: 400 });
    expect(await register({ username: '   ' })).toMatchObject({ status: 400 });
    expect((await register({ host: 'evil.example.com' })).body).toEqual({ ok: false, reason: 'bad_line' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queriesOf('device_inbox')).toHaveLength(0);
  });

  it('limits register per inbox key and per line before the panel is asked', async () => {
    panelSays({ auth: 1 });
    const hash = await sha256(KEY);
    const full = (prefix: string, count: number) => {
      const base = state.handlers.onQuery!;
      state.handlers.onQuery = (q) => (q.table === 'player_login_throttle' && String(eqValue(q, 'ip_hash')).startsWith(prefix)
        ? { data: { window_start: new Date().toISOString(), count } } : base(q));
    };
    full(`dib:key:${hash}`, 10);
    expect((await register()).body).toEqual({ ok: false, reason: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();

    // A fresh key for the same line: the line's own limit still holds.
    full('dib:line:strmz.xyz:family@example.com', 30);
    expect((await register({ inbox_key: 'tv2_' + 'z'.repeat(40) })).body).toEqual({ ok: false, reason: 'rate_limited' });
    expect(fetchMock).not.toHaveBeenCalled();
    // The throttle never holds the key itself.
    expect(state.queries.some((q) => JSON.stringify(q.ops).includes(KEY))).toBe(false);
  });
});

describe('device-inbox: checkin and dismiss', () => {
  const DEVICE: { id: string; panel_host: string; panel_username: string; last_seen_at?: string | null; watching_at?: string | null } =
    { id: TV_A, panel_host: LINE.host, panel_username: LINE.username };
  const withDevice = async (device: typeof DEVICE | null, messages: { waiting?: unknown[]; taken?: unknown[] } = {}) => {
    const hash = await sha256(KEY);
    const base = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => {
      if (q.table === 'device_inbox' && eqValue(q, 'key_hash') !== undefined) return { data: eqValue(q, 'key_hash') === hash ? device : null };
      if (q.table === 'device_messages' && opArg(q, 'update') && opArgs(q, 'select')) {
        const ids = opArgs(q, 'in')?.[1] as string[] | undefined;
        return { data: (messages.taken ?? []).filter((m) => !ids || ids.includes((m as { id: string }).id)) };
      }
      if (q.table === 'device_messages' && opArg(q, 'select')) return { data: messages.waiting ?? [] };
      return base(q);
    };
  };

  it('an unknown key is told so (the app registers again), looked up by its hash only', async () => {
    await withDevice(null);
    expect(await call({ action: 'checkin', inbox_key: KEY, ...LINE, watching: true })).toEqual({ status: 200, body: { ok: false, reason: 'unknown_key' } });
    expect(eqValue(queriesOf('device_inbox')[0], 'key_hash')).toBe(await sha256(KEY));
    expect(state.queries.some((q) => JSON.stringify(q.ops).includes(KEY))).toBe(false);
    expect(queriesOf('device_messages')).toHaveLength(0);
    expect(await call({ action: 'dismiss', inbox_key: KEY, id: M1 })).toEqual({ status: 200, body: { ok: false, reason: 'unknown_key' } });
    expect(queriesOf('device_messages')).toHaveLength(0);
  });

  it('hands over waiting messages oldest first and marks them delivered', async () => {
    await withDevice(DEVICE, {
      waiting: [{ id: M1 }, { id: M2 }],
      taken: [
        { id: M2, body: 'Second', sender: 'admin', created_at: ago(1 * MIN), device_id: TV_A },
        { id: M1, body: 'First', sender: 'owner', created_at: ago(5 * MIN), device_id: TV_A },
      ],
    });
    const out = await call({ action: 'checkin', inbox_key: KEY, ...LINE, watching: true });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    const messages = out.body.messages as Array<Record<string, unknown>>;
    expect(messages.map((m) => m.id)).toEqual([M1, M2]);
    expect(Object.keys(messages[0]).sort()).toEqual(['body', 'created_at', 'id', 'sender']);
    expect(messages[0]).toMatchObject({ body: 'First', sender: 'owner' });

    // Seen now, and watching.
    const stamp = opArg(queriesOf('device_inbox', 'update')[0], 'update') as Record<string, string>;
    expect(stamp.watching_at).toBe(stamp.last_seen_at);
    // Only this box's unclosed, unexpired messages on its current line, five at most:
    // never handed over, or handed over 5 minutes ago and still not closed.
    const read = queriesOf('device_messages').find((q) => !opArg(q, 'update'))!;
    expect(eqValue(read, 'device_id')).toBe(TV_A);
    expect(eqValue(read, 'panel_host')).toBe(LINE.host);
    expect(eqValue(read, 'panel_username')).toBe(LINE.username);
    expect(read.ops.filter((o) => o.op === 'is').map((o) => o.args)).toEqual([['dismissed_at', null]]);
    const cutoff = /^delivered_at\.is\.null,delivered_at\.lt\."([^"]+)"$/.exec(String(opArg(read, 'or')))?.[1];
    expect(Math.abs(Date.now() - 5 * MIN - Date.parse(String(cutoff)))).toBeLessThan(MIN);
    expect(opArgs(read, 'gt')?.[0]).toBe('expires_at');
    expect(opArgs(read, 'order')).toEqual(['created_at', { ascending: true }]);
    expect(opArgs(read, 'limit')).toEqual([5]);
    // Stamped only if still not held (two check-ins never both get one); no
    // or() on an update, which PostgREST refuses.
    const marks = queriesOf('device_messages', 'update');
    expect(marks).toHaveLength(1);
    expect(opArg(marks[0], 'update')).toEqual({ delivered_at: expect.any(String) });
    expect(opArgs(marks[0], 'in')).toEqual(['id', [M1, M2]]);
    expect(eqValue(marks[0], 'device_id')).toBe(TV_A);
    expect(marks[0].ops.filter((o) => o.op === 'is').map((o) => o.args)).toEqual([['dismissed_at', null], ['delivered_at', null]]);
    expect(marks[0].ops.some((o) => o.op === 'or')).toBe(false);
  });

  it('hands a message over again 5 minutes on if the TV never closed it, still only once per stamp', async () => {
    await withDevice(DEVICE, {
      waiting: [{ id: M1, delivered_at: ago(6 * MIN) }, { id: M2, delivered_at: null }],
      taken: [
        { id: M1, body: 'First', sender: 'owner', created_at: ago(10 * MIN) },
        { id: M2, body: 'Second', sender: 'owner', created_at: ago(1 * MIN) },
      ],
    });
    const out = await call({ action: 'checkin', inbox_key: KEY, ...LINE, watching: false });
    expect((out.body.messages as Array<{ id: string }>).map((m) => m.id)).toEqual([M1, M2]);
    const marks = queriesOf('device_messages', 'update');
    const again = marks.find((q) => opArgs(q, 'lt'))!;
    expect(opArgs(again, 'in')).toEqual(['id', [M1]]);
    expect(opArgs(again, 'lt')?.[0]).toBe('delivered_at');
    expect(Math.abs(Date.now() - 5 * MIN - Date.parse(String(opArgs(again, 'lt')?.[1])))).toBeLessThan(MIN);
    const fresh = marks.find((q) => !opArgs(q, 'lt'))!;
    expect(opArgs(fresh, 'in')).toEqual(['id', [M2]]);
    expect(fresh.ops.filter((o) => o.op === 'is').map((o) => o.args)).toContainEqual(['delivered_at', null]);
  });

  it('a box signed into another line hears other_line: nothing stamped, nothing handed over', async () => {
    await withDevice(DEVICE, { waiting: [{ id: M1 }], taken: [{ id: M1, body: 'Old line', sender: 'owner', created_at: ago(MIN) }] });
    for (const line of [{ host: 'strmz.xyz', username: 'neighbour@example.com' }, { host: 'dstreams.xyz', username: LINE.username }, { host: 'evil.example.com', username: LINE.username }]) {
      expect(await call({ action: 'checkin', inbox_key: KEY, ...line, watching: true })).toEqual({ status: 200, body: { ok: false, reason: 'other_line' } });
    }
    expect(queriesOf('device_inbox', 'update')).toHaveLength(0);
    expect(queriesOf('device_messages')).toHaveLength(0);
    // The same line, however it is typed, is this one.
    expect((await call({ action: 'checkin', inbox_key: KEY, host: 'HTTPS://STRMZ.XYZ/', username: ' Family@Example.com ', watching: true })).body.ok).toBe(true);
    // A check-in that names no line is malformed.
    expect(await call({ action: 'checkin', inbox_key: KEY, watching: true })).toMatchObject({ status: 400, body: { reason: 'bad_request' } });
  });

  it('writes the device row only when the owner\'s list would change', async () => {
    const stampOf = async (device: typeof DEVICE, watching: boolean) => {
      state.queries.length = 0;
      await withDevice(device);
      await call({ action: 'checkin', inbox_key: KEY, ...LINE, watching });
      const q = queriesOf('device_inbox', 'update')[0];
      return q ? opArg(q, 'update') : null;
    };
    // Seen 2 minutes ago, not watching: nothing to write.
    expect(await stampOf({ ...DEVICE, last_seen_at: ago(2 * MIN), watching_at: null }, false)).toBeNull();
    // Seen 6 minutes ago: last_seen_at only.
    expect(await stampOf({ ...DEVICE, last_seen_at: ago(6 * MIN), watching_at: null }, false)).toEqual({ last_seen_at: expect.any(String) });
    // Watching, stamped a minute ago: still fresh.
    expect(await stampOf({ ...DEVICE, last_seen_at: ago(MIN), watching_at: ago(MIN) }, true)).toBeNull();
    // Watching, stamped 2 minutes ago: kept fresh.
    expect(await stampOf({ ...DEVICE, last_seen_at: ago(2 * MIN), watching_at: ago(2 * MIN) }, true))
      .toEqual({ last_seen_at: expect.any(String), watching_at: expect.any(String) });
    // Stopped watching: cleared at once, so the list stops saying "Watching now".
    expect(await stampOf({ ...DEVICE, last_seen_at: ago(MIN), watching_at: ago(MIN) }, false)).toEqual({ last_seen_at: expect.any(String), watching_at: null });
  });

  it('nothing waiting: an empty list, nothing marked; not watching leaves watching_at alone', async () => {
    await withDevice(DEVICE);
    expect((await call({ action: 'checkin', inbox_key: KEY, ...LINE, watching: false })).body).toEqual({ ok: true, messages: [] });
    expect(queriesOf('device_messages', 'update')).toHaveLength(0);
    expect(opArg(queriesOf('device_inbox', 'update')[0], 'update')).toEqual({ last_seen_at: expect.any(String) });
  });

  it('dismiss marks only a message that belongs to the key\'s own device', async () => {
    await withDevice(DEVICE);
    expect(await call({ action: 'dismiss', inbox_key: KEY, id: M2 })).toEqual({ status: 200, body: { ok: true } });
    const q = queriesOf('device_messages', 'update')[0];
    expect(opArg(q, 'update')).toEqual({ dismissed_at: expect.any(String) });
    expect(eqValue(q, 'id')).toBe(M2);
    expect(eqValue(q, 'device_id')).toBe(TV_A);
    expect(await call({ action: 'dismiss', inbox_key: KEY, id: 'not-a-uuid' })).toMatchObject({ status: 400, body: { reason: 'bad_request' } });
    expect(await call({ action: 'checkin', inbox_key: 'short', ...LINE, watching: true })).toMatchObject({ status: 400, body: { reason: 'bad_request' } });
  });
});

describe('device-inbox: devices and send', () => {
  const devices = (as: string | null, line = LINE) => call({ action: 'devices', ...line }, as);
  const send = (as: string | null, extra: Record<string, unknown> = {}) =>
    call({ action: 'send', host: 'strmz.xyz', username: 'Family@Example.com', refs: 'all', body: 'Game starts at 8!', ...extra }, as);
  const inserted = () => (queriesOf('device_messages', 'insert')[0] ? opArg(queriesOf('device_messages', 'insert')[0], 'insert') : undefined) as
    Array<Record<string, unknown>> | undefined;

  it('needs a signed-in caller who owns the line or is an admin', async () => {
    expect(await devices(null)).toEqual({ status: 401, body: { ok: false, reason: 'not_signed_in' } });
    expect(await send(null)).toEqual({ status: 401, body: { ok: false, reason: 'not_signed_in' } });
    expect(await devices('99999999-9999-4999-8999-999999999999')).toEqual({ status: 401, body: { ok: false, reason: 'not_signed_in' } });
    expect(await devices(STRANGER.id)).toEqual({ status: 403, body: { ok: false, reason: 'not_owner' } });
    expect(await send(STRANGER.id)).toEqual({ status: 403, body: { ok: false, reason: 'not_owner' } });
    // The owner of one line is not the owner of another.
    expect(await devices(OWNER.id, { host: 'strmz.xyz', username: 'neighbour@example.com' })).toMatchObject({ status: 403 });
    expect(queriesOf('device_inbox')).toHaveLength(0);
    expect(queriesOf('device_messages')).toHaveLength(0);
  });

  it('the owner sees the line\'s TVs seen in 30 days, watching first, and never a key hash', async () => {
    const out = await devices(OWNER.id);
    expect(out.status).toBe(200);
    const list = out.body.devices as Array<Record<string, unknown>>;
    expect(list.map((d) => d.ref)).toEqual([TV_C, TV_B, TV_A]);
    expect(list.map((d) => d.watching_now)).toEqual([true, false, false]);
    expect(list[0]).toEqual({
      ref: TV_C, label: 'Living room', app_version: '1.9.2', last_seen_at: LINE_TVS[2].last_seen_at, watching_now: true, registered_at: LINE_TVS[2].registered_at,
    });
    expect(JSON.stringify(out.body)).not.toContain('key_hash');
    expect(JSON.stringify(out.body)).not.toContain('f'.repeat(64));
    const q = queriesOf('device_inbox')[0];
    expect(String(opArg(q, 'select'))).not.toContain('key_hash');
    expect(eqValue(q, 'panel_host')).toBe(LINE.host);
    expect(eqValue(q, 'panel_username')).toBe(LINE.username);
    const since = Date.parse(String(opArgs(q, 'gte')?.[1]));
    expect(opArgs(q, 'gte')?.[0]).toBe('last_seen_at');
    expect(Math.abs(Date.now() - 30 * DAY - since)).toBeLessThan(MIN);
  });

  it('an admin may list and message any line', async () => {
    const other = { host: 'dstreams.xyz', username: 'Someone' };
    expect((await devices(ADMIN.id, other)).body.ok).toBe(true);
    const q = queriesOf('device_inbox')[0];
    expect(eqValue(q, 'panel_host')).toBe('dstreams.xyz:8080');
    expect(eqValue(q, 'panel_username')).toBe('someone');
    expect(await send(ADMIN.id, { refs: [TV_A] })).toEqual({ status: 200, body: { ok: true, sent: 1 } });
    expect(inserted()).toEqual([{
      device_id: TV_A, panel_host: 'strmz.xyz', panel_username: 'family@example.com', body: 'Game starts at 8!', sender: 'admin', created_by: ADMIN.id,
    }]);
  });

  it('send reaches only the line\'s own TVs; picked ones seen in 30 days, "all" the ones seen in 7', async () => {
    const out = await send(OWNER.id, { refs: [TV_A, TV_B, ELSEWHERE, TV_A], body: '  Dinner is ready  ' });
    expect(out).toEqual({ status: 200, body: { ok: true, sent: 2 } });
    const q = queriesOf('device_inbox')[0];
    expect(eqValue(q, 'panel_host')).toBe(LINE.host);
    expect(eqValue(q, 'panel_username')).toBe(LINE.username);
    expect(opArgs(q, 'in')).toEqual(['id', [TV_A, TV_B, ELSEWHERE]]);
    expect(opArgs(q, 'gte')?.[0]).toBe('last_seen_at');
    expect(Math.abs(Date.now() - 30 * DAY - Date.parse(String(opArgs(q, 'gte')?.[1])))).toBeLessThan(MIN);
    expect(inserted()!.map((r) => r.device_id)).toEqual([TV_A, TV_B]);
    expect(inserted()![0]).toEqual({
      device_id: TV_A, panel_host: 'strmz.xyz', panel_username: 'family@example.com', body: 'Dinner is ready', sender: 'owner', created_by: OWNER.id,
    });

    state.queries.length = 0;
    expect((await send(OWNER.id, { refs: 'all' })).body).toEqual({ ok: true, sent: 3 });
    expect(opArgs(queriesOf('device_inbox')[0], 'in')).toBeUndefined();
    expect(Math.abs(Date.now() - 7 * DAY - Date.parse(String(opArgs(queriesOf('device_inbox')[0], 'gte')?.[1])))).toBeLessThan(MIN);
    expect(inserted()!.map((r) => r.device_id)).toEqual([TV_A, TV_B, TV_C]);

    // None of the picked TVs on this line: nothing sent.
    state.queries.length = 0;
    expect((await send(OWNER.id, { refs: [ELSEWHERE] })).body).toEqual({ ok: true, sent: 0 });
    expect(inserted()).toBeUndefined();
  });

  it('a message is 1 to 200 characters once trimmed', async () => {
    for (const body of ['', '    ', 'x'.repeat(201), 42, null]) {
      expect(await send(OWNER.id, { body })).toEqual({ status: 400, body: { ok: false, reason: 'bad_body' } });
    }
    expect(inserted()).toBeUndefined();
    // 200 characters (as Postgres counts them, not UTF-16 units) is fine.
    expect((await send(OWNER.id, { body: '🎉'.repeat(200), refs: [TV_A] })).body).toEqual({ ok: true, sent: 1 });
    expect((await send(OWNER.id, { body: ` ${'y'.repeat(200)} `, refs: [TV_A] })).body).toEqual({ ok: true, sent: 1 });
  });

  it('refs must be a list of TV refs or "all"', async () => {
    for (const refs of [[], ['not-a-uuid'], 'some', undefined, [42]]) {
      expect(await send(OWNER.id, { refs })).toMatchObject({ status: 400, body: { reason: 'bad_request' } });
    }
    expect(inserted()).toBeUndefined();
  });

  it('allows 10 sends per line an hour, however many TVs each reaches', async () => {
    let used = 0;
    const base = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => (q.table === 'player_login_throttle' && eqValue(q, 'ip_hash') === 'dim:send:strmz.xyz:family@example.com'
      ? { data: { window_start: new Date().toISOString(), count: used } } : base(q));
    // A send to all three TVs is one send.
    used = 8;
    expect((await send(OWNER.id, { refs: 'all' })).body).toEqual({ ok: true, sent: 3 });
    used = 9;
    expect((await send(OWNER.id, { refs: [TV_A, TV_B] })).body).toEqual({ ok: true, sent: 2 });
    state.queries.length = 0;
    used = 10;
    expect((await send(OWNER.id, { refs: [TV_A] })).body).toEqual({ ok: false, reason: 'rate_limited' });
    expect(inserted()).toBeUndefined();
    // Admins too.
    expect((await send(ADMIN.id, { refs: [TV_A] })).body).toEqual({ ok: false, reason: 'rate_limited' });
    // A send that reaches no TV is not counted.
    state.queries.length = 0;
    expect((await send(OWNER.id, { refs: [ELSEWHERE] })).body).toEqual({ ok: true, sent: 0 });
    expect(queriesOf('player_login_throttle')).toHaveLength(0);
  });
});

describe('device-inbox: requests and logs', () => {
  it('any other action, or a body that is not a JSON object, is a bad request', async () => {
    expect(await call({ action: 'nope' })).toEqual({ status: 400, body: { ok: false, reason: 'bad_request' } });
    expect(await call({})).toEqual({ status: 400, body: { ok: false, reason: 'bad_request' } });
    const res = await handler(new Request('http://fn.test/device-inbox', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, reason: 'bad_request' });
  });

  it('never logs an inbox key, a password or a message', async () => {
    const logged: unknown[] = [];
    for (const m of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, m).mockImplementation((...a) => { logged.push(...a); });
    fetchMock.mockImplementation(async () => new Response('<html>blocked</html>', { status: 401 }));
    await call({ action: 'register', host: 'strmz.xyz', username: 'Family@Example.com', password: PASSWORD, inbox_key: KEY });
    const base = state.handlers.onQuery!;
    state.handlers.onQuery = (q) => (q.table === 'device_messages' && opArg(q, 'insert') ? { error: { message: 'insert failed' } } : base(q));
    expect((await call({ action: 'send', ...LINE, refs: 'all', body: 'Secret party at 9' }, OWNER.id)).status).toBe(500);
    expect(logged.length).toBeGreaterThan(0);
    const text = logged.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('Secret party');
  });
});
