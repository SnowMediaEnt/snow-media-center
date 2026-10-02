// Rewind live TV (TRACKER 25): the viewer's settings, the rules shared with
// the native buffer (android/.../dvr), and the panel catch-up address.
//
// Two ways to go back in time on a live channel:
// - Panel catch-up: the channel says the provider keeps an archive
//   (tv_archive = 1, tv_archive_duration = days). Rewinding then plays the
//   panel's timeshift address: nothing is stored on the box.
// - The on-box buffer: every other channel. While a channel plays full
//   screen, a second connection writes it to the app's cache (disk only,
//   never RAM) up to a safety limit, and the player moves onto that copy to
//   pause or rewind. It is wiped when the viewer leaves the player, presses
//   Home, closes the app or signs out. It is a second stream on the line, so
//   it runs only while the panel says a stream is free (see LineUsage below),
//   and gives the stream back when another device needs it.
//
// Stream addresses carry the line's username and password: nothing here logs
// one, and nothing may.
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import type { TimeshiftStatus } from '@/capacitor/SnowPlayer';
import i18n from '@/i18n';

export type MaxRewind = 'auto' | 10 | 30 | 60;

export interface RewindSettings {
  /** "Rewind live TV" on/off. Default on. */
  enabled: boolean;
  /** "Max rewind": Auto (as much as the disk allows) or a number of minutes. */
  maxRewind: MaxRewind;
}

export const REWIND_SETTINGS_KEY = 'smc-live-rewind-v1';
/** Fired (on window) when the settings change. */
export const REWIND_SETTINGS_EVENT = 'smc-live-rewind:changed';

export const DEFAULT_REWIND_SETTINGS: RewindSettings = { enabled: true, maxRewind: 'auto' };
// `label` is the English fallback; RewindSettingsScreen shows the translated name by id.
export const MAX_REWIND_CHOICES: Array<{ id: MaxRewind; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 10, label: '10 min' },
  { id: 30, label: '30 min' },
  { id: 60, label: '60 min' },
];

export function loadRewindSettings(): RewindSettings {
  try {
    const raw = localStorage.getItem(REWIND_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_REWIND_SETTINGS };
    const o = JSON.parse(raw) as Partial<RewindSettings>;
    const max = MAX_REWIND_CHOICES.some((c) => c.id === o.maxRewind) ? (o.maxRewind as MaxRewind) : 'auto';
    return { enabled: o.enabled !== false, maxRewind: max };
  } catch {
    return { ...DEFAULT_REWIND_SETTINGS };
  }
}

