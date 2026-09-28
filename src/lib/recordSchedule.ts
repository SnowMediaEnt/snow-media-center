// Scheduled recordings from the Guide (TRACKER 25.10): the rules the dialog
// and the Guide need before anything is handed to the native scheduler.
//
// The window / merge / conflict / fire rules are the twin of
// android/.../dvr/ScheduleRules.kt: both read the same vectors
// (recordSchedule.vectors.json), so change one side, change the other.
//
// A schedule is one programme: its true UTC start and end plus the padding it
// was made with. It never holds a stream address, user name or password; the
// native scheduler rebuilds the address at fire time from the saved login.
import { SnowRecorder, hasRecorder } from '@/capacitor/SnowRecorder';
import { deviceUtcOffsetMinutes, formatBytes } from '@/lib/liveRewind';
import { MAX_SIMULTANEOUS_RECORDINGS } from '@/lib/recording';

const MIN = 60_000;
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
/** "21:05" in the box's own clock. */
export const clockLabel = (ms: number): string => `${pad2(new Date(ms).getHours())}:${pad2(new Date(ms).getMinutes())}`;

// ---- padding (Live TV › Settings › Rewind & recording) -----------------------

export interface RecordPadding {
  /** Minutes to start before the programme. */
  beforeMin: number;
  /** Minutes to keep going after it. */
  afterMin: number;
}

export const PADDING_KEY = 'smc-record-padding-v1';
/** Fired (on window) when the padding changes. */
export const PADDING_EVENT = 'smc-record-padding:changed';
export const BEFORE_CHOICES = [0, 2, 5, 10];
export const AFTER_CHOICES = [0, 5, 10, 15, 30];
export const DEFAULT_PADDING: RecordPadding = { beforeMin: 2, afterMin: 5 };

const pick = (v: unknown, choices: number[], fallback: number): number => {
  const n = Number(v);
  return choices.includes(n) ? n : fallback;
};

export function loadPadding(): RecordPadding {
  try {
    const raw = localStorage.getItem(PADDING_KEY);
    if (!raw) return { ...DEFAULT_PADDING };
    const o = JSON.parse(raw) as Partial<RecordPadding>;
    return {
      beforeMin: pick(o.beforeMin, BEFORE_CHOICES, DEFAULT_PADDING.beforeMin),
      afterMin: pick(o.afterMin, AFTER_CHOICES, DEFAULT_PADDING.afterMin),
    };
  } catch {
    return { ...DEFAULT_PADDING };
  }
}

export function savePadding(p: RecordPadding): void {
  try { localStorage.setItem(PADDING_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent(PADDING_EVENT)); } catch { /* no window */ }
}

// ---- programme times ---------------------------------------------------------

/**
 * One end of a programme as UTC ms. A listing's `start_timestamp` /
 * `stop_timestamp` are true UTC seconds. Without them the `start` / `end`
 * text is the PANEL's local time: read it as UTC, then take off the panel's
 * offset (minutes ahead of UTC). No offset known: the box's own. Null when it
 * can't be read.
 */
export function programmeTimeUtcMs(raw: string | undefined, panelOffsetMin: number | null): number | null {
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 1_000_000_000) return asNum * 1000;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return asUtc - (panelOffsetMin ?? deviceUtcOffsetMinutes(asUtc)) * MIN;
}

// ---- windows, merging, conflicts (twin of ScheduleRules.kt) --------------------

/** Recordings never run longer than this. */
export const MAX_RECORD_MS = 12 * 60 * MIN;
/** An alarm this much after the padded start is still on time. */
export const LATE_SLACK_MS = 3 * MIN;

export interface SchedLike {
  id: string;
  streamId: number;
  /** The line, when known (the native side always has it; the web list does not). */
  host?: string;
  userTag?: string;
  startUtcMs: number;
  endUtcMs: number;
  padBeforeMin: number;
  padAfterMin: number;
  status?: string;
}

export interface Merged { streamId: number; startMs: number; endMs: number; ids: string[] }
export interface Conflict { atMs: number; count: number }

/** The recording's own window: padded, and cut at 12 h. */
export function paddedWindow(s: Pick<SchedLike, 'startUtcMs' | 'endUtcMs' | 'padBeforeMin' | 'padAfterMin'>): { startMs: number; endMs: number } {
  const startMs = s.startUtcMs - s.padBeforeMin * MIN;
  return { startMs, endMs: Math.min(s.endUtcMs + s.padAfterMin * MIN, startMs + MAX_RECORD_MS) };
}

