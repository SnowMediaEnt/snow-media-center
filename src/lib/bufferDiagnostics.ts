/**
 * Buffering diagnostics — "is it me, the server, or my ISP?"
 *
 * Framework-free module singleton (plus one React hook at the bottom) that
 * collects three kinds of evidence while a stream plays and turns them into
 * a verdict the viewer can act on:
 *
 *   1. Stream throughput — fed by the engines (hls.js FRAG_LOADED,
 *      mpegts.js STATISTICS_INFO) via `recordStreamThroughput`. On native
 *      (ExoPlayer) there are no engine stats, so we take small background
 *      Range samples from the stream host instead.
 *   2. Neutral probe — a 256 KB download from speed.cloudflare.com measures
 *      *general* internet (TTFB + throughput), independent of the stream.
 *   3. Stream-host probe — measures whether the *source* is slow to respond.
 *      For VOD this is a ranged GET against the stream URL (Range requests
 *      are normal there). For LIVE it is, by default, an opaque GET to the
 *      stream host's origin (TTFB only) so we never open a second session on
 *      an Xtream live URL that a 1-connection line would count or drop.
 *      `setHostProbeEnabled(true)` opts live streams into the ranged GET.
 *
 * Probes run only while a stall has lasted ≥ 1.5 s, at most once every 20 s
 * across the whole stream (not per stall — waiting/playing flapping does not
 * multiply rounds), once more ≥ 10 s after recovery, and never in the first
 * 6 s of a stream (play() on an empty element fires `waiting`). Never while
 * `document.hidden`. Every network call is wrapped; nothing here throws and
 * nothing blocks.
 *
 * The classification lives in the pure `classify()` so it can be unit-tested
 * without the DOM. Worked examples:
 *
 *   A) { buffering:true, online:true, neutralFailStreak:0, probeKbps:45000,
 *        recentKbps:1800, earlyKbps:9200, hostMs:220, hostKbps:12000 }
 *      → 'throttling' — stream fell to 20 % of its early speed while general
 *        internet is 45 Mb/s. Detail: "Speed started at 9.2 Mb/s and fell to
 *        1.8 Mb/s while general internet is fine (45.0 Mb/s) — a VPN usually
 *        fixes this".
 *   B) { buffering:true, online:true, neutralFailStreak:0, probeKbps:2100,
 *        recentKbps:900, earlyKbps:null, hostMs:null, hostKbps:null }
 *      → 'internet' — neutral probe under 4 Mb/s. Headline: "Your internet is
 *        slow right now: 2.1 Mb/s".
 *   C) { buffering:true, online:true, neutralFailStreak:0, probeKbps:38000,
 *        recentKbps:1200, earlyKbps:1500, hostMs:2400, hostKbps:null }
 *      → 'server' — internet is fine (38 Mb/s) but the host took 2.4 s to
 *        answer and the stream never got fast (early 1.5 Mb/s, not a drop).
 */

import { useSyncExternalStore } from 'react';
import { isNativePlatform } from '@/utils/platform';
import { trackEvent } from '@/lib/analytics';

export type Verdict = 'ok' | 'internet' | 'server' | 'throttling' | 'unknown';

export interface DiagSnapshot {
  verdict: Verdict;
  headline: string;
  detail: string;
  /** Recent stream throughput (median of the last samples), kbps. */
  streamKbps: number | null;
  /** Stream throughput during the first 30 s of the stream, kbps. */
  streamEarlyKbps: number | null;
  /** Neutral (general-internet) probe throughput, kbps. */
  probeKbps: number | null;
  /** Neutral probe time-to-first-byte, ms. */
  probeMs: number | null;
  /** Stream-host probe throughput, kbps (null when unknown / playlist). */
  hostKbps: number | null;
  /** Stream-host probe time-to-first-byte, ms (null on CORS / network error). */
  hostMs: number | null;
  /** How long the current stall has lasted (0 when not buffering). */
  bufferingForMs: number;
  online: boolean;
  updatedAt: number;
}

