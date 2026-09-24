import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A fake Realtime channel and edge function, shared across module reloads.
const h = vi.hoisted(() => {
  type Handler = (m: { payload: unknown }) => void;
  const channels: Array<{ topic: string; sent: unknown[]; handlers: Record<string, Handler>; removed: boolean; gone?: boolean }> = [];
  const invoke = { fn: (async () => ({ data: null, error: null })) as (name: string, o: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: unknown }> };
  const calls: Array<Record<string, unknown>> = [];
  const supabase = {
    channel: (topic: string) => {
      const c = { topic, sent: [] as unknown[], handlers: {} as Record<string, Handler>, removed: false };
      channels.push(c);
      const api = {
        on: (_t: string, f: { event: string }, fn: Handler) => { c.handlers[f.event] = fn; return api; },
        subscribe: (cb?: (s: string) => void) => { cb?.('SUBSCRIBED'); return api; },
        send: (m: { payload: unknown }) => { c.sent.push(m.payload); return Promise.resolve('ok'); },
        __c: c,
      };
      return api;
    },
    // Like supabase-js: the channel stays in the client's list until the
    // server has acknowledged the leave.
    removeChannel: (api: { __c: { removed: boolean; gone?: boolean } }) => {
      api.__c.removed = true;
      return new Promise((r) => { setTimeout(() => { api.__c.gone = true; r('ok'); }, 20); });
    },
    getChannels: () => channels.filter((c) => !c.gone).map((c) => ({ topic: `realtime:${c.topic}` })),
    functions: { invoke: (name: string, o: { body: Record<string, unknown> }) => { calls.push(o.body); return invoke.fn(name, o); } },
  };
  const injectKey = { fn: (async () => { throw new Error('web'); }) as (o: { keyCode: number }) => Promise<unknown> };
  return { channels, invoke, calls, supabase, injectKey };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: h.supabase }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { injectKey: (o: { keyCode: number }) => h.injectKey.fn(o) } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => false }));

const SECRET = 'a'.repeat(64);
const SECRET2 = 'b'.repeat(64);
const load = () => import('./phoneRemote');
const live = () => h.channels.filter((c) => !c.removed);
const boxSent = () => live().flatMap((c) => c.sent) as Array<Record<string, unknown>>;
const pairAnswer = (secret = SECRET, code = 'BCDFGHJK') => ({ data: { ok: true, secret, code, expires_at: '2000-01-01T00:00:00Z', expires_in: 600 }, error: null });

beforeEach(() => {
  vi.resetModules();
  h.channels.length = 0;
  h.calls.length = 0;
  h.invoke.fn = async () => pairAnswer();
  h.injectKey.fn = async () => { throw new Error('web'); };
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); });

describe('phoneRemote (the box)', () => {
  it('types the phone’s text into the focused box the way React sees it', async () => {
    const { __phoneRemoteForTests: t } = await load();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    t.onPhoneMessage({ t: 'text', v: 'batman', id: 'p1' });
    expect(input.value).toBe('batman');
    expect(seen).toEqual(['batman']);
  });

  it('ignores a message that says nothing about which phone sent it', async () => {
    const { __phoneRemoteForTests: t, connectedPhones } = await load();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    t.onPhoneMessage({ t: 'text', v: 'nope' } as never);
    const keys: string[] = [];
    window.addEventListener('keydown', (e) => keys.push(e.key));
    t.onPhoneMessage({ t: 'key', k: 'down' } as never);
    expect(input.value).toBe('');
    expect(keys).toEqual([]);
    expect(connectedPhones()).toBe(0);
  });

  it('presses a key off-device as a keydown with the remote’s key', async () => {
    const { pressRemoteKey } = await load();
    const keys: Array<[string, number]> = [];
    const on = (e: KeyboardEvent) => keys.push([e.key, e.keyCode]);
    window.addEventListener('keydown', on);
    await pressRemoteKey('down');
    await pressRemoteKey('back');
    window.removeEventListener('keydown', on);
    expect(keys).toEqual([['ArrowDown', 40], ['Escape', 27]]);
  });

  it('sends Options as the page’s ContextMenu keydown even on a box (the WebView never passes Menu on)', async () => {
    const injected: number[] = [];
    h.injectKey.fn = async (o) => { injected.push(o.keyCode); };
    const { pressRemoteKey } = await load();
    const keys: string[] = [];
    const on = (e: KeyboardEvent) => keys.push(e.key);
    window.addEventListener('keydown', on);
    await pressRemoteKey('menu');
    await pressRemoteKey('down');
    window.removeEventListener('keydown', on);
    expect(keys).toEqual(['ContextMenu']);
    expect(injected).toEqual([20]);
  });

  it('counts a phone as connected once it says hello, and forgets it on bye', async () => {
    const m = await load();
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p2' });
    expect(m.connectedPhones()).toBe(1);
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'bye', id: 'p2' });
    expect(m.connectedPhones()).toBe(0);
  });

  it('while another app is on screen, tells the phone instead of pressing into the hidden page', async () => {
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    const keys: string[] = [];
    window.addEventListener('keydown', (e) => keys.push(e.key));
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'key', k: 'back', id: 'p1' });
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'home', id: 'p1' });
    vis.mockRestore();
    expect(keys).toEqual([]);
    expect(boxSent().filter((p) => p.t === 'away')).toHaveLength(1); // at most one every few seconds
  });

  it('asks the native side, and tells the phone when the box dropped the key', async () => {
    h.injectKey.fn = async () => ({ delivered: false });
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    await m.pressRemoteKey('ok');
    expect(boxSent().some((p) => p.t === 'away')).toBe(true);
  });
});