const lineKey = (s: SchedLike) => `${s.host ?? ''}|${s.userTag ?? ''}`;
const isActive = (s: SchedLike) => (s.status ?? 'scheduled') === 'scheduled' || s.status === 'recording';

/** Back-to-back on one channel and line = one job (windows that touch or overlap, up to 12 h). */
export function mergeAdjacent(list: SchedLike[]): Merged[] {
  const groups = new Map<string, SchedLike[]>();
  for (const s of list) {
    const k = `${lineKey(s)}#${s.streamId}`;
    const g = groups.get(k);
    if (g) g.push(s); else groups.set(k, [s]);
  }
  const out: Merged[] = [];
  groups.forEach((g) => {
    const sorted = g
      .map((s) => ({ s, w: paddedWindow(s) }))
      .sort((a, b) => a.w.startMs - b.w.startMs || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
    let cur: Merged | null = null;
    for (const { s, w } of sorted) {
      if (cur && w.startMs <= cur.endMs && Math.max(cur.endMs, w.endMs) - cur.startMs <= MAX_RECORD_MS) {
        cur.endMs = Math.max(cur.endMs, w.endMs);
        cur.ids.push(s.id);
      } else {
        if (cur) out.push(cur);
        cur = { streamId: s.streamId, startMs: w.startMs, endMs: w.endMs, ids: [s.id] };
      }
    }
    if (cur) out.push(cur);
  });
  return out.sort((a, b) => a.startMs - b.startMs || (a.ids[0] < b.ids[0] ? -1 : 1));
}

/**
 * Would `candidate` make more than `cap` recordings run at once? Only
 * schedules still to run count, joined as they will be. The first moment
 * inside the candidate's job where the limit is passed, and how many others
 * are running then; null when it fits.
 */
export function scheduleConflict(existing: SchedLike[], candidate: SchedLike, cap: number): Conflict | null {
  const limit = Math.max(1, cap);
  const all = existing.filter((s) => isActive(s) && s.id !== candidate.id).concat(candidate);
  const merged = mergeAdjacent(all);
  const mine = merged.find((m) => m.ids.indexOf(candidate.id) >= 0);
  if (!mine) return null;
  const events: Array<[number, number]> = [];
  for (const m of merged) { events.push([m.startMs, 1], [m.endMs, -1]); }
  // Ends sort before starts at the same moment: one ending as the next begins is not a clash.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let running = 0;
  for (const [t, d] of events) {
    running += d;
    if (d > 0 && running > limit && t >= mine.startMs && t < mine.endMs) return { atMs: t, count: running - 1 };
  }
  return null;
}

export type FireKind = 'START' | 'START_LATE' | 'MISSED';

/** What an alarm at `now` should do for this programme (twin of ScheduleRules.planAtFire). */
export function planAtFire(s: Pick<SchedLike, 'startUtcMs' | 'endUtcMs' | 'padBeforeMin' | 'padAfterMin'>, now: number): FireKind {
  const w = paddedWindow(s);
  if (now >= w.endMs) return 'MISSED';
  if (now - w.startMs > LATE_SLACK_MS) return 'START_LATE';
  return 'START';
}

/** How many recordings the plan lets run at once (each is a stream); at most 2. */
export const recordingCap = (maxConnections: number | null | undefined): number => {
  const n = Math.floor(Number(maxConnections));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_SIMULTANEOUS_RECORDINGS, n) : MAX_SIMULTANEOUS_RECORDINGS;
};

/** "You already have 2 recordings at 20:00. Cancel one first." */
export const conflictMessage = (c: Conflict): string =>
  `You already have ${c.count} recording${c.count === 1 ? '' : 's'} at ${clockLabel(c.atMs)}. Cancel one first.`;

/** Recordings running now, as windows that never merge with anything (they hold a stream until they end). */
export function busyFromJobs(jobs: Array<{ id: string; startedAt: number; endsAt: number }>, now: number): SchedLike[] {
  return jobs.map((j, i) => ({
    id: `job:${j.id}`,
    streamId: -1 - i,
    startUtcMs: j.startedAt,
    endUtcMs: j.endsAt > now ? j.endsAt : now + MAX_RECORD_MS,
    padBeforeMin: 0,
    padAfterMin: 0,
    status: 'recording',
  }));
}

// ---- what the dialog shows ------------------------------------------------------