export interface ClassifyInput {
  buffering: boolean;
  online: boolean;
  /** Consecutive neutral-probe failures (error / timeout). */
  neutralFailStreak: number;
  probeKbps: number | null;
  hostMs: number | null;
  hostKbps: number | null;
  recentKbps: number | null;
  earlyKbps: number | null;
}

export interface ClassifyResult {
  verdict: Verdict;
  headline: string;
  detail: string;
}

// ── Tunables ────────────────────────────────────────────────────────────────
const MAX_SAMPLES = 120;
const EARLY_WINDOW_MS = 30_000;
const EARLY_MIN_SAMPLES = 3;
// Native (ExoPlayer) has no engine stats; samples are rare, so one is enough.
const EARLY_MIN_SAMPLES_NATIVE = 1;
const RECENT_WINDOW_MS = 20_000;
const RECENT_MAX_SAMPLES = 5;
// A single low fragment during a stall should not be enough to accuse an ISP.
const RECENT_MIN_SAMPLES = 2;
const ENGINE_ESTIMATE_TTL_MS = 20_000;

const PROBE_AFTER_STALL_MS = 1_500;
const PROBE_INTERVAL_MS = 20_000;
const RECOVERY_PROBE_DELAY_MS = 3_000;
// Recovery round may run sooner than the 20 s floor, but not sooner than this.
const RECOVERY_PROBE_MIN_GAP_MS = 10_000;
// No probe round until the stream has had a chance to start.
const PROBE_WARMUP_MS = 6_000;
const VERDICT_HOLD_MS = 4_000;
const TICK_MS = 1_000;

const NEUTRAL_URL = 'https://speed.cloudflare.com/__down?bytes=262144';
const NEUTRAL_TIMEOUT_MS = 6_000;
const HOST_TIMEOUT_MS = 5_000;
const ORIGIN_TIMEOUT_MS = 5_000;
const HOST_PROBE_BYTES = 131_072;
const NATIVE_SAMPLE_BYTES = 65_536;
const NATIVE_SAMPLE_SCHEDULE_MS = [6_000, 40_000];
const NATIVE_SAMPLE_INTERVAL_MS = 90_000;
// Below this many bytes a throughput number is noise; keep TTFB only.
const MIN_BYTES_FOR_KBPS = 8_192;

