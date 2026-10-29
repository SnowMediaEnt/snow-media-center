// The customer-run 30-second check (DEVICE-HEALTH-SPEC addendum): "play for
// about 30 seconds and gather what the box is doing". From Fix a problem
// (FixProblemScreen) and from the report flows (ReportChannelDialog).
//
//   * What plays: the stream already up on the main player (named as the
//     player names it, never as the report does); else the channel being
//     reported, else the last channel watched (lib/xtream), loaded muted on
//     the native player under the page and stopped again after. A film,
//     series or Plex report with nothing playing has nothing to measure: no
//     check (`liveFallback: false`). Cancelled = nothing sent; the send waits
//     8 s at most (then the report goes on without the id).
//   * Every second for 30 s: getStats + getDeviceVitals (one row each).
//   * Then one ~2 MB internet speed test (bufferDiagnostics.measureInternetKbps).
//   * A plain verdict (lib/deviceHealth decideVerdict) with 2-3 numbers in
//     plain words for the customer, and ONE 'check' event with the summary
//     numbers and up to 30 rows of samples, sent at once; the server's id
//     comes back for the ticket text ("Device check: <id>").
// Never in the demo; never an outside service's channel; 6 a day per box.
//
// The player's own Help ("Check this stream (1 minute)", PlayerCheckStrip):
// the stream on screen only (`liveFallback: false`, named by the player via
// `playing`), never stopped, reloaded or muted, 60 s with a sample every 2 s
// (`intervalSec: 2`): still at most 30 rows, the server's cap for a check.
import { isDemo } from '@/lib/demoMode';
import { buildNativeLiveUrl, loadCreds, loadLastChannelId, type XtreamCreds } from '@/lib/xtream';
import { isOutsideLine } from '@/lib/outsideSource';
import { currentViewer, loadWatchHistory } from '@/lib/watchHistory';
import { recentChannelsFrom } from '@/lib/recentChannels';
import { measureInternetKbps, formatMbps } from '@/lib/bufferDiagnostics';
import {
  STARVED_SHARE, checkAllowedToday, cpuShare, decideVerdict, getNowPlaying, neededKbpsOf, overloadReason, readStats, readVitals, sendCheckNow,
  type HealthContext, type HealthEvent, type HealthValue, type HealthVerdict,
} from '@/lib/deviceHealth';
import { SnowPlayer, hasNativePlayer, type PlayerStats } from '@/capacitor/SnowPlayer';
import type { DeviceVitals } from '@/capacitor/DeviceHealth';

