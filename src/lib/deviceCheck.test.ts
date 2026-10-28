/**
 * The customer's 30-second check (lib/deviceCheck): one sample a second, the
 * speed test after, the plain verdict, one 'check' event with its rows, and
 * playing the last / reported channel only when nothing plays.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  stats: [] as Array<Record<string, unknown> | null>,
  idleFirst: false,
  vitals: { memAvailMb: 800, memTotalMb: 1900, wifiRssi: -50 } as Record<string, unknown>,
  sent: [] as unknown[],
  allowed: true,
  internetKbps: 48_000 as number | null,
  loads: [] as unknown[],
  stops: 0,
  demo: false,
  onSpeedTest: null as null | (() => void),
  sendHangs: false,
  speedSignal: null as AbortSignal | null | undefined,
  creds: { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw123', output: 'm3u8' } as Record<string, unknown> | null,
}));

vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/lib/outsideSource', () => ({ isOutsideLine: (c: { outside?: boolean } | null) => !!c?.outside }));
vi.mock('@/lib/xtream', () => ({
  loadCreds: async () => h.creds,
  loadLastChannelId: () => 77,
  buildNativeLiveUrl: (c: { host: string }, id: number) => `${c.host}/live/x/y/${id}.ts`,
}));
vi.mock('@/lib/bufferDiagnostics', () => ({
  measureInternetKbps: async (_b: number, _t: number, signal?: AbortSignal) => { h.speedSignal = signal; h.onSpeedTest?.(); return h.internetKbps; },
  formatMbps: (k: number | null) => (k == null ? '—' : `${(k / 1000).toFixed(1)} Mb/s`),
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: {
    load: vi.fn(async (o: unknown) => { h.loads.push(o); }),
    stop: vi.fn(async () => { h.stops += 1; }),
    setVolume: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/deviceHealth', async () => {
  const actual = await vi.importActual<typeof import('./deviceHealth')>('./deviceHealth');
  let i = 0;
  return {
    ...actual,
    checkAllowedToday: () => h.allowed,
    getNowPlaying: () => ({ context: 'live', title: 'Sky Sports' }),
    readVitals: async () => h.vitals,
    readStats: async () => {
      if (h.idleFirst) { h.idleFirst = false; return { state: 'idle' }; }
      const s = h.stats[Math.min(i, h.stats.length - 1)];
      i += 1;
      return s;
    },
    sendCheckNow: async (e: unknown) => {
      h.sent.push(e);
      if (h.sendHangs) return new Promise(() => undefined);
      return { sent: true, id: '6f1c2d3e-0000-4000-8000-000000000001' };
    },
    __resetStatsIndex: () => { i = 0; },
  };
});

import * as health from './deviceHealth';
import { judge, plainVerdict, runDeviceCheck, summarize } from './deviceCheck';

const playing = (over: Record<string, unknown> = {}) => ({
  state: 'ready', playing: true, bufferedAheadSec: 20, arrivalKbps: 9000, nowKbps: 9000, videoFormat: 'H264 1920x1080 6.0 Mb/s',
  droppedFrames: 0, cpuPct: 35, lastError: null, httpStatus: null, engine: 'exo', firstFrameMs: 900, ...over,
});
const noSleep = async () => undefined;

beforeEach(() => {
  h.onSpeedTest = null; h.sendHangs = false; h.speedSignal = null;
  h.stats = [playing()]; h.idleFirst = false; h.sent = []; h.allowed = true; h.internetKbps = 48_000; h.loads = []; h.stops = 0; h.demo = false;
  h.vitals = { memAvailMb: 800, memTotalMb: 1900, wifiRssi: -50 };
  (health as unknown as { __resetStatsIndex: () => void }).__resetStatsIndex();
});

describe('the 30-second check', () => {
  it('30 samples, one a second, then one event with the summary and the rows; the id comes back', async () => {
    const progress: number[] = [];
    let slept = 0;
    const r = await runDeviceCheck({ sleep: async (ms) => { slept += ms; }, onProgress: (p) => progress.push(p.second) });
    expect(progress).toHaveLength(30);
    expect(progress[29]).toBe(30);
    expect(slept).toBeGreaterThan(25_000);
    expect(r!.id).toBe('6f1c2d3e-0000-4000-8000-000000000001');
    expect(h.sent).toHaveLength(1);
    const e = h.sent[0] as health.HealthEvent;
    expect(e.kind).toBe('check');
    expect(e.samples).toHaveLength(30);
    expect(e.samples![0]).toEqual([0, 20, 9000, 0, 35, 800, 0]);
    expect(e.data).toMatchObject({ avgBufferedAheadSec: 20, minBufferedAheadSec: 20, avgArrivalKbps: 9000, minArrivalKbps: 9000, neededKbps: 6000, stalls: 0, stallSec: 0, cpuPctPeak: 35, memAvailMbMin: 800, wifiRssi: -50, internetMbps: 48, source: 'already_playing' });
    expect(r!.fine).toBe(true);
    expect(r!.plain.key).toBe('deviceHealth.check.verdict.fine');
    // Something already played: nothing loaded, nothing stopped.
    expect(h.loads).toHaveLength(0);
    expect(h.stops).toBe(0);
  });

  it('the server sending too little on a good line is the server, in plain words with the numbers', async () => {
    // (the first read is the 'is anything playing?' ask)
    h.stats = [playing(), playing({ arrivalKbps: 3000, nowKbps: 3000 }), playing({ state: 'buffering', playing: false, arrivalKbps: 2000, bufferedAheadSec: 0 }), playing({ arrivalKbps: 3000 })];
    const r = await runDeviceCheck({ sleep: noSleep, durationSec: 3 });
    expect(r!.verdict).toBe('server');
    expect(r!.plain).toEqual({ key: 'deviceHealth.check.verdict.server', params: { internet: '48.0 Mb/s', arrival: '2.7 Mb/s', needed: '6.0 Mb/s' } });
    expect((h.sent[0] as health.HealthEvent).data).toMatchObject({ stalls: 1, stallSec: 1 });
  });

  it('nothing playing: the last channel is played muted for the check and stopped after', async () => {
    h.idleFirst = true;
    const r = await runDeviceCheck({ sleep: noSleep, durationSec: 2 });
    expect(h.loads).toEqual([{ url: 'http://dstreams.xyz:8080/live/x/y/77.ts', live: true }]);
    expect(h.stops).toBe(1);
    expect((h.sent[0] as health.HealthEvent).data.source).toBe('last_channel');
    // Not named after anything it didn't play.
    expect((h.sent[0] as health.HealthEvent).title).toBeUndefined();
    expect((h.sent[0] as health.HealthEvent).summary).toContain('the last channel watched');
    // The address never goes into the event.
    expect(JSON.stringify(h.sent)).not.toContain('://');
    expect(r).not.toBeNull();
  });

  it('the reported channel is the one played when nothing plays', async () => {
    h.idleFirst = true;
    await runDeviceCheck({ sleep: noSleep, durationSec: 1, channel: { streamId: 12, name: 'News HD' } });
    expect(h.loads).toEqual([{ url: 'http://dstreams.xyz:8080/live/x/y/12.ts', live: true }]);
    expect((h.sent[0] as health.HealthEvent).title).toBe('News HD');
  });

  it('cancelled: nothing sent, the started stream stopped', async () => {
    h.idleFirst = true;
    const ac = new AbortController();
    const r = await runDeviceCheck({ sleep: async () => { ac.abort(); }, durationSec: 5, signal: ac.signal });
    expect(r).toBeNull();
    expect(h.sent).toHaveLength(0);
    expect(h.stops).toBe(1);
  });

  it('6 a day, and never in the demo', async () => {
    h.allowed = false;
    expect(await runDeviceCheck({ sleep: noSleep })).toBeNull();
    h.allowed = true; h.demo = true;
    expect(await runDeviceCheck({ sleep: noSleep })).toBeNull();
    expect(h.sent).toHaveLength(0);
  });
});

describe('summary and plain verdict', () => {
  it('a box short of memory is overloaded, said with the number', () => {
    const d = summarize([{ stats: playing() as never, vitals: { memAvailMb: 90, memTotalMb: 1900 }, stalled: false }], 50_000);
    const { verdict, fine } = judge(d);
    expect(verdict).toBe('device_overload');
    expect(fine).toBe(false);
    expect(plainVerdict(verdict, d, fine)).toEqual({ key: 'deviceHealth.check.verdict.overloadMemory', params: { mem: '90' } });
  });
  it('weak Wi-Fi with the stream starved is the internet', () => {
    const d = summarize([{ stats: playing({ arrivalKbps: 2000 }) as never, vitals: { wifiRssi: -82 }, stalled: true }], 4000);
    const { verdict } = judge(d);
    expect(verdict).toBe('internet');
    expect(plainVerdict(verdict, d, false).key).toBe('deviceHealth.check.verdict.weakWifi');
  });
  it('nothing played at all says so', () => {
    const d = summarize([{ stats: null, vitals: {}, stalled: false }], 20_000);
    expect(plainVerdict(judge(d).verdict, d, false).key).toBe('deviceHealth.check.verdict.notPlaying');
  });
});

describe('what the check measured, and stopping it', () => {
  it('something already plays: named as the player names it (never the report\'s title)', async () => {
    await runDeviceCheck({ sleep: noSleep, durationSec: 1, channel: { streamId: 12, name: 'News HD' } });
    expect(h.loads).toHaveLength(0);
    const e = h.sent[0] as health.HealthEvent;
    expect(e.title).toBe('Sky Sports');
    expect(e.data.source).toBe('already_playing');
  });
  it('a film / series / Plex report with nothing playing: no check at all', async () => {
    h.idleFirst = true;
    expect(await runDeviceCheck({ sleep: noSleep, durationSec: 2, liveFallback: false })).toBeNull();
    expect(h.loads).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
  it('the speed test gets the stop, and a stop during it sends nothing', async () => {
    const ac = new AbortController();
    h.onSpeedTest = () => ac.abort();
    expect(await runDeviceCheck({ sleep: noSleep, durationSec: 2, signal: ac.signal })).toBeNull();
    expect(h.speedSignal).toBe(ac.signal);
    expect(h.sent).toHaveLength(0);
  });
  it('a send that hangs gives up after 8 s: the result has no id and the report can go on', async () => {
    vi.useFakeTimers();
    try {
      h.sendHangs = true;
      const p = runDeviceCheck({ sleep: noSleep, durationSec: 1 });
      await vi.advanceTimersByTimeAsync(8_100);
      const r = await p;
      expect(r).toMatchObject({ sent: false, id: null });
    } finally {
      vi.useRealTimers();
    }
  });
  it('the buffer running down over the check is counted as evidence', () => {
    const rows = [30, 28, 25, 20, 15, 10].map((b) => ({ stats: playing({ bufferedAheadSec: b, arrivalKbps: 3000 }) as never, vitals: { wifiRssi: -50 }, stalled: false }));
    const d = summarize(rows, 50_000);
    expect(d.bufferFalling).toBe(true);
    expect(judge(d)).toEqual({ verdict: 'server', fine: false });
  });
});