// ── Formatting ──────────────────────────────────────────────────────────────
export function formatMbps(kbps: number | null | undefined): string {
  if (kbps == null || !Number.isFinite(kbps)) return '—';
  return `${(kbps / 1000).toFixed(1)} Mb/s`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Pure classification ─────────────────────────────────────────────────────
export function classify(input: ClassifyInput): ClassifyResult {
  const { buffering, online, neutralFailStreak, probeKbps, hostMs, hostKbps, recentKbps, earlyKbps } = input;

  if (!buffering) return { verdict: 'ok', headline: 'Playing normally', detail: '' };

  // 1. Connection gone.
  if (online === false || neutralFailStreak >= 2) {
    return {
      verdict: 'internet',
      headline: 'Your internet connection dropped',
      detail: 'Check Wi-Fi or ethernet',
    };
  }

  // 2. Connection alive but slow.
  if (probeKbps != null && probeKbps < 4000) {
    const streamPart = recentKbps != null ? ` · stream ${formatMbps(recentKbps)}` : '';
    return {
      verdict: 'internet',
      headline: `Your internet is slow right now: ${formatMbps(probeKbps)}`,
      detail: `General internet ${formatMbps(probeKbps)}${streamPart}. Try ethernet or move closer to the router`,
    };
  }

  // 3. Stream started fast, dropped hard, yet general internet is fine → ISP shaping video.
  if (
    recentKbps != null && earlyKbps != null &&
    recentKbps < 0.4 * earlyKbps &&
    probeKbps != null && probeKbps >= 15000
  ) {
    return {
      verdict: 'throttling',
      headline: 'Looks like your ISP is throttling video',
      detail: `Speed started at ${formatMbps(earlyKbps)} and fell to ${formatMbps(recentKbps)} while general internet is fine (${formatMbps(probeKbps)}) — a VPN usually fixes this`,
    };
  }

  // 4. Internet fine, source slow.
  if (probeKbps != null && probeKbps >= 8000) {
    const hostSlow = hostMs != null && hostMs > 1500;
    const hostThin = hostKbps != null && hostKbps < 3000;
    const streamNeverFast = recentKbps != null && recentKbps < 2500 && (earlyKbps == null || earlyKbps < 4000);
    if (hostSlow || hostThin || streamNeverFast) {
      const extras: string[] = [];
      if (hostMs != null) extras.push(`server answered in ${Math.round(hostMs)} ms`);
      if (hostKbps != null) extras.push(`source ${formatMbps(hostKbps)}`);
      else if (recentKbps != null) extras.push(`stream ${formatMbps(recentKbps)}`);
      const tail = extras.length ? ` (${extras.join(', ')})` : '';
      return {
        verdict: 'server',
        headline: 'The stream server is struggling',
        detail: `Your connection is fine (${formatMbps(probeKbps)}); the source is slow to respond${tail}`,
      };
    }
  }

  // 5. Still buffering, nothing conclusive — show what we have.
  const bits: string[] = [];
  if (recentKbps != null) bits.push(`Stream ${formatMbps(recentKbps)}${earlyKbps != null ? ` (was ${formatMbps(earlyKbps)})` : ''}`);
  if (probeKbps != null) bits.push(`Internet ${formatMbps(probeKbps)}`);
  if (hostMs != null) bits.push(`Server ${Math.round(hostMs)} ms`);
  return {
    verdict: 'unknown',
    headline: 'Buffering…',
    detail: bits.length ? bits.join(' · ') : 'Measuring your connection…',
  };
}

// ── Module state ────────────────────────────────────────────────────────────
interface Sample { t: number; kbps: number }
type Timer = ReturnType<typeof setTimeout>;

interface State {
  active: boolean;
  url: string;
  kind: 'live' | 'vod';
  startedAt: number;
  samples: Sample[];
  engineKbps: number | null;
  engineKbpsAt: number;
  buffering: boolean;
  bufferingSince: number;
  neutralFailStreak: number;
  probeKbps: number | null;
  probeMs: number | null;
  hostKbps: number | null;
  hostMs: number | null;
  held: ClassifyResult | null;
  holdUntil: number;
  reported: Set<Verdict>;
}

const freshState = (): State => ({
  active: false,
  url: '',
  kind: 'live',
  startedAt: 0,
  samples: [],
  engineKbps: null,
  engineKbpsAt: 0,
  buffering: false,
  bufferingSince: 0,
  neutralFailStreak: 0,
  probeKbps: null,
  probeMs: null,
  hostKbps: null,
  hostMs: null,
  held: null,
  holdUntil: 0,
  reported: new Set<Verdict>(),
});

let state: State = freshState();
// null = default (VOD: ranged GET on; live: origin TTFB only). true/false = forced.
let hostProbeOverride: boolean | null = null;
// Wall-clock of the last probe round (any kind) — enforces cadence across stalls.
let lastProbeAt = 0;

// Timers
let stallProbeTimer: Timer | null = null;
let recoveryTimer: Timer | null = null;
let holdTimer: Timer | null = null;
let nativeTimer: Timer | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let probeInFlight = false;
let probeAbort: AbortController[] = [];

const listeners = new Set<(s: DiagSnapshot) => void>();

const now = () => Date.now();
const isHidden = (): boolean => {
  try { return typeof document !== 'undefined' && !!document.hidden; } catch { return false; }
};
const isOnline = (): boolean => {
  try { return typeof navigator === 'undefined' || navigator.onLine !== false; } catch { return true; }
};
const saveDataOn = (): boolean => {
  try {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    return !!nav.connection?.saveData;
  } catch { return false; }
};

/**
 * Some IPTV panels cap a line at ONE concurrent connection; a ranged GET to
 * the live URL then counts as a second one (and some panels drop the older
 * session — killing the stream being diagnosed). So the ranged stream-URL
 * probe is OFF by default for live streams and ON for VOD. Call
 * `setHostProbeEnabled(true)` to opt live streams in (provider allows ≥2
 * connections), or `false` to switch it off for VOD too. Live streams without
 * the ranged probe still measure server responsiveness via an opaque GET to
 * the stream host's origin (TTFB only → `hostMs`).
 */
export function setHostProbeEnabled(on: boolean): void {
  hostProbeOverride = !!on;
}

/** Ranged GET against the stream URL allowed for the current stream? */
function rangeProbeAllowed(): boolean {
  if (hostProbeOverride != null) return hostProbeOverride;
  return state.kind === 'vod';
}

// ── Derived numbers ─────────────────────────────────────────────────────────
function earlyKbps(): number | null {
  if (!state.active) return null;
  const cutoff = state.startedAt + EARLY_WINDOW_MS;
  const early = state.samples.filter(s => s.t <= cutoff).map(s => s.kbps);
  const minSamples = isNativePlatform() ? EARLY_MIN_SAMPLES_NATIVE : EARLY_MIN_SAMPLES;
  if (early.length < minSamples) return null;
  return median(early);
}

/**
 * Median of the last samples. While buffering the window is anchored to the
 * stall start (no samples arrive mid-stall, and the evidence gathered just
 * before it must not expire while the viewer is still reading the verdict);
 * samples that do arrive mid-stall still fall inside the window. Never
 * derived from a single sample — one slow fragment must not accuse an ISP.
 */
function recentKbps(at: number): number | null {
  if (!state.active) return null;
  const ref = state.buffering ? Math.min(at, state.bufferingSince) : at;
  const recent = state.samples.filter(s => s.t >= ref - RECENT_WINDOW_MS).slice(-RECENT_MAX_SAMPLES);
  if (recent.length >= RECENT_MIN_SAMPLES) return median(recent.map(s => s.kbps));
  if (state.engineKbps != null && ref - state.engineKbpsAt <= ENGINE_ESTIMATE_TTL_MS) return state.engineKbps;
  return null;
}

// ── Snapshot (cached so useSyncExternalStore gets a stable reference) ───────
const IDLE_SNAPSHOT: DiagSnapshot = {
  verdict: 'ok', headline: 'Playing normally', detail: '',
  streamKbps: null, streamEarlyKbps: null, probeKbps: null, probeMs: null,
  hostKbps: null, hostMs: null, bufferingForMs: 0, online: true, updatedAt: 0,
};
let snapshot: DiagSnapshot = IDLE_SNAPSHOT;

function computeSnapshot(): DiagSnapshot {
  const t = now();
  const online = isOnline();
  const recent = recentKbps(t);
  const early = earlyKbps();
  let result: ClassifyResult;
  if (!state.buffering && state.held && t < state.holdUntil) {
    result = state.held;
  } else {
    result = classify({
      buffering: state.buffering,
      online,
      neutralFailStreak: state.neutralFailStreak,
      probeKbps: state.probeKbps,
      hostMs: state.hostMs,
      hostKbps: state.hostKbps,
      recentKbps: recent,
      earlyKbps: early,
    });
  }
  if (state.buffering) state.held = result;
  return {
    verdict: result.verdict,
    headline: result.headline,
    detail: result.detail,
    streamKbps: recent,
    streamEarlyKbps: early,
    probeKbps: state.probeKbps,
    probeMs: state.probeMs,
    hostKbps: state.hostKbps,
    hostMs: state.hostMs,
    bufferingForMs: state.buffering ? Math.max(0, t - state.bufferingSince) : 0,
    online,
    updatedAt: t,
  };
}

function report(verdict: Verdict, snap: DiagSnapshot) {
  if (verdict === 'ok' || verdict === 'unknown') return;
  if (state.reported.has(verdict)) return;
  state.reported.add(verdict);
  try {
    trackEvent('buffer_diag_verdict', 'player', {
      verdict,
      kind: state.kind,
      native: isNativePlatform(),
      stream_kbps: snap.streamKbps,
      stream_early_kbps: snap.streamEarlyKbps,
      probe_kbps: snap.probeKbps,
      probe_ms: snap.probeMs,
      host_kbps: snap.hostKbps,
      host_ms: snap.hostMs,
      buffering_for_ms: snap.bufferingForMs,
    });
  } catch { /* analytics must never break playback */ }
}

function emit() {
  snapshot = computeSnapshot();
  report(snapshot.verdict, snapshot);
  listeners.forEach(cb => {
    try { cb(snapshot); } catch { /* one bad subscriber must not break the rest */ }
  });
}

// ── Ticker (1 s) — keeps bufferingForMs / recentKbps window fresh ───────────
function ensureTicking() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const t = now();
    const needed = state.active && (state.buffering || (state.held != null && t < state.holdUntil));
    if (!needed) { stopTicking(); emit(); return; }
    emit();
  }, TICK_MS);
}
function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

