/**
 * Messages to the TVs on a line, the box's side (lib/deviceInbox): the inbox
 * key, registering the line, the check-in every 2 minutes and its pauses,
 * the queue, and the owner's two calls — every one through
 * supabase.functions.invoke('device-inbox').
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Body = Record<string, unknown> & { action: string };
const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown> & { action: string }>,
  reply: null as null | ((b: Record<string, unknown> & { action: string }) => unknown),
  demo: false,
  creds: null as null | { host: string; username: string; password: string; output: 'm3u8' },
  prefs: new Map<string, string>(),
  appListeners: {} as Record<string, (s: { isActive: boolean }) => void>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_name: string, { body }: { body: Body }) => {
        h.calls.push(body);
        const r = h.reply?.(body);
        if (r !== undefined) return r;
        if (body.action === 'checkin') return { data: { ok: true, messages: [] }, error: null };
        return { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/lib/xtream', () => ({ loadCreds: vi.fn(async () => h.creds) }));
vi.mock('@/hooks/useVersion', () => ({ loadVersion: async () => ({ version: '1.9.2', versionCode: 70 }) }));
vi.mock('@/lib/appInfo', () => ({ parseDeviceInfo: () => ({ model: 'AFTMM', android: '9' }) }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: h.prefs.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { h.prefs.set(key, value); }),
  },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (ev: string, cb: (s: { isActive: boolean }) => void) => {
      h.appListeners[ev] = cb;
      return { remove: vi.fn() };
    }),
  },
}));

import { supabase } from '@/integrations/supabase/client';
import {
  POLL_MS, REGISTER_EVERY_MS, RETRY_FIRST_MS, __resetDeviceInboxForTests, checkinNow, dismissMessage, getInboxKey,
  listLineDevices, pendingMessages, registerLine, sendLineMessage, startDeviceInbox,
} from './deviceInbox';

const LINE = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw123', output: 'm3u8' as const };
const actions = () => h.calls.map((c) => c.action);
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
/** A non-2xx the way supabase-js hands it back: data null, the Response on the error. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('FunctionsHttpError'), { context: new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) }),
});

let vis: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => vis });
const setVisible = (v: boolean) => { vis = v ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  __resetDeviceInboxForTests();
  h.calls.length = 0;
  h.reply = null;
  h.demo = false;
  h.creds = { ...LINE };
  h.prefs.clear();
  h.appListeners = {};
  vis = 'visible';
  localStorage.clear();
  document.documentElement.className = '';
  vi.mocked(supabase.functions.invoke).mockClear();
});
afterEach(() => { __resetDeviceInboxForTests(); vi.useRealTimers(); });

describe('the inbox key', () => {
  it('is 48 random characters, made once and kept; the same key comes back after a restart', async () => {
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const a = await getInboxKey();
    const b = await getInboxKey();
    expect(a).toMatch(/^[A-Za-z0-9]{48}$/);
    expect(b).toBe(a);
    expect(h.prefs.get('smc-device-inbox-key')).toBe(a);
    __resetDeviceInboxForTests(); // the app starts again
    expect(await getInboxKey()).toBe(a);
    // A second install gets its own.
    h.prefs.clear(); localStorage.clear(); __resetDeviceInboxForTests();
    expect(await getInboxKey()).not.toBe(a);
    // Never logged.
    for (const c of [...log.mock.calls, ...warn.mock.calls]) expect(JSON.stringify(c)).not.toContain(a);
    log.mockRestore(); warn.mockRestore();
  });

  it('falls back to localStorage where Preferences has nothing', async () => {
    localStorage.setItem('smc-device-inbox-key', 'K'.repeat(48));
    expect(await getInboxKey()).toBe('K'.repeat(48));
  });
});

describe('registering the line', () => {
  it('a sign-in registers at once with the line, the key, the box and the app version', async () => {
    expect(await registerLine(LINE, { force: true })).toBe(true);
    const key = await getInboxKey();
    expect(h.calls).toEqual([{
      action: 'register', host: LINE.host, username: 'jsmith', password: 'pw123',
      inbox_key: key, device_label: 'Fire TV AFTMM', app_version: '1.9.2',
    }]);
  });

  it('on app start: once a day per line, and at once for a line that is not the one last registered', async () => {
    startDeviceInbox();
    await settle();
    expect(actions()).toEqual(['register', 'checkin']);

    // Restarted an hour later: same line, registered today — no register.
    __resetDeviceInboxForTests(); h.calls.length = 0;
    vi.setSystemTime(new Date(Date.now() + 60 * 60_000));
    startDeviceInbox();
    await settle();
    expect(actions()).toEqual(['checkin']);

    // A day later it is registered again.
    __resetDeviceInboxForTests(); h.calls.length = 0;
    vi.setSystemTime(new Date(Date.now() + REGISTER_EVERY_MS));
    startDeviceInbox();
    await settle();
    expect(actions()).toEqual(['register', 'checkin']);

    // Another line in use (switched where nothing registered it): straight away.
    __resetDeviceInboxForTests(); h.calls.length = 0;
    h.creds = { ...LINE, username: 'other' };
    startDeviceInbox();
    await settle();
    expect(h.calls[0]).toMatchObject({ action: 'register', username: 'other' });
  });

  it('a refused password is not tried again until it changes or there is a new sign-in; no check-in meanwhile', async () => {
    h.reply = (b) => (b.action === 'register' ? { data: { ok: false, reason: 'bad_line' }, error: null } : undefined);
    startDeviceInbox();
    await settle();
    await settle(POLL_MS);
    await settle(10 * POLL_MS);
    vi.setSystemTime(new Date(Date.now() + 2 * REGISTER_EVERY_MS));
    await settle(POLL_MS);
    // One try, and never a check-in on a line this box is not registered on.
    expect(actions()).toEqual(['register']);

    // The saved password changed: one try at once.
    h.calls.length = 0;
    h.creds = { ...LINE, password: 'new-pass' };
    await settle(POLL_MS);
    expect(h.calls).toEqual([expect.objectContaining({ action: 'register', password: 'new-pass' })]);

    // A new sign-in always tries.
    h.calls.length = 0;
    await registerLine(h.creds, { force: true });
    expect(actions()).toEqual(['register']);
  });

  it('a panel that is down (or too many tries) is tried again after 10 minutes, then 20, 40, ...', async () => {
    h.reply = (b) => (b.action === 'register' ? { data: { ok: false, reason: 'panel_unreachable' }, error: null } : undefined);
    const registers = () => actions().filter((a) => a === 'register').length;
    startDeviceInbox();
    await settle();
    expect(registers()).toBe(1);
    await settle(RETRY_FIRST_MS - POLL_MS);
    expect(registers()).toBe(1);
    await settle(2 * POLL_MS);
    expect(registers()).toBe(2);
    await settle(2 * RETRY_FIRST_MS - 2 * POLL_MS);
    expect(registers()).toBe(2);
    await settle(3 * POLL_MS);
    expect(registers()).toBe(3);
    expect(actions()).not.toContain('checkin');

    // Back up: registered, and checking in from then on.
    h.reply = null;
    await settle(4 * RETRY_FIRST_MS + POLL_MS);
    expect(registers()).toBe(4);
    expect(actions()).toContain('checkin');
  });

  it.each(['unknown_key', 'other_line'])("registers again when a check-in hears '%s'", async (reason) => {
    await registerLine(LINE, { force: true });
    vi.setSystemTime(new Date(Date.now() + 15 * 60_000));
    h.calls.length = 0;
    h.reply = (b) => (b.action === 'checkin' ? { data: { ok: false, reason }, error: null } : undefined);
    await checkinNow();
    expect(actions()).toEqual(['checkin', 'register']);
  });
});

describe('checking in', () => {
  it('every 2 minutes while on screen, at once on return, nothing while hidden', async () => {
    expect(POLL_MS).toBe(2 * 60_000);
    startDeviceInbox();
    await settle();
    expect(actions()).toEqual(['register', 'checkin']);
    await settle(POLL_MS);
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(2);

    setVisible(false);
    await settle(3 * POLL_MS);
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(2);

    setVisible(true);
    await settle();
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(3); // straight away
    await settle(POLL_MS);
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(4);
  });

  it('pauses on the app going to the background (Capacitor appStateChange) too', async () => {
    startDeviceInbox();
    await settle();
    expect(h.appListeners.appStateChange).toBeTypeOf('function');
    h.appListeners.appStateChange({ isActive: false });
    await settle(2 * POLL_MS);
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(1);
    h.appListeners.appStateChange({ isActive: true });
    await settle();
    expect(actions().filter((a) => a === 'checkin')).toHaveLength(2);
  });

  it('names the line it is on and says whether a player is up (the players\' classes on <html>)', async () => {
    await checkinNow();
    expect(h.calls.find((c) => c.action === 'checkin')).toMatchObject({ host: LINE.host, username: 'jsmith', watching: false });
    expect(JSON.stringify(h.calls.find((c) => c.action === 'checkin'))).not.toContain('pw123');
    document.documentElement.classList.add('snowplayer-fullscreen');
    h.calls.length = 0;
    await checkinNow();
    expect(h.calls.find((c) => c.action === 'checkin')).toMatchObject({ watching: true, inbox_key: await getInboxKey() });
  });

  it('demo mode: nothing at all — no key, no register, no check-in', async () => {
    h.demo = true;
    const stop = startDeviceInbox();
    await settle(2 * POLL_MS);
    expect(await registerLine(LINE, { force: true })).toBe(false);
    await checkinNow();
    expect(h.calls).toEqual([]);
    expect(h.prefs.size).toBe(0);
    stop();
  });

  it('no line signed in: nothing is sent', async () => {
    h.creds = null;
    startDeviceInbox();
    await settle(POLL_MS);
    expect(h.calls).toEqual([]);
  });
});

describe('the queue', () => {
  it('holds new messages oldest first, once each; dismiss takes one off and tells the server', async () => {
    const msgs = [
      { id: 'b', body: 'Second', sender: 'owner', created_at: '2026-10-16T11:59:00Z' },
      { id: 'a', body: 'First', sender: 'admin', created_at: '2026-10-16T11:58:00Z' },
    ];
    h.reply = (b) => (b.action === 'checkin' ? { data: { ok: true, messages: msgs }, error: null } : undefined);
    await checkinNow();
    await checkinNow();
    expect(pendingMessages().map((m) => m.id)).toEqual(['a', 'b']);
    expect(pendingMessages()[0]).toMatchObject({ sender: 'admin', body: 'First' });

    h.calls.length = 0;
    await dismissMessage('a');
    expect(pendingMessages().map((m) => m.id)).toEqual(['b']);
    expect(h.calls).toEqual([{ action: 'dismiss', inbox_key: await getInboxKey(), id: 'a' }]);

    // The server still sends it (its copy of the dismiss was lost): not shown
    // again, and the dismiss goes again.
    h.calls.length = 0;
    await checkinNow();
    expect(pendingMessages().map((m) => m.id)).toEqual(['b']);
    expect(h.calls.filter((c) => c.action === 'dismiss')).toEqual([{ action: 'dismiss', inbox_key: await getInboxKey(), id: 'a' }]);
  });

  it('a message handed over again (not closed yet) is not added twice', async () => {
    const m = { id: 'a', body: 'Hi', sender: 'owner', created_at: '2026-10-16T11:58:00Z' };
    h.reply = (b) => (b.action === 'checkin' ? { data: { ok: true, messages: [m] }, error: null } : undefined);
    await checkinNow();
    vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
    await checkinNow();
    expect(pendingMessages().map((x) => x.id)).toEqual(['a']);
  });

  it('a change of line empties the queue, and the new line is registered before any check-in', async () => {
    h.reply = (b) => (b.action === 'checkin' && b.username === 'jsmith'
      ? { data: { ok: true, messages: [{ id: 'a', body: 'Old line', sender: 'owner', created_at: '' }] }, error: null }
      : b.action === 'register' && b.username === 'other' ? { data: { ok: false, reason: 'panel_unreachable' }, error: null } : undefined);
    await checkinNow();
    expect(pendingMessages().map((x) => x.id)).toEqual(['a']);

    h.calls.length = 0;
    h.creds = { ...LINE, username: 'other' };
    await checkinNow();
    expect(pendingMessages()).toEqual([]);
    // The new line could not be registered: no check-in as the old one.
    expect(actions()).toEqual(['register']);
  });

  it('an unknown sender is never shown as Snow Media', async () => {
    h.reply = (b) => (b.action === 'checkin' ? { data: { ok: true, messages: [{ id: 'x', body: 'Hi', sender: 'system', created_at: '' }] }, error: null } : undefined);
    await checkinNow();
    expect(pendingMessages()[0].sender).toBe('owner');
  });
});

describe("the owner's calls", () => {
  it('devices: the list, and the 401 / 403 refusals read from the Response body', async () => {
    h.reply = (b) => (b.action === 'devices'
      ? { data: { ok: true, devices: [{ ref: 'r1', label: 'Fire TV AFTMM', app_version: '1.9.2', last_seen_at: '2026-10-16T11:50:00Z', watching_now: true, registered_at: '2026-10-01T00:00:00Z' }] }, error: null }
      : undefined);
    const ok = await listLineDevices(LINE.host, 'jsmith');
    expect(h.calls).toEqual([{ action: 'devices', host: LINE.host, username: 'jsmith' }]);
    expect(ok).toEqual({ ok: true, devices: [{ ref: 'r1', label: 'Fire TV AFTMM', app_version: '1.9.2', last_seen_at: '2026-10-16T11:50:00Z', watching_now: true, registered_at: '2026-10-01T00:00:00Z' }] });

    h.reply = () => httpError(401, { ok: false, reason: 'not_signed_in' });
    expect(await listLineDevices(LINE.host, 'jsmith')).toEqual({ ok: false, reason: 'not_signed_in' });
    h.reply = () => httpError(403, { ok: false, reason: 'not_owner' });
    expect(await listLineDevices(LINE.host, 'jsmith')).toEqual({ ok: false, reason: 'not_owner' });
    // A body that can't be read still says which.
    h.reply = () => httpError(403, 'Forbidden');
    expect(await listLineDevices(LINE.host, 'jsmith')).toEqual({ ok: false, reason: 'not_owner' });
    h.reply = () => { throw new Error('offline'); };
    expect(await listLineDevices(LINE.host, 'jsmith')).toEqual({ ok: false, reason: 'network' });
  });

  it('send: refs or all, the body trimmed; 400 bad_body and 200 rate_limited come back as reasons', async () => {
    h.reply = (b) => (b.action === 'send' ? { data: { ok: true, sent: 2 }, error: null } : undefined);
    expect(await sendLineMessage(LINE.host, 'jsmith', ['r1', 'r2'], '  Hello  ')).toEqual({ ok: true, sent: 2 });
    expect(await sendLineMessage(LINE.host, 'jsmith', 'all', 'Hi')).toEqual({ ok: true, sent: 2 });
    expect(h.calls).toEqual([
      { action: 'send', host: LINE.host, username: 'jsmith', refs: ['r1', 'r2'], body: 'Hello' },
      { action: 'send', host: LINE.host, username: 'jsmith', refs: 'all', body: 'Hi' },
    ]);

    h.calls.length = 0;
    expect(await sendLineMessage(LINE.host, 'jsmith', 'all', 'x'.repeat(201))).toEqual({ ok: false, reason: 'bad_body' });
    expect(await sendLineMessage(LINE.host, 'jsmith', 'all', '   ')).toEqual({ ok: false, reason: 'bad_body' });
    expect(h.calls).toEqual([]); // never sent

    h.reply = () => httpError(400, { ok: false, reason: 'bad_body' });
    expect(await sendLineMessage(LINE.host, 'jsmith', 'all', 'Hi')).toEqual({ ok: false, reason: 'bad_body' });
    h.reply = () => ({ data: { ok: false, reason: 'rate_limited' }, error: null });
    expect(await sendLineMessage(LINE.host, 'jsmith', 'all', 'Hi')).toEqual({ ok: false, reason: 'rate_limited' });
  });
});
