// pin-signin: a box sends only the PIN. Wrong PINs are limited per address
// and for everyone (fail closed); a match gets its counts back; 'expired' is
// only ever said after a match, with at most one panel recheck per line per
// 15 minutes; nothing sensitive reaches the logs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, type FakeHandlers, type QueryCall, type RpcCall } from './fakeSupabase';
import { TEST_PANEL_KEY, loadShared, pinStore } from './fakePinStore';

type PinMod = { pinHmac: (pin: string) => Promise<string | null>; encPin: (pin: string) => Promise<string | null> };

const state = vi.hoisted(() => ({
  handlers: {} as FakeHandlers,
  queries: [] as QueryCall[],
  rpcs: [] as RpcCall[],
}));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => {
      const fake = fakeSupabase({
        ...state.handlers,
        onQuery: (q) => { state.queries.push(q); return state.handlers.onQuery?.(q); },
        onRpc: (c) => { state.rpcs.push(c); return state.handlers.onRpc?.(c); },
      });
      return fake.client;
    },
  };
});

const PIN = '4071953862';
const USER = 'Viewer.One@example.com';
const PASSWORD = 'line-pass-77';
const fetchMock = vi.fn();
let handler: (req: Request) => Promise<Response> | Response;
let pins: PinMod;
let store: ReturnType<typeof pinStore>;
let counts: Map<string, number>;
let line: { expiration_date: string | null; panel_password: string | null; panel_host: string | null };
let logs: string[];

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('pin-signin', { PANEL_CRED_KEY: TEST_PANEL_KEY, DISCORD_WEBHOOK_URL: 'https://discord.test/hook' });
  pins = await loadShared<PinMod>('signinPin.ts');
});

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response('{}'));
  state.queries.length = 0;
  state.rpcs.length = 0;
  counts = new Map();
  store = pinStore();
  store.rows.push({
    id: '11111111-1111-4111-8111-111111111111', panel_hostname: 'strmz.xyz', panel_username: USER,
    line_key: `strmz.xyz:${USER.toLowerCase()}`, customer_id: null, pin_hmac: (await pins.pinHmac(PIN))!,
    pin_enc: (await pins.encPin(PIN))!, source: 'capture', created_by: null, created_at: '', updated_at: '',
    disabled_at: null, deleted_at: null, last_used_at: null, use_count: 0,
  });
  line = { expiration_date: day(30), panel_password: await (await loadShared<{ encryptForStorage: (s: string) => Promise<string> }>('panelcrypto.ts')).encryptForStorage(PASSWORD), panel_host: 'strmz.xyz' };
  state.handlers = {
    onQuery: (q) => store.answer(q),
    onRpc: (c) => {
      const key = String(c.args.p_key);
      if (c.name === 'throttle_hit') {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return { data: n };
      }
      if (c.name === 'throttle_refund') {
        counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
        return { data: null };
      }
      if (c.name === 'signin_pin_line') return { data: [line] };
      return undefined;
    },
  };
  logs = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

const signIn = async (pin: unknown, ip = '203.0.113.9') => {
  const res = await handler(new Request('http://fn.test/pin-signin', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ pin }),
  }));
  return (await res.json()) as { ok: boolean; reason?: string; line?: Record<string, unknown> };
};

const panelSays = (userInfo: Record<string, unknown>) =>
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('player_api.php') ? new Response(JSON.stringify({ user_info: userInfo })) : new Response('{}'));
const panelCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('player_api.php'));
const ipKey = () => [...counts.keys()].find((k) => k.startsWith('pin:') && k !== 'pin:all' && k !== 'pin:alert')!;
const pinReads = () => state.queries.filter((q) => q.table === 'signin_pins' && q.ops.some((o) => o.op === 'select'));