export function saveRewindSettings(s: RewindSettings): void {
  try { localStorage.setItem(REWIND_SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  try { window.dispatchEvent(new CustomEvent(REWIND_SETTINGS_EVENT)); } catch { /* no window */ }
}

/** Minutes for the native buffer; 0 = Auto (disk only). */
export function maxRewindMinutes(m: MaxRewind): number {
  return m === 'auto' ? 0 : m;
}

// ---- disk budget (same math as StorageBudget.kt) ----------------------------

const GIB = 1024 * 1024 * 1024;
/** The box always keeps at least this much free… */
export const MIN_FREE_BYTES = GIB;
/** …or this share of the volume, whichever is more. */
export const MIN_FREE_PERCENT = 15;
/** And the buffer never takes more than this, even on a big, empty drive. */
export const HARD_CAP_BYTES = 4 * GIB;
export const HARD_CAP_MB = HARD_CAP_BYTES / (1024 * 1024);

/** What must stay free on a volume of `totalBytes`. */
export function reserveBytes(totalBytes: number): number {
  return Math.max(MIN_FREE_BYTES, Math.floor(totalBytes / 100) * MIN_FREE_PERCENT);
}

/**
 * How many bytes the rewind buffer may hold. `usedBytes` is what it holds
 * already (that space is its own to reuse). Never negative.
 */
export function rewindBudgetBytes(a: { freeBytes: number; totalBytes: number; usedBytes: number; hardCapBytes?: number }): number {
  const cap = a.hardCapBytes ?? HARD_CAP_BYTES;
  return Math.max(0, Math.min(cap, a.usedBytes + a.freeBytes - reserveBytes(a.totalBytes)));
}

// ---- panel catch-up ----------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Days of archive the panel keeps for this channel; 0 = none. */
export function catchupDays(st: Pick<XtreamLiveStream, 'tv_archive' | 'tv_archive_duration'> | null | undefined): number {
  if (!st) return 0;
  if (num(st.tv_archive) !== 1) return 0;
  return Math.max(0, num(st.tv_archive_duration));
}

export const hasCatchup = (st: Pick<XtreamLiveStream, 'tv_archive' | 'tv_archive_duration'> | null | undefined): boolean =>
  catchupDays(st) > 0;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * The panel's clock: minutes it is ahead of UTC, from the server_info of a
 * player_api.php answer (time_now is the panel's local time, timestamp_now
 * the real moment). Null when the answer doesn't say.
 */
export function serverUtcOffsetMinutes(serverInfo: { time_now?: unknown; timestamp_now?: unknown } | null | undefined): number | null {
  if (!serverInfo) return null;
  const ts = num(serverInfo.timestamp_now);
  const m = typeof serverInfo.time_now === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(serverInfo.time_now)
    : null;
  if (!ts || !m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000;
  // Offsets come in quarter hours.
  return Math.round((asUtc - ts) / 900) * 15;
}

/** The box's own offset from UTC in minutes (the fallback when the panel doesn't say). */
export const deviceUtcOffsetMinutes = (atMs: number = Date.now()): number => -new Date(atMs).getTimezoneOffset();

/** "YYYY-MM-DD:HH-MM" in the panel's time, as the timeshift address wants it. */
export function timeshiftStamp(startMs: number, utcOffsetMin: number): string {
  const d = new Date(startMs + utcOffsetMin * 60_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}:${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}`;
}

/** Start of the minute `ms` falls in (the timeshift address is minute-precise). */
export const floorMinute = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

/**
 * The panel's standard Xtream timeshift address:
 * {host}/timeshift/{user}/{pass}/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.ts
 * Built like every other stream address (buildLiveStreamUrl): credentials
 * URI-encoded, never logged. Starts at the minute `startMs` falls in.
 */
export function buildTimeshiftUrl(
  c: Pick<XtreamCreds, 'host' | 'username' | 'password'>,
  streamId: number,
  startMs: number,
  durationMin: number,
  utcOffsetMin: number,
): string {
  const host = c.host.replace(/\/+$/, '');
  const minutes = Math.max(1, Math.ceil(durationMin));
  return `${host}/timeshift/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${minutes}/${timeshiftStamp(floorMinute(startMs), utcOffsetMin)}/${streamId}.ts`;
}

/**
 * How long to ask the archive for, from `startMs`: up to now, plus a little
 * (the archive ends where the recording does; asking past it is harmless).
 */
export function catchupDurationMin(startMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((nowMs - floorMinute(startMs)) / 60_000) + 5);
}

// ---- labels ------------------------------------------------------------------

/** "12:30", "1:02:05" (h:mm:ss past an hour). */
export function formatSpan(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** "-12:30 available", or "up to 3 days" for an archive. */
export function availableLabel(sec: number, archiveDays = 0): string {
  if (archiveDays > 0) return i18n.t('recordings.rewind.catchupUpTo', { count: archiveDays });
  return sec >= 1 ? i18n.t('recordings.rewind.available', { span: formatSpan(sec) }) : i18n.t('recordings.rewind.gettingReady');
}

/** Where the viewer is: "LIVE" or "-0:45". */
export const behindLabel = (behindSec: number): string => (behindSec >= 1 ? `-${formatSpan(behindSec)}` : i18n.t('recordings.rewind.liveLabel'));

/** "1.2 GB", "350 MB". */
export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 MB';
  if (b >= GIB) return `${(b / GIB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(b / (1024 * 1024)))} MB`;
}

/** Which buffer belongs to which channel (no credentials in it). */
export const rewindChannelKey = (host: string, streamId: number): string => `${host.replace(/\/+$/, '')}|${streamId}`;

// ---- why rewind is off, and what to tell the viewer --------------------------

/** Why rewind is off for the channel on screen (null when it is on, or nothing plays). */
export type RewindOffReason =
  /** Switched off in Settings. */
  | 'disabled'
  /** The channel plays on mpv (owner test builds): rewind is ExoPlayer only. */
  | 'engine'
  /** The iPhone build: no on-box buffer, so only catch-up channels rewind. */
  | 'device'
  /** The plan allows one stream, so the buffer's second stream is not opened. */
  | 'streams'
  /** How many streams the plan allows is not known (another saved line). */
  | 'streams-unknown'
  /** Recordings are using the streams the buffer would need. */
  | 'recording'
  /** Asking the panel whether a stream is free (a few seconds after a channel opens). */
  | 'line-checking'
  /** The panel says every stream of the line is in use, so the buffer did not start. */
  | 'line-full'
  /** The panel could not be asked (or did not say), so the buffer did not start. */
  | 'line-unknown'
  /** The buffer was running and gave its stream back: another device needed it. */
  | 'line-taken';

/**
 * The toast when the buffer gives its stream back mid-watch. This constant is the English
 * text (the tests compare against it); the app shows i18n 'recordings.rewind.off.lineTaken'.
 */
export const LINE_TAKEN_MESSAGE = 'Rewind turned off: another device is using your line\'s streams.';

/** What to tell the viewer who asks for rewind while it is off. */
export function rewindOffMessage(reason: RewindOffReason | null): string {
  switch (reason) {
    case 'streams': return i18n.t('recordings.rewind.off.streams');
    case 'streams-unknown': return i18n.t('recordings.rewind.off.streamsUnknown');
    case 'recording': return i18n.t('recordings.rewind.off.recording');
    case 'engine': return i18n.t('recordings.rewind.off.engine');
    case 'device': return i18n.t('recordings.rewind.off.device');
    case 'line-checking': return i18n.t('recordings.rewind.off.lineChecking');
    case 'line-full': return i18n.t('recordings.rewind.off.lineFull');
    case 'line-unknown': return i18n.t('recordings.rewind.off.lineUnknown');
    case 'line-taken': return i18n.t('recordings.rewind.off.lineTaken');
    default: return i18n.t('recordings.rewind.off.disabled');
  }
}

// ---- is a stream free on the line right now? ----------------------------------
//
// The buffer is one more connection to the line. It runs only while the panel
// itself says a stream is free, so it never takes the stream another TV in the
// house needs. The panel's numbers come from the Xtream player_api.php
// user_info (the same read the account screens use, ISP-block proxy fallback
// included): `max_connections` and `active_cons`.
//
// ASSUMPTION (active_cons): the panel counts every connection it has open on
// the line right now, and that already includes THIS box's own playing
// stream (the picture on screen) and, once it runs, the buffer's own capture
// and any recording of this box. So before the buffer starts, a stream is
// free when max_connections - active_cons >= 1. A reading of 0 while a
// channel plays contradicts that (the panel isn't counting us, or the read is
// stale), so it is not trusted either. Panels count with a small lag, so a
// reading can briefly be one too high after a channel change: that only
// delays the buffer (retry rules in useLiveRewind), never opens an extra stream.

/** How often the running buffer asks the panel again, at most. */
export const LINE_RECHECK_MS = 60_000;
/** After the buffer was refused or gave up: the next try, unless the channel changes first. */
export const LINE_RETRY_MS = 5 * 60_000;
/** A channel must stay open this long before the panel is asked (zapping doesn't ask per channel). */
export const LINE_CHECK_SETTLE_MS = 4_000;

/** What the panel says about the line. */
export interface LineUsage { max: number; active: number }

const wholeOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

/**
 * `max_connections` and `active_cons` from a player_api.php answer. Null when
 * either is missing or not a number: the line's use is then unknown.
 */
export function parseLineUsage(answer: unknown): LineUsage | null {
  const ui = (answer as { user_info?: { max_connections?: unknown; active_cons?: unknown } } | null | undefined)?.user_info;
  if (!ui || typeof ui !== 'object') return null;
  const max = wholeOrNull(ui.max_connections);
  const active = wholeOrNull(ui.active_cons);
  return max == null || active == null ? null : { max, active };
}

/**
 * While the buffer runs, has another device joined the line and left no free
 * stream? `ownStreams` is what this box uses (picture + the buffer's capture +
 * its recordings); `othersAtStart` is what the other devices used when the
 * buffer started. The panel's count includes the buffer itself, so on a
 * two-stream line "active >= max" is always true while it runs; only a
 * connection beyond ours counts as somebody else needing the line.
 */
export function lineTakenByOthers(usage: LineUsage, ownStreams: number, othersAtStart: number): boolean {
  return usage.active >= usage.max && usage.active - ownStreams > othersAtStart;
}

/**
 * The native capture says the provider refused it or dropped it for good
 * (TimeshiftSession: the connection failed again and again, whatever the HTTP
 * status was). Disk problems say something else and are not this.
 */
export function captureRefused(st: Pick<TimeshiftStatus, 'state' | 'reason'> | null | undefined): boolean {
  return !!st && st.state === 'unavailable' && /stopped sending/i.test(st.reason ?? '');
}