describe('the box’s channel', () => {
  it('listening again right after letting go waits for the old channel to be gone, then joins', async () => {
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    m.__phoneRemoteForTests.stopListening();
    m.__phoneRemoteForTests.listen(SECRET);
    expect(live()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 40));
    expect(live().map((c) => c.topic)).toEqual([`smc-remote:${SECRET}`]);
    expect(live()[0].sent).toEqual([{ t: 'ready' }]);
  });
});

describe('what the phone is told about the TV’s text box', () => {
  const focus = (attrs: Record<string, string>, value = '') => {
    const el = document.createElement('input');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.value = value;
    document.body.appendChild(el);
    el.focus();
    return el;
  };

  it('sends nothing while no phone is there, however focus moves', async () => {
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    const sentBefore = boxSent().length; // "ready"
    focus({ placeholder: 'Search movies' }, 'bat');
    m.__phoneRemoteForTests.sendFieldState('focus');
    expect(boxSent().length).toBe(sentBefore);
  });

  it('answers every hello, and skips a focus change that changed nothing', async () => {
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    focus({ placeholder: 'Type to search…' }, 'bat');
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p1' });
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p1' });
    m.__phoneRemoteForTests.sendFieldState('focus');
    const fields = boxSent().filter((p) => p.t === 'field');
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({ typing: true, value: 'bat', why: 'hello', label: 'Type to search…' });
  });

  it('shows the phone what is typed in a search box only', async () => {
    const m = await load();
    m.__phoneRemoteForTests.listen(SECRET);
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p1' });
    focus({ placeholder: 'Enter your code' }, 'GIFT-1234');
    m.__phoneRemoteForTests.sendFieldState('focus');
    focus({ type: 'text', placeholder: 'Password' }, 'hunter2'); // a password shown in the clear
    m.__phoneRemoteForTests.sendFieldState('focus');
    focus({ type: 'email', placeholder: 'Email' }, 'me@example.com');
    m.__phoneRemoteForTests.sendFieldState('focus');
    focus({ type: 'password' }, 'hunter2');
    m.__phoneRemoteForTests.sendFieldState('focus');
    focus({ placeholder: 'Search movies & shows…' }, 'batman');
    m.__phoneRemoteForTests.sendFieldState('focus');
    const values = boxSent().filter((p) => p.t === 'field' && p.typing).map((p) => p.value);
    expect(values).toEqual(['', '', '', '', 'batman']);
  });
});