describe('pin-signin', () => {
  it('hands back the line for the right PIN, typed with spaces', async () => {
    const out = await signIn('407 195 3862');
    expect(out).toEqual({ ok: true, line: { server: 'Vibez', host: 'http://strmz.xyz', username: USER, password: PASSWORD } });
    expect(state.rpcs.find((c) => c.name === 'signin_pin_used')?.args).toEqual({ p_id: store.rows[0].id });
    expect(panelCalls()).toHaveLength(0); // the stored expiry is ahead: nobody asked
  });

  it('names the DreamStreams panel for a dstreams PIN', async () => {
    store.rows[0].panel_hostname = 'dstreams.xyz';
    const out = await signIn(PIN);
    expect(out.line).toMatchObject({ server: 'DreamStreams', host: 'http://dstreams.xyz:8080' });
  });

  it('answers not_found for a wrong PIN and keeps it counted', async () => {
    const out = await signIn('4071953863');
    expect(out).toEqual({ ok: false, reason: 'not_found' });
    expect(counts.get(ipKey())).toBe(1);
    expect(counts.get('pin:all')).toBe(1);
    expect(state.rpcs.some((c) => c.name === 'throttle_refund')).toBe(false);
  });

  it('gives a matching PIN its counts back, so the limits count wrong PINs only', async () => {
    for (let i = 0; i < 4; i++) await signIn('4071953863');
    for (let i = 0; i < 10; i++) expect((await signIn(PIN)).ok).toBe(true);
    expect(counts.get(ipKey())).toBe(4);
    expect(counts.get('pin:all')).toBe(4);
    expect((await signIn('4071953863')).reason).toBe('not_found'); // the 5th wrong one is still allowed
    expect((await signIn(PIN)).reason).toBe('rate_limited'); // the 6th attempt of any kind is not
  });

  it('answers not_found for a switched-off PIN, the same as a wrong one', async () => {
    store.rows[0].disabled_at = new Date().toISOString();
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'not_found' });
    expect(state.rpcs.some((c) => c.name === 'throttle_refund')).toBe(false);
  });

  it('answers not_found for a deleted PIN', async () => {
    store.rows[0].deleted_at = new Date().toISOString();
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'not_found' });
    expect(state.rpcs.some((c) => c.name === 'signin_pin_line')).toBe(false);
  });

  it('stops an address after 5 wrong PINs in 10 minutes, before any lookup', async () => {
    for (let i = 0; i < 5; i++) expect((await signIn('4071953863')).reason).toBe('not_found');
    const before = pinReads().length;
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(pinReads().length).toBe(before);
    const hit = state.rpcs.find((c) => c.name === 'throttle_hit');
    expect(hit?.args.p_window_ms).toBe(10 * 60 * 1000);
    // Another address is not held up.
    expect((await signIn(PIN, '198.51.100.3')).ok).toBe(true);
  });

  it('pauses for everyone past 300 in 10 minutes, gives the address its count back, and tells Discord once', async () => {
    counts.set('pin:all', 300);
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(counts.get(ipKey())).toBe(0);
    expect(pinReads()).toHaveLength(0);
    await signIn(PIN, '198.51.100.3');
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://discord.test')).length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('https://discord.test'))).toHaveLength(1);
  });

  it('fails closed when the limit counter is down', async () => {
    state.handlers.onRpc = (c) => (c.name === 'throttle_hit' ? { data: null, error: { message: 'down' } } : undefined);
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'rate_limited' });
    expect(pinReads()).toHaveLength(0);
  });

  it('refuses what is not 10 digits without a lookup', async () => {
    expect(await signIn('12345')).toEqual({ ok: false, reason: 'invalid_pin' });
    expect(await signIn(4071953862)).toEqual({ ok: false, reason: 'invalid_pin' });
    expect(pinReads()).toHaveLength(0);
  });

  it("says expired only after a match, once the panel calls the line over", async () => {
    line.expiration_date = day(-2);
    panelSays({ auth: 1, status: 'Expired', exp_date: String(Math.floor(Date.now() / 1000) - 2 * 86400) });
    expect(await signIn('4071953863')).toEqual({ ok: false, reason: 'not_found' });
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'expired' });
    expect(state.rpcs.some((c) => c.name === 'signin_pin_used')).toBe(false);
  });

  it('asks the panel at most once per line in 15 minutes', async () => {
    line.expiration_date = day(-1);
    panelSays({ auth: 1, status: 'Expired' });
    expect((await signIn(PIN)).reason).toBe('expired');
    const asked = panelCalls().length;
    expect(asked).toBeGreaterThan(0);
    expect((await signIn(PIN)).reason).toBe('expired');
    expect((await signIn(PIN, '198.51.100.3')).reason).toBe('expired');
    expect(panelCalls().length).toBe(asked);
    const recheck = state.rpcs.find((c) => c.name === 'throttle_hit' && String(c.args.p_key).startsWith('pin-recheck:'));
    expect(recheck?.args.p_window_ms).toBe(15 * 60 * 1000);
  });

  it('signs a renewed line in and stores the later expiry the panel gives', async () => {
    line.expiration_date = day(-3);
    const later = Math.floor(Date.now() / 1000) + 30 * 86400;
    panelSays({ auth: 1, status: 'Active', exp_date: String(later) });
    state.handlers.onQuery = (q) => {
      if (q.table === 'customer_services' && q.ops.some((o) => o.op === 'select') && !q.ops.some((o) => o.op === 'update')) {
        return { data: [{ id: 'cs1', panel_host: 'http://strmz.xyz', panel_username: USER.toLowerCase(), service_type: 'vibeztv', expiration_date: day(-3) }] };
      }
      if (q.table === 'player_signins' && !q.ops.some((o) => o.op === 'update')) {
        return { data: [{ id: 'ps1', panel_host: 'strmz.xyz', panel_username: USER.toLowerCase(), expiration_date: day(-3) }] };
      }
      return store.answer(q);
    };
    const out = await signIn(PIN);
    expect(out.ok).toBe(true);
    const newExp = new Date(later * 1000).toISOString().slice(0, 10);
    const updates = state.queries.filter((q) => q.ops.some((o) => o.op === 'update') && q.table !== 'signin_pins');
    expect(updates.map((q) => [q.table, eqValue(q, 'id'), opArg(q, 'update')])).toEqual([
      ['customer_services', 'cs1', { expiration_date: newExp }],
      ['player_signins', 'ps1', { expiration_date: newExp }],
    ]);
    // The panel was asked with the stored line, nothing else.
    expect(String(panelCalls()[0][0])).toContain('strmz.xyz');
  });

  it('calls a line whose password changed on the panel over', async () => {
    line.expiration_date = day(0);
    panelSays({ auth: 0 });
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'expired' });
  });

  it("lets the line's last day through when the panel can't be asked again", async () => {
    line.expiration_date = day(0);
    counts.set(`pin-recheck:strmz.xyz:${USER.toLowerCase()}`, 1);
    expect((await signIn(PIN)).ok).toBe(true);
    expect(panelCalls()).toHaveLength(0);
  });

  it('answers error, not the line, when no password on file can be read', async () => {
    line.panel_password = null;
    expect(await signIn(PIN)).toEqual({ ok: false, reason: 'error' });
  });

  it('never logs the PIN, its hash, the username or the password', async () => {
    const hmac = (await pins.pinHmac(PIN))!;
    await signIn(PIN);
    await signIn('4071953863');
    line.expiration_date = day(-1);
    panelSays({ auth: 1, status: 'Expired' });
    await signIn(PIN);
    fetchMock.mockImplementation(async () => new Response('<html>blocked</html>', { status: 401 }));
    counts.delete(`pin-recheck:strmz.xyz:${USER.toLowerCase()}`);
    await signIn(PIN);
    state.handlers.onRpc = (c) => (c.name === 'throttle_hit' ? { data: 1 } : c.name === 'signin_pin_line' ? { error: { code: 'XX000', message: `boom ${USER}` } } : undefined);
    await signIn(PIN);
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n').toLowerCase();
    for (const secret of [PIN, '4071953863', hmac, USER.toLowerCase(), PASSWORD.toLowerCase()]) {
      expect(all).not.toContain(secret.toLowerCase());
    }
  });
});
