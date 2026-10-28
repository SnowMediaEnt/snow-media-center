// The customer-run 30-second check (DEVICE-HEALTH-SPEC addendum): "play for
// about 30 seconds and gather what the box is doing". From Fix a problem
// (FixProblemScreen) and from the report flows (ReportChannelDialog).
//
//   * What plays: the stream already up on the main player; else the channel
//     being reported, else the last channel watched (lib/xtream), loaded
//     muted on the native player under the page and stopped again after.
//   * Every second for 30 s: getStats + getDeviceVitals (one row each).
//   * Then one ~2 MB internet speed test (bufferDiagnostics.measureInternetKbps).
//   * A plain verdict (lib/deviceHealth decideVerdict) with 2-3 numbers in
//     plain words for the customer, and ONE 'check' event with the summary
//     numbers and up to 30 rows of samples, sent at once; the server's id
//     comes back for the ticket text ("Device check: <id>").
// Never in the demo; never an outside service's channel; 6 a day per box.
import { isDemo } from '@/lib/demoMode';
import { buildNativeLiveUrl, loadCreds, loadLastChannelId, type XtreamCreds } from '@/lib/xtream';
import { isOutsideLine } from '@/lib/outsideSource';
import { measureInternetKbps, formatMbps } from '@/lib/bufferDiagnostics';
import {
  checkAllowedToday, decideVerdict, getNowPlaying, neededKbpsOf, overloadReason, readStats, readVitals, sendCheckNow,
  type HealthContext, type HealthEvent, type HealthValue, type HealthVerdict,
} from '@/lib/deviceHealth';
import { SnowPlayer, hasNativePlayer, type PlayerStats } from '@/capacitor/SnowPlayer';
import type { DeviceVitals } from '@/capacitor/DeviceHealth';

export const CHECK_SECONDS = 30;
const INTERNET_TEST_BYTES = 2_000_000;

export interface CheckProgress { second: number; total: number; stalled: boolean }

/** What the customer is told: an i18n key under deviceHealth.check.verdict.* and its values. */
export interface PlainVerdict { key: string; params: Record<string, string> }

export interface CheckResult {
  verdict: HealthVerdict;
  /** Nothing went wrong in the 30 s (no stall, the data kept up, box fine). */
  fine: boolean;
  plain: PlainVerdict;
  sent: boolean;
  /** The server's id for the check, for the ticket text. */
  id: string | null;
  event: HealthEvent;
}