// ── Probes ──────────────────────────────────────────────────────────────────
interface ProbeResult { ttfbMs: number; kbps: number | null; bytes: number }

/** Fetch `url`, read at most `maxBytes` of the body, then abort. Never throws — resolves null on failure. */
async function measure(url: string, init: RequestInit, timeoutMs: number, maxBytes: number): Promise<ProbeResult | null> {
  if (typeof fetch !== 'function') return null;
  const ac = new AbortController();
  probeAbort.push(ac);
  const timer = setTimeout(() => { try { ac.abort(); } catch { /* ignore */ } }, timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: ac.signal });
    const ttfbMs = performance.now() - t0;
    if (!res.ok && res.status !== 206) return { ttfbMs, kbps: null, bytes: 0 };
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const isText = ct.includes('mpegurl') || ct.startsWith('text/') || ct.includes('json') || ct.includes('xml');
    let bytes = 0;
    const tBody = performance.now();
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value ? value.byteLength : 0;
        if (bytes >= maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      }
    } else {
      const buf = await res.arrayBuffer();
      bytes = buf.byteLength;
    }
    const bodyMs = Math.max(1, performance.now() - tBody);
    const kbps = !isText && bytes >= MIN_BYTES_FOR_KBPS ? (bytes * 8) / bodyMs : null;
    return { ttfbMs, kbps, bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    probeAbort = probeAbort.filter(a => a !== ac);
    try { ac.abort(); } catch { /* ignore */ }
  }
}

