// Device Health, the box's side (DEVICE-HEALTH-SPEC.md, part A): a light log
// of what went wrong on this box, for the owner's admin page.
//
//   * Always on, tiny, only when something goes wrong: a stall of 4 s or more
//     (bufferDiagnostics' stall observer, any player that feeds it: Live TV,
//     the Guide, catch-up, films, series, Plex), a player that gave up, a
//     panel saying the line is expired / disabled / wrong / full, and how the
//     last run ended (native crash, WebView renderer gone, killed while on
//     screen). Each event gets a plain verdict: device_overload, internet,
//     server, account, app_crash or unknown (decideVerdict below).
//   * Queue: localStorage, 50 at most (oldest dropped), sent 10 s after the
//     last event and at app start; a failure keeps it; never more than one
//     call every 30 s. Mirrors the server's limits (40 light / 300 in all per
//     24 h) so a box over them stops calling instead of being refused.
//   * Deep check (the owner turns it on per box from the admin side): the
//     `status` ask at start and every 10 minutes on screen says until when.
//     Meanwhile: one `app_start` per start, a `sample` every 10 s while a
//     player is up and every 5 minutes otherwise, sent every 60 s.
//   * Nothing at all is sent when nothing is wrong, except the 10-minute
//     status ask. Nothing in the demo, nothing for an outside service's line.
//
// Privacy: the inbox key (lib/deviceInbox) is sent to device-health only and
// never logged. Every text that goes out is scrubbed (scrubText): no address,
// query string, IP, password, token. `data` keeps only known keys with flat
// values. host + username name the line (the same as device-inbox).
import { supabase } from '@/integrations/supabase/client';
import { isDemo } from '@/lib/demoMode';
import { parseDeviceInfo } from '@/lib/appInfo';
import { loadVersion } from '@/hooks/useVersion';
import { loadCreds } from '@/lib/xtream';
import { isOutsideLine } from '@/lib/outsideSource';
import { deviceLabel, getInboxKey, isWatchingNow, registerLine } from '@/lib/deviceInbox';
import { setStallObserver, type StallReport } from '@/lib/bufferDiagnostics';
import { lastSeekAt } from '@/lib/playerSeek';
import { DeviceHealth, type DeviceVitals, type LastExit } from '@/capacitor/DeviceHealth';
import { SnowPlayer, hasNativePlayer, type PlayerStats } from '@/capacitor/SnowPlayer';

export type HealthKind = 'stall' | 'player_error' | 'crash' | 'killed' | 'auth_error' | 'app_start' | 'sample' | 'check';
export type HealthVerdict = 'device_overload' | 'internet' | 'server' | 'account' | 'app_crash' | 'unknown';
export type HealthContext = 'live' | 'vod' | 'series' | 'plex' | 'catchup' | 'app';
export type HealthValue = number | string | boolean | null;

export interface HealthEvent {
  kind: HealthKind;
  verdict: HealthVerdict;
  summary: string;
  occurredAt: string;
  context?: HealthContext;
  title?: string;
  data: Record<string, HealthValue>;
  /** 'check' only: up to 30 rows of numbers (lib/deviceCheck). */
  samples?: number[][];
}

// --- tunables ------------------------------------------------------------------

export const STALL_MIN_MS = 4_000;
export const QUEUE_MAX = 50;
export const FLUSH_DEBOUNCE_MS = 10_000;
export const MIN_CALL_GAP_MS = 30_000;
export const STATUS_EVERY_MS = 10 * 60_000;
export const DEEP_BATCH_MS = 60_000;
export const DEEP_TICK_MS = 10_000;
export const DEEP_IDLE_SAMPLE_MS = 5 * 60_000;
export const MAX_EVENTS_PER_CALL = 20;
export const LIGHT_PER_DAY = 40;
export const ALL_PER_DAY = 300;
export const CHECKS_PER_DAY = 6;
const DAY_MS = 24 * 60 * 60_000;
const SUMMARY_MAX = 200;
const TITLE_MAX = 120;
const DATA_MAX_BYTES = 4096;
const CHECK_MAX_BYTES = 12 * 1024;
/** A stall merges into one still waiting for the same title within this long. */
const MERGE_WINDOW_MS = 10 * 60_000;
/** After a refusal (rate_limited, not registered) no call for this long. */
const HOLD_AFTER_REFUSAL_MS = 10 * 60_000;
/** The same auth problem on the same line, at most this often. */
const AUTH_REPEAT_MS = 6 * 60 * 60_000;
/** Dropped frames that mean the box can't keep up (with the data arriving fine). */
export const DROPPED_MANY = 60;

const QUEUE_STORE = 'smc-device-health-q-v1';
const BUDGET_STORE = 'smc-device-health-sent-v1';
const DEEP_STORE = 'smc-device-health-deep-v1';

/** The data keys that may go out (DEVICE-HEALTH-SPEC `data` keys, plus the check's summary numbers). */
const DATA_KEYS = new Set([
  'bufferedAheadSec', 'arrivalKbps', 'neededKbps', 'fetchConnections', 'stalls', 'stallSec', 'droppedFrames',
  'cpuPct', 'pssMb', 'memAvailMb', 'memTotalMb', 'lowMemory', 'storageFreeMb', 'wifiRssi', 'wifiLinkMbps',
  'wifiFreqMhz', 'wired', 'uptimeSec', 'appUptimeSec', 'httpStatus', 'errorCode', 'exitReason', 'engine',
  'loadProfile', 'internetMbps',
  // extras: device + exit facts
  'sdk', 'lowRamDevice', 'online', 'restarts', 'stack', 'onScreenSec', 'exitStatus', 'playerActive',
  'firstFrameMs', 'streamKbps', 'internetKbps', 'hostMs', 'diagVerdict', 'reason', 'watching', 'ended',
  // the 30-second check's summary
  'avgBufferedAheadSec', 'minBufferedAheadSec', 'avgArrivalKbps', 'minArrivalKbps', 'cpuPctPeak', 'memAvailMbMin',
  'seconds', 'played', 'source', 'fine',
]);