export interface CheckOpts {
  durationSec?: number;
  /** A channel to play when nothing is playing (the one being reported). */
  channel?: { line?: XtreamCreds | null; streamId: number | string | null | undefined; name?: string | null } | null;
  context?: HealthContext;
  title?: string | null;
  onProgress?: (p: CheckProgress) => void;
  signal?: AbortSignal;
  /** Tests: the wait between samples. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** One sample row: [t, bufferedAheadSec, arrivalKbps, droppedFrames, cpuPct, memAvailMb, stalled(0/1)]. */
export type SampleRow = [number, number, number, number, number, number, number];

interface Sampled { stats: PlayerStats | null; vitals: DeviceVitals | null; stalled: boolean }

/** The check's summary numbers from its samples (pure, for tests). */
export function summarize(rows: Sampled[], internetKbps: number | null): Record<string, HealthValue> {
  const buf: number[] = [];
  const arr: number[] = [];
  let cpuPeak: number | null = null;
  let memMin: number | null = null;
  let needed: number | null = null;
  let stalls = 0;
  let stallSec = 0;
  let wasStalled = false;
  let played = false;
  let firstDropped: number | null = null;
  let lastDropped: number | null = null;
  let last: Sampled | null = null;
  for (const r of rows) {
    const s = r.stats && r.stats.state !== 'idle' ? r.stats : null;
    if (s) {
      if (s.playing) played = true;
      buf.push(s.bufferedAheadSec);
      const a = s.arrivalKbps ?? s.nowKbps;
      if (a != null) arr.push(a);
      if (s.cpuPct != null) cpuPeak = Math.max(cpuPeak ?? 0, s.cpuPct);
      needed = neededKbpsOf(s.videoFormat) ?? needed;
      if (s.droppedFrames != null) { if (firstDropped == null) firstDropped = s.droppedFrames; lastDropped = s.droppedFrames; }
    }
    if (r.vitals?.memAvailMb != null) memMin = Math.min(memMin ?? Infinity, r.vitals.memAvailMb);
    if (r.stalled) { stallSec += 1; if (!wasStalled) stalls += 1; }
    wasStalled = r.stalled;
    last = r;
  }
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const v = last?.vitals ?? null;
  return {
    seconds: rows.length,
    played,
    avgBufferedAheadSec: avg(buf),
    minBufferedAheadSec: buf.length ? Math.min(...buf) : null,
    avgArrivalKbps: avg(arr),
    minArrivalKbps: arr.length ? Math.min(...arr) : null,
    arrivalKbps: avg(arr),
    neededKbps: needed,
    stalls,
    stallSec,
    droppedFrames: firstDropped != null && lastDropped != null ? Math.max(0, lastDropped - firstDropped) : null,
    cpuPctPeak: cpuPeak,
    memAvailMbMin: memMin === Infinity ? null : memMin,
    memAvailMb: memMin === Infinity ? null : memMin,
    memTotalMb: v?.memTotalMb ?? null,
    lowMemory: rows.some((r) => r.vitals?.lowMemory === true) || null,
    storageFreeMb: v?.storageFreeMb ?? null,
    wifiRssi: v?.wifiRssi ?? null,
    wifiLinkMbps: v?.wifiLinkMbps ?? null,
    wifiFreqMhz: v?.wifiFreqMhz ?? null,
    wired: v?.wired ?? null,
    online: v?.online ?? null,
    internetMbps: internetKbps != null ? round1(internetKbps / 1000) : null,
    engine: last?.stats?.engine ?? null,
    httpStatus: last?.stats?.httpStatus ?? null,
    errorCode: last?.stats?.lastError ?? null,
    firstFrameMs: last?.stats?.firstFrameMs ?? null,
  };
}

/** The customer's words for the result (i18n key + values). */
export function plainVerdict(verdict: HealthVerdict, d: Record<string, HealthValue>, fine: boolean): PlainVerdict {
  const mb = (k: unknown) => formatMbps(num(k));
  const internet = num(d.internetMbps) != null ? formatMbps((num(d.internetMbps) as number) * 1000) : '—';
  const arrival = mb(d.avgArrivalKbps);
  const needed = mb(d.neededKbps);
  if (d.played === false && num(d.avgArrivalKbps) == null) return { key: 'deviceHealth.check.verdict.notPlaying', params: { internet } };
  switch (verdict) {
    case 'device_overload': {
      const mem = num(d.memAvailMbMin);
      const cpu = num(d.cpuPctPeak);
      if (cpu != null && cpu >= 90 && !(d.lowMemory === true)) return { key: 'deviceHealth.check.verdict.overloadCpu', params: { cpu: String(Math.round(cpu)) } };
      return { key: 'deviceHealth.check.verdict.overloadMemory', params: { mem: mem != null ? String(Math.round(mem)) : '—' } };
    }
    case 'internet': {
      const rssi = num(d.wifiRssi);
      if (d.online === false) return { key: 'deviceHealth.check.verdict.offline', params: {} };
      if (rssi != null && rssi <= -75 && d.wired !== true) return { key: 'deviceHealth.check.verdict.weakWifi', params: { internet } };
      return { key: 'deviceHealth.check.verdict.internet', params: { internet, needed } };
    }
    case 'server': return { key: 'deviceHealth.check.verdict.server', params: { internet, arrival, needed } };
    case 'account': return { key: 'deviceHealth.check.verdict.account', params: {} };
    default:
      return fine
        ? { key: 'deviceHealth.check.verdict.fine', params: { internet, arrival } }
        : { key: 'deviceHealth.check.verdict.unclear', params: { internet, arrival } };
  }
}

/** The verdict and "fine" from the summary (pure, for tests). */
export function judge(d: Record<string, HealthValue>): { verdict: HealthVerdict; fine: boolean } {
  const verdict = decideVerdict({ kind: 'check', data: d });
  const arrival = num(d.avgArrivalKbps);
  const needed = num(d.neededKbps);
  const starved = arrival != null && needed != null && arrival < needed;
  const fine = verdict === 'unknown' && (num(d.stalls) ?? 0) === 0 && !starved && !overloadReason(d) && d.played !== false;
  return { verdict, fine };
}

/** Start the stream to check when nothing plays. Returns its stop, or null (something already plays, or nothing to play). */
async function ensurePlayback(opts: CheckOpts): Promise<{ stop: (() => Promise<void>) | null; title: string | null; context: HealthContext }> {
  const np = getNowPlaying();
  const now = await readStats();
  if (now && now.state !== 'idle') return { stop: null, title: opts.title ?? np?.title ?? null, context: opts.context ?? np?.context ?? 'live' };
  if (!hasNativePlayer()) return { stop: null, title: opts.title ?? null, context: opts.context ?? 'live' };
  const creds = (opts.channel?.line ?? (await loadCreds().catch(() => null))) as XtreamCreds | null;
  const reported = Number(opts.channel?.streamId);
  const id = Number.isFinite(reported) && reported > 0 ? reported : loadLastChannelId();
  if (!creds?.host || !creds.username || isOutsideLine(creds) || !id) return { stop: null, title: opts.title ?? null, context: opts.context ?? 'live' };
  try {
    await SnowPlayer.load({ url: buildNativeLiveUrl(creds, id), live: true });
    await SnowPlayer.setVolume({ volume: 0 }).catch(() => undefined);
  } catch {
    return { stop: null, title: null, context: 'live' };
  }
  const title = Number.isFinite(reported) && reported > 0 ? (opts.channel?.name ?? opts.title ?? null) : null;
  return { stop: async () => { try { await SnowPlayer.stop(); } catch { /* ignore */ } }, title, context: 'live' };
}

/**
 * Run the check: 30 one-second samples, the speed test, the verdict, and the
 * one event sent. null when it can't run (demo, 6 already today) or was
 * cancelled. Never throws.
 */
export async function runDeviceCheck(opts: CheckOpts = {}): Promise<CheckResult | null> {
  if (isDemo() || !checkAllowedToday()) return null;
  const total = Math.max(1, Math.min(CHECK_SECONDS, opts.durationSec ?? CHECK_SECONDS));
  const sleep = opts.sleep ?? defaultSleep;
  const play = await ensurePlayback(opts).catch(() => ({ stop: null, title: null, context: 'live' as HealthContext }));
  const rows: Sampled[] = [];
  const samples: SampleRow[] = [];
  let played = false;
  try {
    for (let i = 0; i < total; i += 1) {
      if (opts.signal?.aborted) return null;
      const t0 = Date.now();
      const [stats, vitals] = await Promise.all([readStats(i % 10 === 9), readVitals()]);
      if (stats?.playing) played = true;
      const stalled = !!stats && played && stats.state === 'buffering';
      rows.push({ stats, vitals, stalled });
      samples.push([
        i,
        round1(stats?.bufferedAheadSec ?? 0),
        Math.round(stats?.arrivalKbps ?? stats?.nowKbps ?? 0),
        stats?.droppedFrames ?? 0,
        Math.round(stats?.cpuPct ?? 0),
        Math.round(vitals?.memAvailMb ?? 0),
        stalled ? 1 : 0,
      ]);
      opts.onProgress?.({ second: i + 1, total, stalled });
      if (i < total - 1) await sleep(Math.max(0, 1000 - (Date.now() - t0)));
    }
  } finally {
    if (play.stop) await play.stop();
  }
  if (opts.signal?.aborted) return null;
  // After the stream: the test does not compete with it for the line.
  const internetKbps = await measureInternetKbps(INTERNET_TEST_BYTES).catch(() => null);
  const data = summarize(rows, internetKbps);
  data.source = play.stop ? 'started_for_check' : 'already_playing';
  const { verdict, fine } = judge(data);
  data.fine = fine;
  const plain = plainVerdict(verdict, data, fine);
  const what = play.title || (play.context === 'live' ? 'a channel' : 'a title');
  const event: HealthEvent = {
    kind: 'check',
    verdict,
    summary: `Customer check on ${what}: ${fine ? 'no problem found' : verdict.replace('_', ' ')}; ${data.stalls ?? 0} stalls, `
      + `${formatMbps(num(data.avgArrivalKbps))} arriving${num(data.neededKbps) != null ? ` of ${formatMbps(num(data.neededKbps))}` : ''}, internet ${num(data.internetMbps) ?? '?'} Mb/s`,
    occurredAt: new Date().toISOString(),
    context: play.context,
    title: play.title ?? undefined,
    data,
    samples,
  };
  const sent = await sendCheckNow(event).catch(() => ({ sent: false, id: null }));
  return { verdict, fine, plain, sent: sent.sent, id: sent.id, event };
}