export const CHECK_SECONDS = 30;
/** The longest check (the player's 1-minute one, sampled every 2 s). */
export const MAX_CHECK_SECONDS = 60;
/** The server keeps at most this many sample rows on a check. */
export const MAX_SAMPLE_ROWS = 30;
const INTERNET_TEST_BYTES = 2_000_000;
/** The send waits this long at most; then the report goes on without the id (the check stays queued). */
export const SEND_TIMEOUT_MS = 8_000;

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
  /** How long it samples, seconds (30 by default, 60 at most). */
  durationSec?: number;
  /** Seconds between samples (1 by default). Raised as needed so the rows
   *  never pass MAX_SAMPLE_ROWS (60 s every 2 s = 30 rows). */
  intervalSec?: number;
  /** Who plays what is on screen names it here (the player's Help): it is
   *  used for a stream that is already playing, over getNowPlaying(). */
  playing?: { context: HealthContext; title?: string | null } | null;
  /** A channel to play when nothing is playing (the one being reported). */
  channel?: { line?: XtreamCreds | null; streamId: number | string | null | undefined; name?: string | null } | null;
  /** When nothing plays: false = no check at all (a film / series / Plex
   *  report: a live channel would be the wrong thing to measure). Default true. */
  liveFallback?: boolean;
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
export function summarize(rows: Sampled[], internetKbps: number | null, intervalSec = 1): Record<string, HealthValue> {
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
    if (r.stalled) { stallSec += intervalSec; if (!wasStalled) stalls += 1; }
    wasStalled = r.stalled;
    last = r;
  }
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const v = last?.vitals ?? null;
  // The buffer ran down over the check: its last third under its first by more than a second.
  const third = Math.floor(buf.length / 3);
  const bufferFalling = third >= 1 ? (avg(buf.slice(-third)) as number) < (avg(buf.slice(0, third)) as number) - 1 : null;
  return {
    seconds: rows.length * intervalSec,
    played,
    avgBufferedAheadSec: avg(buf),
    minBufferedAheadSec: buf.length ? Math.min(...buf) : null,
    avgArrivalKbps: avg(arr),
    minArrivalKbps: arr.length ? Math.min(...arr) : null,
    arrivalKbps: avg(arr),
    neededKbps: needed,
    stalls,
    stallSec,
    bufferFalling,
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
    cpuCores: v?.cpuCores ?? null,
    // A stream was up (loaded) the whole time but never played or got data.
    neverStarted: buf.length > 0 && !played && Math.max(0, ...buf) < 1 && (arr.length === 0 || Math.max(...arr) < 100),
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
  if (d.neverStarted === true) return { key: 'deviceHealth.check.verdict.neverStarted', params: { internet, seconds: String(num(d.seconds) ?? CHECK_SECONDS) } };
  if (d.played === false && num(d.avgArrivalKbps) == null) return { key: 'deviceHealth.check.verdict.notPlaying', params: { internet } };
  switch (verdict) {
    case 'device_overload': {
      const mem = num(d.memAvailMbMin);
      const cpu = cpuShare(d);
      if (cpu && cpu.share >= 90 && !(d.lowMemory === true)) return { key: 'deviceHealth.check.verdict.overloadCpu', params: { cpu: String(Math.round(cpu.share)) } };
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
  const starved = arrival != null && needed != null && arrival < STARVED_SHARE * needed && ((num(d.stalls) ?? 0) > 0 || d.bufferFalling === true);
  const fine = verdict === 'unknown' && (num(d.stalls) ?? 0) === 0 && !starved && !overloadReason(d) && d.played !== false;
  return { verdict, fine };
}

interface Playback {
  stop: (() => Promise<void>) | null;
  /** What was measured, as named by whoever plays it; null when unnamed (the last channel). */
  title: string | null;
  context: HealthContext;
  source: 'already_playing' | 'reported_channel' | 'last_channel' | 'nothing';
}

/** The newest channel in this viewer's watch history on this line (the
 *  Continue row's first channel); adult channels are never picked. */
async function lastWatchedChannelId(creds: XtreamCreds | null): Promise<number | null> {
  if (!creds?.host || !creds.username) return null;
  try {
    const [first] = recentChannelsFrom(loadWatchHistory(await currentViewer()), [creds], {}, 1);
    return first ? Number(first.stream.stream_id) || null : null;
  } catch { return null; }
}

/** The stream to check: what plays, else one started for it. `null`: nothing to measure. */
async function ensurePlayback(opts: CheckOpts): Promise<Playback | null> {
  const np = getNowPlaying();
  const now = await readStats();
  if (now && now.state !== 'idle') {
    const named = opts.playing ?? np;
    return { stop: null, title: named?.title ?? null, context: named?.context ?? 'live', source: 'already_playing' };
  }
  if (opts.liveFallback === false) return null;
  if (!hasNativePlayer()) return { stop: null, title: null, context: 'app', source: 'nothing' };
  const creds = (opts.channel?.line ?? (await loadCreds().catch(() => null))) as XtreamCreds | null;
  const reported = Number(opts.channel?.streamId);
  const isReported = Number.isFinite(reported) && reported > 0;
  const id = isReported ? reported : (loadLastChannelId() ?? (await lastWatchedChannelId(creds)));
  if (!creds?.host || !creds.username || isOutsideLine(creds) || !id) return { stop: null, title: null, context: 'app', source: 'nothing' };
  try {
    await SnowPlayer.load({ url: buildNativeLiveUrl(creds, id), live: true });
    await SnowPlayer.setVolume({ volume: 0 }).catch(() => undefined);
  } catch {
    return { stop: null, title: null, context: 'app', source: 'nothing' };
  }
  return {
    stop: async () => { try { await SnowPlayer.stop(); } catch { /* ignore */ } },
    title: isReported ? (opts.channel?.name ?? null) : null,
    context: 'live',
    source: isReported ? 'reported_channel' : 'last_channel',
  };
}

/** `p`, or `fallback` after `ms` (whichever is first). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(fallback); });
  });
}

/**
 * Run the check: 30 one-second samples (or one every `intervalSec`), the speed test, the verdict, and the
 * one event sent. null when it can't run (demo, 6 already today) or was
 * cancelled. Never throws.
 */
export async function runDeviceCheck(opts: CheckOpts = {}): Promise<CheckResult | null> {
  if (isDemo() || !checkAllowedToday()) return null;
  const duration = Math.max(1, Math.min(MAX_CHECK_SECONDS, Math.round(opts.durationSec ?? CHECK_SECONDS)));
  const interval = Math.max(1, Math.round(opts.intervalSec ?? 1), Math.ceil(duration / MAX_SAMPLE_ROWS));
  const total = Math.max(1, Math.ceil(duration / interval));
  // A heavier stats read about every 10 s (as the 30-second check does).
  const heavyEvery = Math.max(1, Math.round(10 / interval));
  const sleep = opts.sleep ?? defaultSleep;
  const play = await ensurePlayback(opts).catch((): Playback => ({ stop: null, title: null, context: 'app', source: 'nothing' }));
  if (!play) return null;
  const rows: Sampled[] = [];
  const samples: SampleRow[] = [];
  let played = false;
  try {
    for (let i = 0; i < total; i += 1) {
      if (opts.signal?.aborted) return null;
      const t0 = Date.now();
      const [stats, vitals] = await Promise.all([readStats(i % heavyEvery === heavyEvery - 1), readVitals()]);
      if (stats?.playing) played = true;
      const stalled = !!stats && played && stats.state === 'buffering';
      rows.push({ stats, vitals, stalled });
      samples.push([
        i * interval,
        round1(stats?.bufferedAheadSec ?? 0),
        Math.round(stats?.arrivalKbps ?? stats?.nowKbps ?? 0),
        stats?.droppedFrames ?? 0,
        Math.round(stats?.cpuPct ?? 0),
        Math.round(vitals?.memAvailMb ?? 0),
        stalled ? 1 : 0,
      ]);
      opts.onProgress?.({ second: Math.min(duration, (i + 1) * interval), total: duration, stalled });
      if (i < total - 1) await sleep(Math.max(0, interval * 1000 - (Date.now() - t0)));
    }
  } finally {
    if (play.stop) await play.stop();
  }
  if (opts.signal?.aborted) return null;
  // After the stream: the test does not compete with it for the line.
  const internetKbps = await measureInternetKbps(INTERNET_TEST_BYTES, 10_000, opts.signal).catch(() => null);
  if (opts.signal?.aborted) return null;
  const data = summarize(rows, internetKbps, interval);
  data.source = play.source;
  if (interval > 1) data.intervalSec = interval;
  const { verdict, fine } = judge(data);
  data.fine = fine;
  const plain = plainVerdict(verdict, data, fine);
  const what = play.title || (play.source === 'last_channel' ? 'the last channel watched' : play.context === 'live' ? 'a channel' : 'a title');
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
  if (opts.signal?.aborted) return null;
  const sent = await withTimeout(sendCheckNow(event), SEND_TIMEOUT_MS, { sent: false, id: null as string | null });
  return { verdict, fine, plain, sent: sent.sent, id: sent.id, event };
}