// --- privacy -----------------------------------------------------------------------

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi;
const QUERY_RE = /[?&][^\s=&]*=[^\s&]*/g;
const SECRET_RE = /\b(user(name)?|pass(word)?|pwd|token|auth|key|pin|x-plex-token|sig|signature)\s*[=:]\s*[^\s&,;]+/gi;
const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
const HOSTPATH_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s]*/gi;
// Not a source file's line ("SnowPlayerPlugin.kt:12" in a crash's stack).
const HOSTPORT_RE = /\b(?:[a-z0-9-]+\.)+(?!kt:|java:)[a-z]{2,}:\d+\b/gi;

/**
 * Text safe to send: anything that looks like an address, a query string, an
 * IP, or `password=…`-style secret is replaced. Trimmed to `max`.
 */
export function scrubText(v: unknown, max = SUMMARY_MAX): string {
  if (typeof v !== 'string') return '';
  const s = v
    .replace(URL_RE, '[link]')
    .replace(SECRET_RE, '[hidden]')
    .replace(HOSTPATH_RE, '[link]')
    .replace(HOSTPORT_RE, '[host]')
    .replace(IP_RE, '[ip]')
    .replace(QUERY_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Only known keys, flat values; strings scrubbed; numbers finite (rounded to 0.1). Fits `maxBytes`. */
export function cleanData(d: Record<string, unknown> | null | undefined, maxBytes = DATA_MAX_BYTES): Record<string, HealthValue> {
  const out: Record<string, HealthValue> = {};
  if (!d || typeof d !== 'object') return out;
  for (const [k, v] of Object.entries(d)) {
    if (!DATA_KEYS.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 10) / 10; continue; }
    if (typeof v === 'boolean') { out[k] = v; continue; }
    if (typeof v === 'string') { const s = scrubText(v, 120); if (s) out[k] = s; }
  }
  // The server keeps 48 keys at most.
  for (const k of Object.keys(out).slice(48)) delete out[k];
  // Too big: the longest strings go first.
  while (JSON.stringify(out).length > maxBytes) {
    const longest = Object.keys(out).filter((k) => typeof out[k] === 'string').sort((a, b) => String(out[b]).length - String(out[a]).length)[0];
    if (!longest) break;
    delete out[longest];
  }
  return out;
}

const KINDS: HealthKind[] = ['stall', 'player_error', 'crash', 'killed', 'auth_error', 'app_start', 'sample', 'check'];
const VERDICTS: HealthVerdict[] = ['device_overload', 'internet', 'server', 'account', 'app_crash', 'unknown'];
const CONTEXTS: HealthContext[] = ['live', 'vod', 'series', 'plex', 'catchup', 'app'];

/** The event as it may go out, or null. */
export function cleanEvent(e: HealthEvent): HealthEvent | null {
  if (!e || !KINDS.includes(e.kind)) return null;
  const at = Date.parse(e.occurredAt);
  const out: HealthEvent = {
    kind: e.kind,
    verdict: VERDICTS.includes(e.verdict) ? e.verdict : 'unknown',
    summary: scrubText(e.summary, SUMMARY_MAX) || e.kind,
    occurredAt: new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
    data: cleanData(e.data, e.kind === 'check' ? CHECK_MAX_BYTES / 2 : DATA_MAX_BYTES),
  };
  if (e.context && CONTEXTS.includes(e.context)) out.context = e.context;
  const title = scrubText(e.title, TITLE_MAX);
  if (title) out.title = title;
  if (e.kind === 'check' && Array.isArray(e.samples)) {
    out.samples = e.samples.slice(0, 30).map((row) => (Array.isArray(row) ? row.slice(0, 8).map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : 0)) : []));
  }
  return out;
}

// --- verdicts --------------------------------------------------------------------

