/**
 * Device Health, the box's side (lib/deviceHealth): the verdict rules, the
 * privacy scrub, the queue and its limits, deep-mode scheduling, the stall /
 * error / auth / exit events — every call through
 * supabase.functions.invoke('device-health').
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Body = Record<string, unknown> & { action: string };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; body: Record<string, unknown> & { action: string } }>,
  reply: null as null | ((b: Record<string, unknown> & { action: string }) => unknown),
  demo: false,
  creds: null as null | { host: string; username: string; password: string; output: 'm3u8' },
  watching: false,
  vitals: {} as Record<string, unknown>,
  stats: null as null | Record<string, unknown>,
  exits: [] as unknown[],
  seekAt: 0,
  stallObserver: null as null | ((r: unknown) => void),
  registered: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (name: string, { body }: { body: Body }) => {
        h.calls.push({ name, body });
        const r = h.reply?.(body);
        if (r !== undefined) return r;
        if (body.action === 'report') return { data: { ok: true, accepted: (body.events as unknown[]).length, deep_until: null, ids: (body.events as unknown[]).map((_, i) => `id-${i}`) }, error: null };
        return { data: { ok: true, deep_until: null }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/lib/xtream', () => ({ loadCreds: vi.fn(async () => h.creds) }));
vi.mock('@/hooks/useVersion', () => ({ loadVersion: async () => ({ version: '1.9.7', versionCode: 80 }) }));
vi.mock('@/lib/appInfo', () => ({ parseDeviceInfo: () => ({ model: 'AFTMM', android: '9' }) }));
vi.mock('@/lib/outsideSource', () => ({ isOutsideLine: (c: { outside?: boolean } | null) => !!c?.outside }));
vi.mock('@/lib/deviceInbox', () => ({
  getInboxKey: async () => 'K'.repeat(48),
  deviceLabel: () => 'Fire TV AFTMM',
  isWatchingNow: () => h.watching,
  registerLine: vi.fn(async (c: unknown, o: unknown) => { h.registered.push([c, o]); return true; }),
}));
vi.mock('@/lib/bufferDiagnostics', () => ({ setStallObserver: (fn: (r: unknown) => void) => { h.stallObserver = fn; } }));
vi.mock('@/lib/playerSeek', () => ({ lastSeekAt: () => h.seekAt }));
vi.mock('@/capacitor/DeviceHealth', () => ({
  DeviceHealth: {
    getDeviceVitals: vi.fn(async () => ({ model: 'Amazon AFTMM', sdk: 28, ...h.vitals })),
    takeLastExits: vi.fn(async () => { const e = h.exits; h.exits = []; return { exits: e }; }),
  },
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: { getStats: vi.fn(async () => h.stats ?? { state: 'idle' }) },
}));

import {
  ALL_PER_DAY, DEEP_BATCH_MS, DEEP_IDLE_SAMPLE_MS, DEEP_TICK_MS, FLUSH_DEBOUNCE_MS, LIGHT_PER_DAY, MIN_CALL_GAP_MS, QUEUE_MAX, STATUS_EVERY_MS,
  __resetDeviceHealthForTests, authReasonOf, cleanData, cleanEvent, compactStack, decideVerdict, deepUntil, exitEvents, flushNow,
  noteAuthError, notePlayerError, onStallOver, pendingHealthEvents, recordHealthEvent, scrubText, setNowPlaying, startDeviceHealth,
  type HealthEvent,
} from './deviceHealth';

const LINE = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw123', output: 'm3u8' as const };
const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const reports = () => h.calls.filter((c) => c.body.action === 'report');
const statuses = () => h.calls.filter((c) => c.body.action === 'status');
const sentEvents = () => reports().flatMap((c) => c.body.events as HealthEvent[]);
const ev = (over: Partial<HealthEvent> = {}): HealthEvent => ({
  kind: 'stall', verdict: 'unknown', summary: 'Stalled 5 s', occurredAt: new Date().toISOString(), context: 'live', title: 'News', data: { stallSec: 5 }, ...over,
});
const stall = (over: Record<string, unknown> = {}) => ({
  durationMs: 6000, ended: false, kind: 'live', verdict: 'unknown', dropped: false, online: true,
  streamKbps: null, nowKbps: null, probeKbps: null, hostMs: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
  localStorage.clear();
  h.calls = []; h.reply = null; h.demo = false; h.creds = { ...LINE }; h.watching = false; h.vitals = {}; h.stats = null; h.exits = [];
  h.seekAt = 0; h.stallObserver = null; h.registered = [];
  __resetDeviceHealthForTests();
});
afterEach(() => {
  __resetDeviceHealthForTests();
  vi.useRealTimers();
});

describe('verdict rules', () => {
  const v = (kind: HealthEvent['kind'], data: HealthEvent['data'], extra: { diagVerdict?: string; dropped?: boolean } = {}) => decideVerdict({ kind, data, ...extra });
  it('account for any auth error, app_crash for a crash', () => {
    expect(v('auth_error', { lowMemory: true })).toBe('account');
    expect(v('crash', { lowMemory: true })).toBe('app_crash');
  });
  it('killed: overload for low memory / ANR / a renderer shut for memory, else unknown', () => {
    expect(v('killed', { exitReason: 'low_memory' })).toBe('device_overload');
    expect(v('killed', { exitReason: 'anr' })).toBe('device_overload');
    expect(v('killed', { exitReason: 'renderer_killed' })).toBe('device_overload');
    expect(v('killed', { exitReason: 'box_restarted' })).toBe('unknown');
  });
  it('device_overload: low memory, < 12 % free, CPU >= 90, many dropped frames with the data arriving', () => {
    expect(v('stall', { lowMemory: true })).toBe('device_overload');
    expect(v('stall', { memAvailMb: 100, memTotalMb: 1000 })).toBe('device_overload');
    expect(v('stall', { memAvailMb: 130, memTotalMb: 1000 })).toBe('unknown');
    expect(v('stall', { cpuPct: 90 })).toBe('device_overload');
    expect(v('stall', { droppedFrames: 80, arrivalKbps: 9000, neededKbps: 6000 })).toBe('device_overload');
    expect(v('stall', { droppedFrames: 80, arrivalKbps: 3000, neededKbps: 6000, wired: true })).toBe('server');
  });
  it('internet: offline / dropped, or starved with weak Wi-Fi or a slow internet test, or the card said so', () => {
    expect(v('stall', { online: false })).toBe('internet');
    expect(v('stall', {}, { dropped: true })).toBe('internet');
    expect(v('stall', { arrivalKbps: 2000, neededKbps: 6000, wifiRssi: -80 })).toBe('internet');
    expect(v('stall', { arrivalKbps: 2000, neededKbps: 6000, internetMbps: 3 })).toBe('internet');
    expect(v('stall', {}, { diagVerdict: 'throttling' })).toBe('internet');
    expect(v('stall', { arrivalKbps: 2000, neededKbps: 6000, wifiRssi: -80, wired: true })).toBe('server');
  });
  it('server: 5xx / 404, starved on good Wi-Fi or internet, or the card said so; else unknown', () => {
    expect(v('player_error', { httpStatus: 503 })).toBe('server');
    expect(v('player_error', { httpStatus: 404 })).toBe('server');
    expect(v('stall', { arrivalKbps: 2000, neededKbps: 6000, wifiRssi: -55 })).toBe('server');
    expect(v('stall', { arrivalKbps: 2000, neededKbps: 6000, internetMbps: 50 })).toBe('server');
    expect(v('stall', {}, { diagVerdict: 'server' })).toBe('server');
    expect(v('stall', { arrivalKbps: 9000, neededKbps: 6000, wifiRssi: -50 })).toBe('unknown');
  });
});

describe('privacy', () => {
  it('scrubText takes out addresses, query strings, secrets, IPs and host:port', () => {
    const s = scrubText('Failed http://dstreams.xyz:8080/live/jsmith/pw123/55.ts?token=abc at 192.168.1.4 via cdn.example.com:8443 password=pw123 user: jsmith');
    expect(s).not.toMatch(/:\/\//);
    expect(s).not.toContain('pw123');
    expect(s).not.toContain('jsmith');
    expect(s).not.toContain('192.168');
    expect(s).not.toContain('8443');
    expect(s).not.toContain('token');
    expect(scrubText('dstreams.xyz/live/a/b/1.ts')).toBe('[link]');
    expect(scrubText('x'.repeat(300)).length).toBeLessThanOrEqual(200);
  });
  it('keeps a crash stack line (a source file is not a host)', () => {
    expect(scrubText('at a.b.SnowPlayerPlugin.load(SnowPlayerPlugin.kt:12)')).toContain('SnowPlayerPlugin.kt:12');
    expect(compactStack('java.lang.OutOfMemoryError\n at com.snowmedia.player.SnowPlayerPlugin.load(SnowPlayerPlugin.kt:12)')!.length).toBeLessThanOrEqual(120);
  });
  it('cleanData keeps known keys only, flat values, scrubbed strings', () => {
    const d = cleanData({ arrivalKbps: 1234.567, url: 'http://x', password: 'pw', errorCode: 'see https://a.b/c?username=u&password=p', nested: { a: 1 }, nan: NaN, wired: true });
    expect(d).toEqual({ arrivalKbps: 1234.6, errorCode: 'see [link]', wired: true });
  });
  it('nothing that looks like an address or a login ever leaves the box', async () => {
    startDeviceHealth();
    await settle();
    setNowPlaying({ context: 'live', title: 'News http://dstreams.xyz:8080/live/jsmith/pw123/1.ts' });
    recordHealthEvent(ev({ summary: 'Stalled at http://dstreams.xyz:8080/live/jsmith/pw123/1.ts?username=jsmith&password=pw123', title: 'News password=pw123 http://evil/?token=t', data: { errorCode: 'GET http://1.2.3.4/x?password=pw123', loadProfile: 'steady', stack: 'token=abc' } }));
    await notePlayerError({ code: 'ERR', message: 'http://dstreams.xyz/live/jsmith/pw123/1.ts', httpStatus: 503 });
    await settle(FLUSH_DEBOUNCE_MS);
    const out = JSON.stringify(sentEvents());
    expect(sentEvents().length).toBeGreaterThan(0);
    for (const bad of ['://', 'pw123', 'password', 'token=', '1.2.3.4', 'username=']) expect(out).not.toContain(bad);
    // The key only ever goes to device-health.
    expect(h.calls.every((c) => c.name === 'device-health')).toBe(true);
    expect(reports()[0].body).toMatchObject({ host: LINE.host, username: LINE.username, app_version: '1.9.7', version_code: 80 });
    expect(reports()[0].body).not.toHaveProperty('password');
  });
});

describe('queue + limits', () => {
  it('sends 10 s after the last event, in one call; nothing before', async () => {
    recordHealthEvent(ev());
    await settle(FLUSH_DEBOUNCE_MS - 100);
    expect(reports()).toHaveLength(0);
    await settle(200);
    expect(reports()).toHaveLength(1);
    expect(pendingHealthEvents()).toHaveLength(0);
  });
  it('keeps at most 50, dropping the oldest', () => {
    for (let i = 0; i < QUEUE_MAX + 5; i += 1) recordHealthEvent(ev({ kind: 'crash', summary: `c${i}` }), { deep: true });
    const q = pendingHealthEvents();
    expect(q).toHaveLength(QUEUE_MAX);
    expect(q[0].summary).toBe('c5');
  });
  it('a failed call keeps the queue, and no call comes sooner than 30 s after the last', async () => {
    h.reply = (b) => (b.action === 'report' ? { data: { ok: false, reason: 'error' }, error: null } : undefined);
    recordHealthEvent(ev());
    await settle(FLUSH_DEBOUNCE_MS);
    expect(reports()).toHaveLength(1);
    expect(pendingHealthEvents()).toHaveLength(1);
    h.reply = null;
    recordHealthEvent(ev({ kind: 'crash' }));
    await settle(FLUSH_DEBOUNCE_MS);
    expect(reports()).toHaveLength(1);
    await settle(MIN_CALL_GAP_MS);
    expect(reports()).toHaveLength(2);
    expect(pendingHealthEvents()).toHaveLength(0);
  });
  it('at most 20 events a call', async () => {
    for (let i = 0; i < 25; i += 1) recordHealthEvent(ev({ kind: 'crash' }), { deep: true });
    await settle(DEEP_BATCH_MS);
    expect((reports()[0].body.events as unknown[]).length).toBe(20);
  });
  it('40 light events a day, then the box stops queueing them', async () => {
    let kept = 0;
    for (let i = 0; i < LIGHT_PER_DAY + 10; i += 1) if (recordHealthEvent(ev({ kind: 'crash' }))) kept += 1;
    expect(kept).toBe(LIGHT_PER_DAY);
    expect(ALL_PER_DAY).toBe(300);
  });
  it('a stall merges into one still waiting for the same title', () => {
    recordHealthEvent(ev({ data: { stallSec: 5 } }));
    recordHealthEvent(ev({ data: { stallSec: 7 } }));
    const q = pendingHealthEvents();
    expect(q).toHaveLength(1);
    expect(q[0].data).toMatchObject({ stalls: 2, stallSec: 12 });
    expect(q[0].summary).toMatch(/Stalled 2 times \(12 s\)/);
  });
  it('unknown_key: kept, the line registered again, held 10 minutes', async () => {
    h.reply = (b) => (b.action === 'report' ? { data: { ok: false, reason: 'unknown_key' }, error: null } : undefined);
    recordHealthEvent(ev());
    await settle(FLUSH_DEBOUNCE_MS);
    expect(h.registered).toHaveLength(1);
    expect(pendingHealthEvents()).toHaveLength(1);
    await flushNow();
    expect(reports()).toHaveLength(1);
  });
  it('nothing with no line signed in, nothing in the demo, nothing for an outside line', async () => {
    h.creds = null;
    recordHealthEvent(ev());
    await settle(FLUSH_DEBOUNCE_MS);
    expect(reports()).toHaveLength(0);
    h.creds = { ...LINE, outside: true } as typeof LINE;
    await flushNow();
    expect(reports()).toHaveLength(0);
    h.demo = true;
    expect(recordHealthEvent(ev())).toBe(false);
  });
  it('a check is sent at once (ahead of the queue) and its id comes back by position', async () => {
    const { sendCheckNow } = await import('./deviceHealth');
    recordHealthEvent(ev());
    const r = await sendCheckNow(ev({ kind: 'check', samples: [[0, 1, 2, 3, 4, 5, 0]] }));
    expect(r).toEqual({ sent: true, id: 'id-0' });
    expect((reports()[0].body.events as HealthEvent[])[0].kind).toBe('check');
    h.reply = (b) => (b.action === 'report' ? { data: { ok: true, ids: [null] }, error: null } : undefined);
    expect(await sendCheckNow(ev({ kind: 'check' }))).toEqual({ sent: true, id: null });
  });
});

describe('what gets recorded', () => {
  it('a stall of 4 s or more (not after a seek) with the player and box numbers', async () => {
    h.stats = { state: 'ready', playing: true, bufferedAheadSec: 0.5, arrivalKbps: 1800, nowKbps: 1800, videoFormat: 'H264 1920x1080 6.0 Mb/s', droppedFrames: 2, cpuPct: 40, lastError: null, engine: 'exo', restarts: 0 };
    h.vitals = { memAvailMb: 600, memTotalMb: 1900, wifiRssi: -52 };
    startDeviceHealth();
    setNowPlaying({ context: 'live', title: '[USA] CNN' });
    h.stallObserver!(stall({ durationMs: 3000 }));
    await settle();
    expect(pendingHealthEvents()).toHaveLength(0);
    h.seekAt = Date.now() - 6000;
    h.stallObserver!(stall({ durationMs: 5000 }));
    await settle();
    expect(pendingHealthEvents()).toHaveLength(0);
    h.seekAt = 0;
    await onStallOver(stall({ durationMs: 12000, nowKbps: 1500 }) as never);
    const [e] = pendingHealthEvents();
    expect(e).toMatchObject({ kind: 'stall', verdict: 'server', context: 'live', title: '[USA] CNN' });
    expect(e.data).toMatchObject({ stallSec: 12, arrivalKbps: 1500, neededKbps: 6000, memAvailMb: 600, wifiRssi: -52 });
    expect(e.summary).toBe('Stalled 12 s on [USA] CNN: server sent 1.5 Mb/s of 6.0 Mb/s needed');
  });
  it('a player that gave up; a 401/403/509 on a line stream is the account', async () => {
    setNowPlaying({ context: 'vod', title: 'Film' });
    await notePlayerError({ code: 'RECONNECT_EXHAUSTED', httpStatus: 503 });
    setNowPlaying({ context: 'live', title: 'News' });
    await notePlayerError({ code: 'ERROR_CODE_IO_BAD_HTTP_STATUS', httpStatus: 509 });
    const q = pendingHealthEvents();
    expect(q.map((e) => [e.kind, e.verdict])).toEqual([['player_error', 'server'], ['auth_error', 'account']]);
    expect(q[1].data).toMatchObject({ reason: 'max_connections' });
  });
  it('auth errors: only for the line in use, once per 6 h per reason', async () => {
    expect(authReasonOf({ invalidLogin: true })).toBe('wrong_login');
    expect(authReasonOf({ authedButBlocked: true, userInfo: { status: 'Expired' } })).toBe('expired');
    await noteAuthError({ reason: 'expired', host: 'http://other.xyz', username: 'bob' });
    expect(pendingHealthEvents()).toHaveLength(0);
    await noteAuthError({ reason: 'expired', host: LINE.host, username: 'JSmith' });
    await noteAuthError({ reason: 'expired' });
    expect(pendingHealthEvents()).toHaveLength(1);
    expect(pendingHealthEvents()[0]).toMatchObject({ kind: 'auth_error', verdict: 'account', summary: 'Panel refused the line: the line has expired' });
  });
  it("last run's exits become crash / killed events at start, and are sent", async () => {
    h.exits = [
      { kind: 'killed', exitReason: 'low_memory', at: Date.now() - 60_000 },
      { kind: 'crash', exitReason: 'crash', stack: 'java.lang.IllegalStateException\n at com.snowmedia.X.y(X.kt:3)', at: Date.now() - 30_000 },
      { kind: 'crash', exitReason: 'renderer_killed', memAvailMb: 40, memTotalMb: 1900, playerActive: true },
    ];
    h.creds = null; // held until a line is signed in
    startDeviceHealth();
    await settle();
    const q = pendingHealthEvents();
    expect(q.map((e) => [e.kind, e.verdict])).toEqual([['killed', 'device_overload'], ['crash', 'app_crash'], ['crash', 'app_crash']]);
    expect(q[0].summary).toBe('SMC stopped while on screen: Android ran out of memory');
    expect(q[1].summary).toContain('IllegalStateException');
    expect(q[2].summary).toMatch(/WebView\) was shut by Android, 40 MB free memory during playback/);
    h.creds = { ...LINE };
    await flushNow();
    expect(reports()).toHaveLength(1);
    expect(sentEvents()).toHaveLength(3);
    expect(exitEvents([{ kind: 'nope' } as never], null)).toEqual([]);
  });
  it('cleanEvent keeps samples on a check only (30 rows x 8 numbers)', () => {
    const rows = Array.from({ length: 40 }, (_, i) => [i, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(cleanEvent(ev({ kind: 'check', samples: rows }))!.samples).toHaveLength(30);
    expect(cleanEvent(ev({ kind: 'check', samples: rows }))!.samples![0]).toHaveLength(8);
    expect(cleanEvent(ev({ kind: 'stall', samples: rows }))!.samples).toBeUndefined();
  });
});

describe('quiet when nothing is wrong; deep mode', () => {
  it('only the status ask: at start and every 10 minutes on screen', async () => {
    startDeviceHealth();
    await settle();
    expect(statuses()).toHaveLength(1);
    await settle(STATUS_EVERY_MS * 3);
    expect(statuses()).toHaveLength(4);
    expect(reports()).toHaveLength(0);
    expect(h.calls.every((c) => c.body.action === 'status')).toBe(true);
  });
  it('deep: app_start once, a sample every 10 s while watching and every 5 min idle, sent every 60 s', async () => {
    const until = new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    h.reply = (b) => (b.action === 'status' ? { data: { ok: true, deep_until: until }, error: null }
      : { data: { ok: true, deep_until: until, ids: (b.events as unknown[]).map(() => 'x') }, error: null });
    startDeviceHealth();
    await settle();
    expect(deepUntil()).toBe(Date.parse(until));
    // Idle: app_start + the first idle sample, nothing more for 5 minutes.
    expect(pendingHealthEvents().map((e) => e.kind)).toEqual(['app_start', 'sample']);
    expect(reports()).toHaveLength(0);
    await settle(DEEP_BATCH_MS);
    expect(reports()).toHaveLength(1);
    expect(sentEvents().map((e) => e.kind)).toEqual(['app_start', 'sample']);
    // Watching: one every 10 s.
    h.watching = true;
    h.stats = { state: 'ready', playing: true, bufferedAheadSec: 20, arrivalKbps: 8000, videoFormat: null, droppedFrames: 0, cpuPct: 30, engine: 'exo', restarts: 0 };
    await settle(DEEP_TICK_MS * 6);
    const samples = pendingHealthEvents().filter((e) => e.kind === 'sample').length + sentEvents().filter((e) => e.kind === 'sample').length - 1;
    expect(samples).toBe(6);
    h.watching = false;
    const before = pendingHealthEvents().length + sentEvents().length;
    await settle(DEEP_IDLE_SAMPLE_MS - DEEP_TICK_MS * 2);
    expect(pendingHealthEvents().length + sentEvents().length).toBe(before + 1);
  });
  it('deep ends: the note goes and sampling stops', async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    h.reply = (b) => (b.action === 'status' ? { data: { ok: true, deep_until: until }, error: null } : undefined);
    startDeviceHealth();
    await settle();
    expect(deepUntil()).not.toBeNull();
    await settle(120_000);
    expect(deepUntil()).toBeNull();
  });
});