describe('pairing codes on the box', () => {
  it('times the code on the box’s own clock, whatever the server’s says', async () => {
    const m = await load();
    m.holdPairing();
    const before = Date.now();
    const p = await m.getPairingCode();
    expect(p.code).toBe('BCDFGHJK');
    expect(p.url).toBe('https://snowmediaent.com/remote?c=BCDFGHJK');
    expect(p.expiresAt).toBeGreaterThanOrEqual(before + 600_000);
    expect(p.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(m.formatPairingCode(p.code)).toBe('BCDF-GHJK');
  });

  it('shares one request between overlapping calls, and reuses the code while it has time left', async () => {
    const m = await load();
    m.holdPairing();
    const [a, b] = await Promise.all([m.getPairingCode(), m.getPairingCode()]);
    expect(a).toBe(b);
    await m.getPairingCode();
    expect(h.calls.filter((c) => c.op === 'pair')).toHaveLength(1);
    expect(live().map((c) => c.topic)).toEqual([`smc-remote:${SECRET}`]);
  });

  it('does not start listening for a QR that has already gone', async () => {
    let answer: (v: unknown) => void = () => {};
    h.invoke.fn = () => new Promise((r) => { answer = r; });
    const m = await load();
    m.holdPairing();
    const p = m.getPairingCode();
    m.releasePairingListener();
    answer(pairAnswer());
    await p;
    expect(live()).toHaveLength(0);
  });

  it('lets go of the code and the channel a minute after the last QR goes', async () => {
    vi.useFakeTimers();
    const m = await load();
    m.holdPairing();
    await m.getPairingCode();
    expect(live()).toHaveLength(1);
    m.releasePairingListener();
    await vi.advanceTimersByTimeAsync(30_000);
    m.holdPairing(); // back within the minute: same code, no new request
    await m.getPairingCode();
    m.releasePairingListener();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(live()).toHaveLength(0);
    expect(h.calls.map((c) => c.op)).toEqual(['pair', 'release']);
  });

  it('"Unpair all" drops a pairing answer that was still on its way', async () => {
    localStorage.setItem('smc-phone-remote-v1', JSON.stringify({ secret: SECRET, paired: true }));
    let answer: (v: unknown) => void = () => {};
    h.invoke.fn = (_n, o) => (o.body.op === 'pair' ? new Promise((r) => { answer = r; }) : Promise.resolve({ data: { ok: true }, error: null }));
    const m = await load();
    m.holdPairing();
    const round = m.pairingRound();
    const p = m.getPairingCode().catch((e: Error) => e.message);
    await m.unpairAllPhones();
    answer(pairAnswer(SECRET));
    expect(await p).toBe('unpaired');
    expect(localStorage.getItem('smc-phone-remote-v1')).toBeNull();
    expect(live()).toHaveLength(0);
    // The QRs on screen are told to fetch a new pairing.
    expect(m.pairingRound()).not.toBe(round);
    expect(h.calls.find((c) => c.op === 'reset')).toMatchObject({ secret: SECRET });
  });
});

describe('a phone asking to join', () => {
  it('asks the TV, uses up the code on screen, and listens for good once allowed', async () => {
    const m = await load();
    m.holdPairing();
    await m.getPairingCode();
    const round = m.pairingRound();
    const ch = live()[0];
    ch.handlers.server({ payload: { t: 'request', rid: '0123456789abcdef', device: 'An iPhone' } });
    expect(m.pendingPhoneRequest()).toMatchObject({ rid: '0123456789abcdef', device: 'An iPhone' });
    expect(m.pairingRound()).toBe(round + 1);
    expect(m.isPaired()).toBe(false);

    h.invoke.fn = async () => ({ data: { ok: true }, error: null });
    expect(await m.answerPhoneRequest('0123456789abcdef', true)).toBe(true);
    expect(h.calls.find((c) => c.op === 'answer')).toMatchObject({ rid: '0123456789abcdef', allow: true, secret: SECRET });
    expect(m.isPaired()).toBe(true);
    expect(m.pendingPhoneRequest()).toBeNull();
    // A repeat of the same request (the phone's claim re-sends it) isn't asked again.
    ch.handlers.server({ payload: { t: 'request', rid: '0123456789abcdef', device: 'An iPhone' } });
    expect(m.pendingPhoneRequest()).toBeNull();
    // Released QR: still listening, because a phone was allowed.
    m.releasePairingListener();
    expect(live()).toHaveLength(1);
  });

  it('shows only the phrases the server uses, never text from the channel', async () => {
    const m = await load();
    m.__phoneRemoteForTests.onServerMessage({ t: 'request', rid: 'fedcba9876543210', device: 'Your account is locked. Call 555-0100' });
    expect(m.pendingPhoneRequest()?.device).toBe('A phone');
    m.__phoneRemoteForTests.onServerMessage({ t: 'request', rid: 'nothex', device: 'An iPhone' });
    expect(m.pendingPhoneRequest()?.rid).toBe('fedcba9876543210');
  });

  it('a phone that says hello never makes the box listen at start-up by itself', async () => {
    localStorage.setItem('smc-phone-remote-v1', JSON.stringify({ secret: SECRET2 }));
    const m = await load();
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p9' });
    expect(m.isPaired()).toBe(false);
  });
});