export interface VerdictInput {
  kind: HealthKind;
  data: Record<string, HealthValue>;
  /** bufferDiagnostics' own call on the stall, when there was one. */
  diagVerdict?: string | null;
  /** bufferDiagnostics says the connection dropped. */
  dropped?: boolean;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Why the box looks overloaded, or null. */
export function overloadReason(d: Record<string, HealthValue>): string | null {
  const avail = num(d.memAvailMb);
  const total = num(d.memTotalMb);
  if (d.lowMemory === true) return `box was low on memory${avail != null ? ` (${Math.round(avail)} MB free)` : ''}`;
  if (avail != null && total != null && total > 0 && avail < 0.12 * total) return `box had ${Math.round(avail)} MB free memory of ${Math.round(total)} MB`;
  const cpu = num(d.cpuPctPeak) ?? num(d.cpuPct);
  if (cpu != null && cpu >= 90) return `box CPU at ${Math.round(cpu)}%`;
  const dropped = num(d.droppedFrames);
  const arrival = num(d.arrivalKbps);
  const needed = num(d.neededKbps);
  if (dropped != null && dropped >= DROPPED_MANY && arrival != null && needed != null && arrival >= needed) return `box dropped ${Math.round(dropped)} frames with the data arriving fine`;
  return null;
}

/**
 * The plain verdict (DEVICE-HEALTH-SPEC "Verdict rules"), in order: account,
 * app_crash, device_overload, internet, server, unknown.
 */
export function decideVerdict({ kind, data: d, diagVerdict, dropped }: VerdictInput): HealthVerdict {
  if (kind === 'auth_error') return 'account';
  if (kind === 'crash') return 'app_crash';
  const exitReason = typeof d.exitReason === 'string' ? d.exitReason : '';
  if (kind === 'killed') {
    if (['low_memory', 'anr', 'excessive_resource_usage', 'renderer_killed'].includes(exitReason)) return 'device_overload';
    return overloadReason(d) ? 'device_overload' : 'unknown';
  }
  if (overloadReason(d)) return 'device_overload';

  const arrival = num(d.arrivalKbps);
  const needed = num(d.neededKbps);
  const internetKbps = num(d.internetMbps) != null ? (num(d.internetMbps) as number) * 1000 : null;
  const rssi = num(d.wifiRssi);
  const wired = d.wired === true;
  const offline = d.online === false || dropped === true;
  const starved = arrival != null && needed != null && arrival < needed;
  const weakWifi = !wired && rssi != null && rssi <= -75;
  const slowNet = internetKbps != null && needed != null && internetKbps < needed;
  if (offline) return 'internet';
  if (starved && (weakWifi || slowNet)) return 'internet';
  if (diagVerdict === 'internet' || diagVerdict === 'throttling') return 'internet';

  const http = num(d.httpStatus);
  if (http != null && (http >= 500 || http === 404 || http === 410)) return 'server';
  const goodNet = wired || (rssi != null && rssi > -75) || (internetKbps != null && needed != null && internetKbps >= needed * 1.5);
  if (starved && goodNet) return 'server';
  if (diagVerdict === 'server') return 'server';
  return 'unknown';
}

/** A few words for the summary line on why, by verdict. */
export function verdictWords(v: HealthVerdict, d: Record<string, HealthValue>): string {
  const mbps = (k: number | null) => (k == null ? '?' : `${(k / 1000).toFixed(1)} Mb/s`);
  switch (v) {
    case 'device_overload': return overloadReason(d) ?? 'box overloaded';
    case 'internet': {
      if (d.online === false) return 'no internet connection';
      const rssi = num(d.wifiRssi);
      if (rssi != null && rssi <= -75 && d.wired !== true) return `weak Wi-Fi (${Math.round(rssi)} dBm)`;
      if (num(d.internetMbps) != null) return `internet ${num(d.internetMbps)} Mb/s`;
      return 'internet too slow';
    }
    case 'server': {
      const http = num(d.httpStatus);
      if (http != null) return `stream server answered ${http}`;
      return `server sent ${mbps(num(d.arrivalKbps))}${num(d.neededKbps) != null ? ` of ${mbps(num(d.neededKbps))} needed` : ''}`;
    }
    case 'account': return typeof d.reason === 'string' ? `line ${d.reason.replace(/_/g, ' ')}` : 'line refused';
    case 'app_crash': return 'app crashed';
    default: return 'cause not clear';
  }
}

// --- reading the box -------------------------------------------------------------

/** The stream's own bit rate from the stats' videoFormat ("… 21.6 Mb/s"), kbps. */
export function neededKbpsOf(videoFormat: string | null | undefined): number | null {
  const m = /([\d.]+)\s*Mb\/s/i.exec(videoFormat || '');
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
}

let modelHere: string | null = null;

export async function readVitals(): Promise<DeviceVitals | null> {
  try {
    const v = await DeviceHealth.getDeviceVitals();
    if (v?.model) modelHere = v.model;
    return v ?? null;
  } catch {
    return null;
  }
}

export async function readStats(memory = false): Promise<PlayerStats | null> {
  if (!hasNativePlayer()) return null;
  try {
    return await SnowPlayer.getStats(memory ? { memory: true } : undefined);
  } catch {
    return null;
  }
}

/** The data keys of the box's vitals. */
export function vitalsData(v: DeviceVitals | null): Record<string, HealthValue> {
  if (!v) return {};
  const d: Record<string, HealthValue> = {};
  const keys: Array<keyof DeviceVitals> = ['memAvailMb', 'memTotalMb', 'lowMemory', 'lowRamDevice', 'storageFreeMb', 'wifiRssi', 'wifiLinkMbps', 'wifiFreqMhz', 'wired', 'online', 'uptimeSec', 'appUptimeSec', 'sdk'];
  for (const k of keys) { const x = v[k]; if (x != null) d[k] = x as HealthValue; }
  return d;
}

/** The data keys of the player's stats (no title, no address: the stats have none). */
export function statsData(s: PlayerStats | null): Record<string, HealthValue> {
  if (!s || s.state === 'idle') return {};
  const d: Record<string, HealthValue> = {
    bufferedAheadSec: s.bufferedAheadSec,
    arrivalKbps: s.arrivalKbps ?? s.nowKbps ?? null,
    neededKbps: neededKbpsOf(s.videoFormat),
    fetchConnections: s.fetchConnections ?? null,
    droppedFrames: s.droppedFrames,
    cpuPct: s.cpuPct,
    pssMb: s.pssMb,
    httpStatus: s.httpStatus ?? null,
    errorCode: s.lastError,
    engine: s.engine,
    loadProfile: s.loadProfile,
    restarts: s.restarts,
    firstFrameMs: s.firstFrameMs,
  };
  if (s.lowRamBox != null) d.lowRamDevice = s.lowRamBox;
  return d;
}

// --- what is playing ----------------------------------------------------------------

interface NowPlaying { context: HealthContext; title: string | null }
let nowPlaying: NowPlaying | null = null;

/** The players say what they play (useNativePlayer's `health`), for the stall and error lines. */
export function setNowPlaying(np: NowPlaying | null): void {
  nowPlaying = np ? { context: np.context, title: np.title ? np.title.slice(0, TITLE_MAX) : null } : null;
}
export function getNowPlaying(): NowPlaying | null { return nowPlaying; }

// --- line ---------------------------------------------------------------------------

export const lineIdOf = (host: string, username: string): string =>
  `${String(host || '').trim().toLowerCase().replace(/\/+$/, '')}|${String(username || '').trim().toLowerCase()}`;

// --- queue + budget -----------------------------------------------------------------

interface Item {
  e: HealthEvent;
  /** The line it is about (auth errors); null: whatever line the box is on. */
  line: string | null;
  deep: boolean;
}

let queueHere: Item[] | null = null;

function readQueue(): Item[] {
  if (queueHere) return queueHere;
  try {
    const raw = localStorage.getItem(QUEUE_STORE);
    const p = raw ? JSON.parse(raw) : null;
    if (Array.isArray(p)) queueHere = p.filter((i) => i && i.e && typeof i.e.kind === 'string').slice(-QUEUE_MAX);
  } catch { /* fall through */ }
  if (!queueHere) queueHere = [];
  return queueHere;
}

function writeQueue(q: Item[]): void {
  queueHere = q.slice(-QUEUE_MAX);
  try { localStorage.setItem(QUEUE_STORE, JSON.stringify(queueHere)); } catch { /* kept in memory */ }
}

/** The events waiting (a copy), for tests and the curious. */
export function pendingHealthEvents(): HealthEvent[] { return readQueue().map((i) => i.e); }

interface Budget { light: number[]; all: number[]; checks: number[] }
let budgetHere: Budget | null = null;

function readBudget(): Budget {
  const cut = Date.now() - DAY_MS;
  let b = budgetHere;
  if (!b) {
    try {
      const p = JSON.parse(localStorage.getItem(BUDGET_STORE) || 'null');
      if (p && Array.isArray(p.light) && Array.isArray(p.all)) b = { light: p.light, all: p.all, checks: Array.isArray(p.checks) ? p.checks : [] };
    } catch { /* fall through */ }
  }
  if (!b) b = { light: [], all: [], checks: [] };
  b = { light: b.light.filter((t) => t > cut), all: b.all.filter((t) => t > cut), checks: b.checks.filter((t) => t > cut) };
  budgetHere = b;
  return b;
}

function writeBudget(b: Budget): void {
  budgetHere = b;
  try { localStorage.setItem(BUDGET_STORE, JSON.stringify(b)); } catch { /* memory */ }
}

const queuedCount = (pred: (i: Item) => boolean) => readQueue().filter(pred).length;

/** Room for one more of this kind in today's budget (sent + waiting). */
function roomFor(deep: boolean, kind: HealthKind): boolean {
  const b = readBudget();
  if (kind === 'check') return b.checks.length + queuedCount((i) => i.e.kind === 'check') < CHECKS_PER_DAY;
  if (b.all.length + queuedCount((i) => i.e.kind !== 'check') >= ALL_PER_DAY) return false;
  if (!deep && b.light.length + queuedCount((i) => !i.deep && i.e.kind !== 'check') >= LIGHT_PER_DAY) return false;
  return true;
}

/** Whether another check may be run today (6 per box per 24 h). */
export function checkAllowedToday(): boolean { return roomFor(false, 'check'); }

// --- deep mode ------------------------------------------------------------------------

let deepUntilHere: number | null = null;
const deepListeners = new Set<(until: number | null) => void>();

function readDeep(): number | null {
  if (deepUntilHere != null) return deepUntilHere > Date.now() ? deepUntilHere : null;
  try {
    const n = Number(localStorage.getItem(DEEP_STORE));
    if (Number.isFinite(n) && n > Date.now()) { deepUntilHere = n; return n; }
  } catch { /* ignore */ }
  return null;
}

/** When this box's deep check ends (ms), or null when none is on. */
export function deepUntil(): number | null { return readDeep(); }
export function isDeep(): boolean { return readDeep() != null; }

export function subscribeDeep(fn: (until: number | null) => void): () => void {
  deepListeners.add(fn);
  return () => { deepListeners.delete(fn); };
}

function setDeepUntil(raw: unknown): void {
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  const next = Number.isFinite(t) && t > Date.now() ? t : null;
  const before = readDeep();
  deepUntilHere = next ?? 0;
  try { if (next) localStorage.setItem(DEEP_STORE, String(next)); else localStorage.removeItem(DEEP_STORE); } catch { /* ignore */ }
  if (before !== next) {
    deepListeners.forEach((fn) => { try { fn(next); } catch { /* ignore */ } });
    syncDeepTimers();
  }
}

// --- the call -------------------------------------------------------------------------

type Reply = Record<string, unknown> & { ok?: unknown; reason?: unknown };

async function call(body: Record<string, unknown>): Promise<Reply> {
  try {
    const { data, error } = await supabase.functions.invoke('device-health', { body });
    if (!error) return data && typeof data === 'object' ? (data as Reply) : { ok: false, reason: 'bad_response' };
    const res = (error as { context?: Response }).context;
    try {
      const parsed = res && typeof res.clone === 'function' ? await res.clone().json() : null;
      if (parsed && typeof parsed === 'object' && typeof (parsed as Reply).reason === 'string') return { ...(parsed as Reply), ok: false };
    } catch { /* not JSON */ }
    if (res?.status === 404) return { ok: false, reason: 'not_deployed' };
    return { ok: false, reason: 'network' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

interface LineNow { host: string; username: string; id: string; creds: Awaited<ReturnType<typeof loadCreds>> }

async function currentLine(): Promise<LineNow | null> {
  const creds = await loadCreds().catch(() => null);
  if (!creds?.host || !creds.username) return null;
  if (isOutsideLine(creds)) return null;
  return { host: creds.host, username: creds.username, id: lineIdOf(creds.host, creds.username), creds };
}

let versionHere: { version: string; versionCode: number } | null = null;
async function appVersion(): Promise<{ version: string; versionCode: number }> {
  if (!versionHere) {
    try { versionHere = await loadVersion(); } catch { versionHere = { version: '', versionCode: 0 }; }
  }
  return versionHere;
}

function osVersion(): string {
  try { const a = parseDeviceInfo().android; return a ? `Android ${a}` : ''; } catch { return ''; }
}

// --- flushing ------------------------------------------------------------------------

let lastCallAt = 0;
let holdUntil = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushAt = 0;
let flushing: Promise<SendOutcome> | null = null;

/** `ids`: the server's event ids, by position (null: that one was dropped). */
export interface SendOutcome { ok: boolean; ids?: Array<string | null>; reason?: string }

function scheduleFlush(delayMs: number): void {
  if (isDemo()) return;
  const gap = lastCallAt ? lastCallAt + MIN_CALL_GAP_MS - Date.now() : 0;
  const hold = holdUntil - Date.now();
  const delay = Math.max(delayMs, gap, hold, 0);
  const at = Date.now() + delay;
  if (flushTimer && flushAt <= at) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushAt = at;
  flushTimer = setTimeout(() => { flushTimer = null; flushAt = 0; void flushNow(); }, delay);
}

/**
 * Send what is waiting (up to 20, the line's own and the box's own). `first`
 * goes ahead of them (a check), and is queued if the call fails. Never throws.
 */
async function doFlush(first: Item | null, force: boolean): Promise<SendOutcome> {
  const line = await currentLine();
  const q = readQueue();
  if (!line) {
    if (first) writeQueue([...q, first]);
    return { ok: false, reason: 'no_line' };
  }
  if (!force && (Date.now() < holdUntil || (lastCallAt && Date.now() - lastCallAt < MIN_CALL_GAP_MS))) {
    if (first) writeQueue([...q, first]);
    scheduleFlush(0);
    return { ok: false, reason: 'too_soon' };
  }
  // Another line's auth errors are not this line's to report: let them go.
  const mine = q.filter((i) => i.line == null || i.line === line.id);
  const batch = [...(first ? [first] : []), ...mine].slice(0, MAX_EVENTS_PER_CALL);
  if (batch.length === 0) { if (mine.length !== q.length) writeQueue(mine); return { ok: true, ids: [] }; }
  const key = await getInboxKey();
  if (!key) { if (first) writeQueue([...q, first]); return { ok: false, reason: 'no_key' }; }
  const v = await appVersion();
  lastCallAt = Date.now();
  const events = batch.map((i) => cleanEvent(i.e)).filter((e): e is HealthEvent => !!e);
  const res = await call({
    action: 'report',
    inbox_key: key,
    host: line.host,
    username: line.username,
    app_version: v.version,
    version_code: v.versionCode,
    device_model: modelHere || deviceLabel(),
    os_version: osVersion(),
    events,
  });
  if (res.ok === true) {
    const sent = new Set(batch);
    const rest = mine.filter((i) => !sent.has(i));
    writeQueue(rest);
    const b = readBudget();
    const t = Date.now();
    for (const i of batch) {
      if (i.e.kind === 'check') b.checks.push(t);
      else { b.all.push(t); if (!i.deep) b.light.push(t); }
    }
    writeBudget(b);
    if ('deep_until' in res) setDeepUntil(res.deep_until);
    if (rest.length) scheduleFlush(isDeep() ? DEEP_BATCH_MS : FLUSH_DEBOUNCE_MS);
    const ids = Array.isArray(res.ids) ? res.ids.map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : null)) : [];
    return { ok: true, ids };
  }
  // Kept for later (the check too).
  writeQueue(first ? [...mine, first] : mine);
  const reason = typeof res.reason === 'string' ? res.reason : 'failed';
  if (reason === 'unknown_key' || reason === 'other_line') {
    holdUntil = Date.now() + HOLD_AFTER_REFUSAL_MS;
    if (line.creds?.password) void registerLine(line.creds, { again: true });
  } else if (reason === 'rate_limited' || reason === 'bad_request') {
    holdUntil = Date.now() + HOLD_AFTER_REFUSAL_MS;
  }
  return { ok: false, reason };
}

/** Send what is waiting now (one at a time; at most one call every 30 s). */
export function flushNow(): Promise<SendOutcome> {
  if (isDemo()) return Promise.resolve({ ok: false, reason: 'demo' });
  if (!flushing) flushing = doFlush(null, false).catch(() => ({ ok: false, reason: 'failed' } as SendOutcome)).finally(() => { flushing = null; });
  return flushing;
}

/** A customer's check, sent at once ahead of anything waiting. Resolves with its id when the server took it. */
export async function sendCheckNow(e: HealthEvent): Promise<{ sent: boolean; id: string | null }> {
  if (isDemo()) return { sent: false, id: null };
  if (flushing) await flushing.catch(() => null);
  const item: Item = { e, line: null, deep: false };
  const p = doFlush(item, true).catch(() => ({ ok: false } as SendOutcome));
  flushing = p.finally(() => { flushing = null; });
  const r = await p;
  return { sent: r.ok, id: r.ok && r.ids && r.ids.length ? r.ids[0] ?? null : null };
}

// --- recording ------------------------------------------------------------------------

export interface RecordOpts { deep?: boolean; line?: string | null }

/** Queue one event (scrubbed), and send it soon. Returns whether it was kept. */
export function recordHealthEvent(e: HealthEvent, opts: RecordOpts = {}): boolean {
  if (isDemo()) return false;
  const deep = opts.deep === true;
  const clean = cleanEvent(e);
  if (!clean) return false;
  const q = readQueue();
  // A stall merges into one still waiting for the same title and verdict.
  if (clean.kind === 'stall') {
    const t = Date.parse(clean.occurredAt);
    const same = [...q].reverse().find((i) => i.e.kind === 'stall' && i.e.title === clean.title && i.e.context === clean.context
      && i.e.verdict === clean.verdict && Math.abs(t - Date.parse(i.e.occurredAt)) < MERGE_WINDOW_MS);
    if (same) {
      const stalls = (num(same.e.data.stalls) ?? 1) + 1;
      const stallSec = (num(same.e.data.stallSec) ?? 0) + (num(clean.data.stallSec) ?? 0);
      same.e = { ...clean, occurredAt: same.e.occurredAt, data: { ...clean.data, stalls, stallSec } };
      same.e.summary = scrubText(stallSummary(stalls, stallSec, clean.title ?? null, clean.context, clean.verdict, clean.data));
      writeQueue(q);
      scheduleFlush(deep ? DEEP_BATCH_MS : FLUSH_DEBOUNCE_MS);
      return true;
    }
  }
  if (!roomFor(deep, clean.kind)) return false;
  writeQueue([...q, { e: clean, line: opts.line ?? null, deep }]);
  scheduleFlush(deep || isDeep() ? (deep ? DEEP_BATCH_MS : FLUSH_DEBOUNCE_MS) : FLUSH_DEBOUNCE_MS);
  return true;
}

// --- stalls ----------------------------------------------------------------------------

const CONTEXT_WORD: Record<HealthContext, string> = { live: 'a channel', vod: 'a film', series: 'an episode', plex: 'a Plex title', catchup: 'catch-up', app: 'the app' };

function stallSummary(stalls: number, stallSec: number, title: string | null, context: HealthContext | undefined, verdict: HealthVerdict, d: Record<string, HealthValue>): string {
  const what = title || CONTEXT_WORD[context ?? 'live'];
  const head = stalls > 1 ? `Stalled ${stalls} times (${Math.round(stallSec)} s) on ${what}` : `Stalled ${Math.round(stallSec)} s on ${what}`;
  return `${head}: ${verdictWords(verdict, d)}`;
}

/** bufferDiagnostics' observer: a stall of 4 s or more becomes an event. */
export async function onStallOver(r: StallReport): Promise<void> {
  if (isDemo()) return;
  if (!r || r.durationMs < STALL_MIN_MS) return;
  // The refill after a seek / Go live is the viewer's jump, not a stall.
  const began = Date.now() - r.durationMs;
  const seek = lastSeekAt();
  if (seek > 0 && began - seek < 3_000 && began >= seek - 1_000) return;
  const np = nowPlaying;
  const context: HealthContext = np?.context ?? (r.kind === 'live' ? 'live' : 'vod');
  const [stats, vitals] = await Promise.all([readStats(), readVitals()]);
  const data: Record<string, HealthValue> = {
    ...vitalsData(vitals),
    ...statsData(stats),
    stalls: 1,
    stallSec: Math.round(r.durationMs / 100) / 10,
    ended: r.ended,
    streamKbps: r.streamKbps,
    hostMs: r.hostMs,
    diagVerdict: r.verdict,
  };
  // The player's rate mid-stall is the arrival that counted.
  if (r.nowKbps != null) data.arrivalKbps = r.nowKbps;
  if (r.probeKbps != null) data.internetMbps = Math.round(r.probeKbps / 100) / 10;
  if (r.online === false) data.online = false;
  const verdict = decideVerdict({ kind: 'stall', data, diagVerdict: r.verdict, dropped: r.dropped });
  recordHealthEvent({
    kind: 'stall',
    verdict,
    summary: stallSummary(1, r.durationMs / 1000, np?.title ?? null, context, verdict, data),
    occurredAt: new Date(began).toISOString(),
    context,
    title: np?.title ?? undefined,
    data,
  }, { deep: false });
}

// --- player errors + auth ---------------------------------------------------------------

/** HTTP answers from a line's own stream address that mean the line, not the stream. */
const AUTH_HTTP = new Set([401, 403, 509]);
const authSeen = new Map<string, number>();

export interface PlayerErrorInfo { code?: string; message?: string; httpStatus?: number | null }

/** A player gave up (useNativePlayer's error card). Never throws. */
export async function notePlayerError(err: PlayerErrorInfo): Promise<void> {
  if (isDemo()) return;
  try {
    const np = nowPlaying;
    const context: HealthContext = np?.context ?? 'live';
    const http = typeof err.httpStatus === 'number' && err.httpStatus > 0 ? err.httpStatus : null;
    if (http != null && AUTH_HTTP.has(http) && context !== 'plex') {
      await noteAuthError({ reason: http === 509 ? 'max_connections' : `http_${http}`, httpStatus: http });
      return;
    }
    const [stats, vitals] = await Promise.all([readStats(), readVitals()]);
    const data: Record<string, HealthValue> = { ...vitalsData(vitals), ...statsData(stats), httpStatus: http, errorCode: err.code ?? null };
    const verdict = decideVerdict({ kind: 'player_error', data });
    const what = np?.title || CONTEXT_WORD[context];
    recordHealthEvent({
      kind: 'player_error',
      verdict,
      summary: `Player gave up on ${what}${err.code ? ` (${err.code})` : ''}: ${verdictWords(verdict, data)}`,
      occurredAt: new Date().toISOString(),
      context,
      title: np?.title ?? undefined,
      data,
    });
  } catch { /* never into playback */ }
}

export type AuthReason = 'expired' | 'disabled' | 'banned' | 'wrong_login' | 'max_connections' | string;

/** The reason word for a refused sign-in check (lib/xtream authenticateRouted's result). */
export function authReasonOf(res: { invalidLogin?: boolean; authedButBlocked?: boolean; userInfo?: { status?: unknown } | null }): AuthReason {
  if (res.invalidLogin) return 'wrong_login';
  const st = String(res.userInfo?.status ?? '').toLowerCase();
  if (st === 'expired' || st === 'disabled' || st === 'banned') return st;
  return res.authedButBlocked ? 'disabled' : 'refused';
}

/**
 * The panel refused the line (a reconcile's sign-in check, or a stream's
 * 401/403/509). `host`/`username`: the line it is about; left out, the line
 * in use. Only ever reported for the line this box is signed into.
 */
export async function noteAuthError(a: { reason: AuthReason; host?: string; username?: string; httpStatus?: number | null }): Promise<void> {
  if (isDemo()) return;
  try {
    const now = await currentLine();
    if (!now) return;
    const id = a.host && a.username ? lineIdOf(a.host, a.username) : now.id;
    if (id !== now.id) return;
    const reason = String(a.reason || 'refused').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40);
    const seenKey = `${id}#${reason}`;
    const seen = authSeen.get(seenKey) ?? 0;
    if (Date.now() - seen < AUTH_REPEAT_MS) return;
    authSeen.set(seenKey, Date.now());
    const data: Record<string, HealthValue> = { reason, httpStatus: a.httpStatus ?? null };
    const words: Record<string, string> = {
      expired: 'the line has expired', disabled: 'the line is disabled', banned: 'the line is banned',
      wrong_login: 'the panel says the username or password is wrong', max_connections: 'too many connections on the line',
    };
    recordHealthEvent({
      kind: 'auth_error',
      verdict: 'account',
      summary: `Panel refused the line: ${words[reason] ?? reason.replace(/_/g, ' ')}`,
      occurredAt: new Date().toISOString(),
      context: nowPlaying?.context ?? 'app',
      data,
    }, { line: id });
  } catch { /* best effort */ }
}

// --- how the last run ended ---------------------------------------------------------------

/** A crash's stack in the 120 characters the server keeps: the class, then the frames, shortest form. */
export function compactStack(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const parts = stack.split('\n').map((l) => l.trim().replace(/^at\s+/, '').replace(/^caused by\s+/, '<- ')).filter(Boolean);
  if (!parts.length) return null;
  const short = parts.map((p, i) => (i === 0 ? p.replace(/^(?:[a-z0-9_]+\.)+/i, '') : p.replace(/^(?:[a-z0-9_]+\.)+(?=[A-Z])/, '')));
  return short.join(' | ').slice(0, 120);
}

function exitSummary(x: LastExit): string {
  const r = x.exitReason || 'unknown';
  if (x.kind === 'crash') {
    if (r === 'renderer_killed') return `The app's screen (WebView) was shut by Android${x.memAvailMb != null ? `, ${x.memAvailMb} MB free memory` : ''}${x.playerActive ? ' during playback' : ''}`;
    if (r === 'renderer_crashed') return `The app's screen (WebView) crashed${x.playerActive ? ' during playback' : ''}`;
    const first = (x.stack || '').split('\n')[0];
    return `The app crashed${first ? ` (${first})` : ''}${r === 'crash_native' ? ' in native code' : ''}`;
  }
  const why: Record<string, string> = {
    low_memory: 'Android ran out of memory', anr: 'the app stopped responding (ANR)', box_restarted: 'the box restarted or lost power',
    excessive_resource_usage: 'Android stopped it for using too much', signaled: 'Android killed it', unknown: 'no reason given',
  };
  return `SMC stopped while on screen: ${why[r] ?? r.replace(/_/g, ' ')}`;
}

/** The exits the native side kept, as events. */
export function exitEvents(exits: LastExit[], vitals: DeviceVitals | null): HealthEvent[] {
  const out: HealthEvent[] = [];
  for (const x of exits || []) {
    if (!x || (x.kind !== 'crash' && x.kind !== 'killed')) continue;
    const data: Record<string, HealthValue> = {
      memTotalMb: vitals?.memTotalMb ?? null,
      sdk: vitals?.sdk ?? null,
      exitReason: x.exitReason ?? 'unknown',
      stack: compactStack(x.stack),
      onScreenSec: x.onScreenSec ?? null,
      pssMb: x.pssMb ?? null,
      exitStatus: x.exitStatus ?? null,
      playerActive: x.playerActive ?? null,
    };
    if (x.memAvailMb != null) data.memAvailMb = x.memAvailMb;
    if (x.memTotalMb != null) data.memTotalMb = x.memTotalMb;
    if (x.lowMemory != null) data.lowMemory = x.lowMemory;
    const at = typeof x.at === 'number' && x.at > 0 ? x.at : Date.now();
    out.push({
      kind: x.kind,
      verdict: decideVerdict({ kind: x.kind, data }),
      summary: exitSummary(x),
      occurredAt: new Date(at).toISOString(),
      context: 'app',
      data,
    });
  }
  return out;
}

async function takeExits(): Promise<void> {
  try {
    const [{ exits }, vitals] = await Promise.all([DeviceHealth.takeLastExits(), readVitals()]);
    for (const e of exitEvents(exits, vitals)) recordHealthEvent(e);
  } catch { /* an older build has no such plugin */ }
}

// --- deep mode: app_start + samples ---------------------------------------------------------

let deepTick: ReturnType<typeof setInterval> | null = null;
let appStartSent = false;
let lastIdleSampleAt = 0;
let sampleCount = 0;

export async function takeSample(): Promise<HealthEvent | null> {
  const watching = isWatchingNow();
  sampleCount += 1;
  const [vitals, stats] = await Promise.all([readVitals(), watching ? readStats(sampleCount % 6 === 0) : Promise.resolve(null)]);
  const data: Record<string, HealthValue> = { ...vitalsData(vitals), ...statsData(stats), watching };
  const verdict = decideVerdict({ kind: 'sample', data });
  const np = nowPlaying;
  const mem = num(data.memAvailMb);
  const bits = [mem != null ? `${Math.round(mem)} MB free` : null,
    num(data.bufferedAheadSec) != null ? `buffer ${num(data.bufferedAheadSec)} s` : null,
    num(data.arrivalKbps) != null ? `${((num(data.arrivalKbps) as number) / 1000).toFixed(1)} Mb/s arriving` : null].filter(Boolean).join(', ');
  return {
    kind: 'sample',
    verdict,
    summary: `${watching ? `Playing ${np?.title || CONTEXT_WORD[np?.context ?? 'live']}` : 'Idle'}${bits ? `: ${bits}` : ''}`,
    occurredAt: new Date().toISOString(),
    context: watching ? (np?.context ?? 'live') : 'app',
    title: watching ? np?.title ?? undefined : undefined,
    data,
  };
}

async function deepStep(): Promise<void> {
  if (!isDeep()) { syncDeepTimers(); return; }
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const watching = isWatchingNow();
  if (!watching && Date.now() - lastIdleSampleAt < DEEP_IDLE_SAMPLE_MS) return;
  if (!watching) lastIdleSampleAt = Date.now();
  if (!roomFor(true, 'sample')) return;
  const e = await takeSample();
  if (e) recordHealthEvent(e, { deep: true });
}

async function sendAppStart(): Promise<void> {
  if (appStartSent || !isDeep()) return;
  appStartSent = true;
  const vitals = await readVitals();
  const v = await appVersion();
  recordHealthEvent({
    kind: 'app_start',
    verdict: 'unknown',
    summary: `App started (${v.version || 'version ?'}) on ${vitals?.model || deviceLabel()}`,
    occurredAt: new Date().toISOString(),
    context: 'app',
    data: vitalsData(vitals),
  }, { deep: true });
}

function syncDeepTimers(): void {
  const on = started && isDeep();
  if (on && !deepTick) {
    void sendAppStart();
    lastIdleSampleAt = 0;
    deepTick = setInterval(() => { void deepStep(); }, DEEP_TICK_MS);
    void deepStep();
  } else if (!on && deepTick) {
    clearInterval(deepTick);
    deepTick = null;
  }
}

// --- status ---------------------------------------------------------------------------------

/** Ask the server whether a deep check is on for this box. Never throws. */
export async function askStatus(): Promise<void> {
  if (isDemo()) return;
  try {
    const line = await currentLine();
    if (!line) return;
    const key = await getInboxKey();
    if (!key) return;
    const res = await call({ action: 'status', inbox_key: key, host: line.host, username: line.username });
    if (res.ok === true) setDeepUntil(res.deep_until);
  } catch { /* next time */ }
}

// --- start -------------------------------------------------------------------------------------

let started = false;
let stopAll: (() => void) | null = null;

/**
 * Once per app: the stall observer, last run's exits, a flush of what waited,
 * the status ask now and every 10 minutes on screen. Returns the stop.
 */
export function startDeviceHealth(): () => void {
  if (isDemo()) return () => {};
  if (stopAll) return stopAll;
  started = true;
  setStallObserver((r) => { void onStallOver(r); });
  void takeExits().then(() => { if (readQueue().length) scheduleFlush(0); });
  void askStatus();
  syncDeepTimers();

  let statusTimer: ReturnType<typeof setInterval> | null = null;
  const arm = () => { if (!statusTimer) statusTimer = setInterval(() => { void askStatus(); }, STATUS_EVERY_MS); };
  const disarm = () => { if (statusTimer) { clearInterval(statusTimer); statusTimer = null; } };
  let shown = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const onVisibility = () => {
    const v = document.visibilityState !== 'hidden';
    if (v === shown) return;
    shown = v;
    if (v) arm(); else disarm();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (shown) arm();

  stopAll = () => {
    started = false;
    disarm();
    document.removeEventListener('visibilitychange', onVisibility);
    setStallObserver(null);
    syncDeepTimers();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; flushAt = 0; }
    stopAll = null;
  };
  return stopAll;
}

// Tests only.
export function __resetDeviceHealthForTests(): void {
  stopAll?.();
  stopAll = null;
  started = false;
  queueHere = null;
  budgetHere = null;
  deepUntilHere = null;
  deepListeners.clear();
  lastCallAt = 0;
  holdUntil = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushAt = 0;
  flushing = null;
  nowPlaying = null;
  authSeen.clear();
  appStartSent = false;
  lastIdleSampleAt = 0;
  sampleCount = 0;
  versionHere = null;
  modelHere = null;
  if (deepTick) { clearInterval(deepTick); deepTick = null; }
}