/** A programme to choose in the Guide's Record dialog (UTC ms). */
export interface ProgrammeChoice {
  title: string;
  startMs: number;
  endMs: number;
  /** Already scheduled (a red dot in the Guide). */
  scheduled?: boolean;
}

/** How many programmes the dialog lists. */
export const PROGRAMME_CHOICES = 6;

/**
 * The programmes to list: the first one that ends after the window's left edge
 * (and has not finished), then up to five more.
 */
export function programmeChoices(list: ProgrammeChoice[], windowStartMs: number, now: number): ProgrammeChoice[] {
  const left = Math.max(windowStartMs, now);
  return list
    .filter((p) => p.endMs > left)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, PROGRAMME_CHOICES);
}

/** Roughly 2.5 GB an hour of HD. */
export const EST_BYTES_PER_HOUR = 2.5 * 1024 * 1024 * 1024;
export const estimateBytes = (minutes: number): number => Math.round((Math.max(0, minutes) / 60) * EST_BYTES_PER_HOUR);

/** "1 h 07", "45 min". */
export function formatHm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)}`;
}

/** A recording stops before its drive has less than this free: 1 GB on the box, 200 MB on a USB drive (RecordingStore.kt). */
export const recordFloorBytes = (removable: boolean): number => (removable ? 200 * 1024 * 1024 : 1024 * 1024 * 1024);

/**
 * A warning when the chosen drive can't hold the recording: `freeBytes` is
 * what the drive has, `floorBytes` what a recording must leave free (1 GB on
 * the box, 200 MB on a USB drive). Null when it fits.
 */
export function spaceWarning(minutes: number, freeBytes: number, floorBytes: number): string | null {
  return estimateBytes(minutes) > Math.max(0, freeBytes - floorBytes)
    ? `Not enough free space for about ${formatHm(minutes)} (${formatBytes(Math.max(0, freeBytes - floorBytes))} usable).`
    : null;
}

/** Programme mode's start button: "19:58 → 21:05". */
export const paddedLabel = (startMs: number, endMs: number): string => `${clockLabel(startMs)} → ${clockLabel(endMs)}`;

/**
 * What choosing a programme does: the one on now records at once, until its
 * end plus the late padding (the Record-now path); a later one is scheduled;
 * one that is over can't be recorded.
 */
export type ProgrammeMode = 'now' | 'later' | 'over';
export function programmeMode(p: ProgrammeChoice, pad: RecordPadding, now: number): ProgrammeMode {
  const w = paddedWindow({ startUtcMs: p.startMs, endUtcMs: p.endMs, padBeforeMin: pad.beforeMin, padAfterMin: pad.afterMin });
  if (now >= w.endMs) return 'over';
  return now >= w.startMs ? 'now' : 'later';
}

/** Whole minutes a "record now until the programme's end" needs, at least 1 and at most 12 h. */
export const minutesUntil = (endMs: number, now: number): number =>
  Math.min(MAX_RECORD_MS / MIN, Math.max(1, Math.ceil((endMs - now) / MIN)));

// ---- the updater's warning ---------------------------------------------------------

/** A recording that starts within this long counts as "about to record". */
export const IMMINENT_MS = 30 * MIN;

/**
 * Installing an update ends the app's process, and a recording with it. The
 * sentence to show when one is running or a schedule starts within 30
 * minutes; null when nothing is at stake.
 */
export function updateGuardNote(
  jobs: unknown[],
  schedules: Array<Pick<SchedLike, 'startUtcMs' | 'endUtcMs' | 'padBeforeMin' | 'padAfterMin' | 'status'>>,
  now: number,
): string | null {
  if (jobs.length > 0) return 'A recording is running. Updating now will stop it.';
  const soon = schedules.some((s) => {
    if (s.status !== undefined && s.status !== 'scheduled') return false;
    const w = paddedWindow(s);
    return w.endMs > now && w.startMs <= now + IMMINENT_MS;
  });
  return soon ? 'A recording is scheduled to start soon. Updating now will stop it.' : null;
}

/**
 * The updater asks before it installs: the warning to show, or null when
 * nothing is recording or about to. Never throws (an older app has no recorder).
 */
export async function recordingGuardNote(now: number = Date.now()): Promise<string | null> {
  if (!hasRecorder()) return null;
  try {
    const [active, list] = await Promise.all([SnowRecorder.active(), SnowRecorder.listSchedules()]);
    return updateGuardNote(active.jobs, list.schedules, now);
  } catch {
    return null;
  }
}