async function runNeutralProbe(): Promise<void> {
  const r = await measure(NEUTRAL_URL, { method: 'GET' }, NEUTRAL_TIMEOUT_MS, 1 << 20);
  if (!state.active) return;
  if (!r || r.kbps == null) {
    state.neutralFailStreak += 1;
    if (r) state.probeMs = r.ttfbMs;
  } else {
    state.neutralFailStreak = 0;
    state.probeMs = r.ttfbMs;
    state.probeKbps = r.kbps;
  }
}

/** Ranged GET against the stream URL (opens a media session — VOD / opt-in only). */
async function runRangeProbe(bytes: number, feedSamples: boolean): Promise<void> {
  const url = state.url;
  if (!/^https?:\/\//i.test(url)) return;
  const r = await measure(url, { method: 'GET', headers: { Range: `bytes=0-${bytes - 1}` } }, HOST_TIMEOUT_MS, bytes);
  if (!state.active || state.url !== url) return;
  if (!r) { state.hostMs = null; return; } // CORS / network error is not evidence
  state.hostMs = r.ttfbMs;
  state.hostKbps = r.kbps;
  if (feedSamples && r.kbps != null) pushSample(r.kbps);
}

/**
 * Opaque GET to the stream host's origin — no stream session, no body read,
 * TTFB only. `no-cors` so a panel without CORS headers still yields timing
 * (opaque responses resolve when headers arrive).
 */
async function runOriginProbe(): Promise<void> {
  const url = state.url;
  let origin: string;
  try { origin = new URL(url).origin; } catch { return; }
  if (!/^https?:/i.test(origin)) return;
  const r = await measure(`${origin}/`, { method: 'GET', mode: 'no-cors' }, ORIGIN_TIMEOUT_MS, 0);
  if (!state.active || state.url !== url) return;
  if (!r) { state.hostMs = null; return; }
  state.hostMs = r.ttfbMs;
  state.hostKbps = null;
}

function runHostProbe(bytes: number, feedSamples: boolean): Promise<void> {
  return rangeProbeAllowed() ? runRangeProbe(bytes, feedSamples) : runOriginProbe();
}

/**
 * Neutral + host probes, concurrently. Skipped when hidden, already running,
 * inside the stream warm-up, or sooner than `minGapMs` after the last round
 * (of any kind). Resolves true when a round actually ran.
 */
async function runStallProbes(minGapMs: number = PROBE_INTERVAL_MS): Promise<boolean> {
  if (!state.active || probeInFlight || isHidden()) return false;
  const t = now();
  if (state.samples.length === 0 && t - state.startedAt < PROBE_WARMUP_MS) return false;
  if (lastProbeAt > 0 && t - lastProbeAt < minGapMs) return false;
  probeInFlight = true;
  lastProbeAt = t;
  try {
    const native = isNativePlatform();
    await Promise.all([
      runNeutralProbe(),
      runHostProbe(HOST_PROBE_BYTES, native),
    ]);
  } catch { /* never */ } finally {
    probeInFlight = false;
    lastProbeAt = now();
  }
  if (state.active) emit();
  return true;
}

/** Delay until the cadence floor allows the next stall round (≥ 1 s). */
function nextStallDelay(): number {
  const t = now();
  const warmup = state.samples.length === 0 ? state.startedAt + PROBE_WARMUP_MS - t : 0;
  const cadence = lastProbeAt > 0 ? lastProbeAt + PROBE_INTERVAL_MS - t : 0;
  return Math.max(1_000, warmup, cadence);
}

function scheduleStallProbe(delay: number) {
  clearStallProbe();
  stallProbeTimer = setTimeout(async () => {
    stallProbeTimer = null;
    if (!state.active || !state.buffering) return;
    await runStallProbes();
    if (state.active && state.buffering) scheduleStallProbe(nextStallDelay());
  }, delay);
}
function clearStallProbe() {
  if (stallProbeTimer) { clearTimeout(stallProbeTimer); stallProbeTimer = null; }
}

// Native background host sampling: t=6 s, t=40 s, then every 90 s while NOT
// buffering. Only when the ranged stream-URL probe is allowed (VOD / opt-in) —
// the origin probe yields no throughput, so there would be nothing to sample.
function scheduleNativeSample(index: number) {
  if (nativeTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
  if (!state.active || !isNativePlatform() || saveDataOn() || !rangeProbeAllowed()) return;
  const sinceStart = now() - state.startedAt;
  let delay: number;
  if (index < NATIVE_SAMPLE_SCHEDULE_MS.length) delay = Math.max(0, NATIVE_SAMPLE_SCHEDULE_MS[index] - sinceStart);
  else delay = NATIVE_SAMPLE_INTERVAL_MS;
  nativeTimer = setTimeout(async () => {
    nativeTimer = null;
    if (!state.active) return;
    if (!state.buffering && !isHidden() && !probeInFlight) {
      probeInFlight = true;
      try { await runRangeProbe(NATIVE_SAMPLE_BYTES, true); } catch { /* never */ } finally { probeInFlight = false; }
      if (state.active) emit();
    }
    scheduleNativeSample(index + 1);
  }, delay);
}

function clearAllTimers() {
  clearStallProbe();
  if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (nativeTimer) { clearTimeout(nativeTimer); nativeTimer = null; }
  stopTicking();
  probeAbort.forEach(a => { try { a.abort(); } catch { /* ignore */ } });
  probeAbort = [];
  probeInFlight = false;
}

// ── Samples ─────────────────────────────────────────────────────────────────
function pushSample(kbps: number) {
  if (!Number.isFinite(kbps) || kbps <= 0 || kbps > 5_000_000) return;
  state.samples.push({ t: now(), kbps });
  if (state.samples.length > MAX_SAMPLES) state.samples.splice(0, state.samples.length - MAX_SAMPLES);
}

// ── Public API ──────────────────────────────────────────────────────────────
export function beginStream(url: string, kind: 'live' | 'vod'): void {
  clearAllTimers();
  state = freshState();
  state.active = true;
  state.url = url || '';
  state.kind = kind;
  state.startedAt = now();
  lastProbeAt = 0;
  ensureOnlineListeners();
  scheduleNativeSample(0);
  emit();
}

export function endStream(): void {
  clearAllTimers();
  state = freshState();
  snapshot = IDLE_SNAPSHOT;
  listeners.forEach(cb => { try { cb(snapshot); } catch { /* ignore */ } });
}

/** Engines report bytes moved over a wall-clock window (hls.js FRAG_LOADED, mpegts STATISTICS_INFO). */
export function recordStreamThroughput(bytes: number, durationMs: number): void {
  if (!state.active) return;
  if (!Number.isFinite(bytes) || !Number.isFinite(durationMs) || bytes < 1024 || durationMs <= 0) return;
  pushSample((bytes * 8) / durationMs);
  if (state.buffering) emit();
}

/** hls.bandwidthEstimate (bits per second). */
export function recordEngineEstimate(bps: number): void {
  if (!state.active) return;
  if (!Number.isFinite(bps) || bps <= 0) return;
  state.engineKbps = bps / 1000;
  state.engineKbpsAt = now();
}

export function setBuffering(on: boolean): void {
  if (!state.active) return;
  if (on === state.buffering) return;
  state.buffering = on;
  if (on) {
    state.bufferingSince = now();
    state.held = null;
    state.holdUntil = 0;
    if (recoveryTimer) { clearTimeout(recoveryTimer); recoveryTimer = null; }
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    scheduleStallProbe(Math.max(PROBE_AFTER_STALL_MS, nextStallDelay()));
    ensureTicking();
  } else {
    clearStallProbe();
    state.holdUntil = now() + VERDICT_HOLD_MS;
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { holdTimer = null; state.held = null; if (state.active) emit(); }, VERDICT_HOLD_MS + 50);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(async () => {
      recoveryTimer = null;
      if (!state.active || state.buffering) return;
      await runStallProbes(RECOVERY_PROBE_MIN_GAP_MS);
    }, RECOVERY_PROBE_DELAY_MS);
    ensureTicking();
  }
  emit();
}

export function getSnapshot(): DiagSnapshot {
  return snapshot;
}

export function subscribe(cb: (s: DiagSnapshot) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ── online / offline ────────────────────────────────────────────────────────
let onlineListenersBound = false;
function ensureOnlineListeners() {
  if (onlineListenersBound || typeof window === 'undefined') return;
  onlineListenersBound = true;
  try {
    const handler = () => { if (state.active) emit(); };
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
  } catch { /* ignore */ }
}

// ── React hook ──────────────────────────────────────────────────────────────
export function useBufferDiagnostics(): DiagSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
