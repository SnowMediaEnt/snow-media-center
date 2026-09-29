// Recording live channels (TRACKER 25): names, lengths and space warnings.
// The recording itself is native (RecorderPlugin / RecordingService).

import { SnowPlayer } from '@/capacitor/SnowPlayer';
import i18n from '@/i18n';

/**
 * The Record dialog's lengths, minutes; 0 = until I stop it. `label` is the English fallback;
 * the dialog shows the translated name by id (recordings.dialog.duration.<id>).
 */
export const RECORD_DURATIONS: Array<{ id: string; label: string; minutes: number }> = [
  { id: '30', label: '30 min', minutes: 30 },
  { id: '60', label: '1 hour', minutes: 60 },
  { id: '120', label: '2 hours', minutes: 120 },
  { id: '180', label: '3 hours', minutes: 180 },
  { id: 'custom', label: 'Custom', minutes: -1 },
  { id: 'open', label: 'Until I stop it', minutes: 0 },
];

/** Custom length: ◀ ▶ in 15-minute steps, 15 min to 12 h. */
export const CUSTOM_STEP_MIN = 15;
export const CUSTOM_MIN = 15;
export const CUSTOM_MAX = 12 * 60;
export const CUSTOM_DEFAULT = 90;

export function stepCustom(minutes: number, dir: 1 | -1): number {
  return Math.min(CUSTOM_MAX, Math.max(CUSTOM_MIN, minutes + dir * CUSTOM_STEP_MIN));
}

/** "1 h 30 min", "45 min", "2 h". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return i18n.t('recordings.units.min', { n: m });
  return m === 0 ? i18n.t('recordings.units.hour', { n: h }) : i18n.t('recordings.units.hourMin', { h, m });
}

/** Free space below this gets a warning in the dialog and the list. */
export const LOW_SPACE_BYTES = 2 * 1024 * 1024 * 1024;
export const isLowSpace = (freeBytes: number): boolean => freeBytes < LOW_SPACE_BYTES;

/** Two recordings at once, no more (the box and the line are shared). Same number as RecordingService.MAX_SIMULTANEOUS. */
export const MAX_SIMULTANEOUS_RECORDINGS = 2;

/**
 * A recording is a second connection to the line while the viewer may be
 * watching on the first. Said plainly on every start (the dialog, the toast,
 * the error when the provider refuses). `maxConnections` is what the plan
 * allows; unknown or missing leaves the number out.
 */
export function extraStreamNote(maxConnections: number | null | undefined): string {
  const n = Math.floor(Number(maxConnections));
  return Number.isFinite(n) && n >= 1
    ? i18n.t('recordings.note.extraStreamPlan', { count: n })
    : i18n.t('recordings.note.extraStream');
}

/** A plan with this many streams holds the picture, the rewind buffer and a recording at once. */
export const STREAMS_FOR_REWIND_AND_RECORDING = 4;

/** Said after a recording starts and the rewind buffer had to give way (in the app's language). */
export const rewindPausedNote = (): string => i18n.t('recordings.note.rewindPaused');
/**
 * Older call sites put this constant straight into a template string. It turns into the
 * translated text at that moment (toString), so they keep working and follow the language.
 */
export const REWIND_PAUSED_NOTE = { toString: rewindPausedNote };

/**
 * Before a recording opens its connection: drop the rewind buffer unless the
 * plan (4+ streams) has room for picture + buffer + recording. Without this the
 * buffer keeps its stream until the screen notices the recording, and the line
 * briefly needs one more than it allows. True when a running buffer was wiped
 * (the caller says so); false when there was none, or the plan has room, or the
 * app is too old to have one.
 */
export async function pauseRewindForRecording(maxConnections: number | null | undefined): Promise<boolean> {
  const n = Math.floor(Number(maxConnections));
  if (Number.isFinite(n) && n >= STREAMS_FOR_REWIND_AND_RECORDING) return false;
  try {
    const st = await SnowPlayer.timeshiftStatus();
    if (st.state === 'off') return false;
    await SnowPlayer.timeshiftWipe();
    return true;
  } catch {
    return false;
  }
}

/** The slice of a list to draw so the focused row stays in view. */
export function listWindow(length: number, focus: number, size: number): { start: number; end: number } {
  if (length <= size) return { start: 0, end: length };
  const half = Math.floor(size / 2);
  const start = Math.max(0, Math.min(length - size, focus - half));
  return { start, end: start + size };
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

/**
 * A channel name made safe for any drive (FAT USB sticks included): no
 * / \ : * ? " < > | # %, no control characters, no leading/trailing dots.
 */
export function safeFilePart(s: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '');
  return cleaned.slice(0, 80).trim() || 'Channel';
}

/** "<Channel> – 2026-09-28 20.15.ts" (no colon: USB drives refuse it). */
export function recordingFileName(channel: string, at: Date = new Date()): string {
  const stamp = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${pad2(at.getHours())}.${pad2(at.getMinutes())}`;
  return `${safeFilePart(channel)} – ${stamp}.ts`;
}

/** A new name typed by the viewer: cleaned, ".ts" left to the file. */
export function cleanRename(name: string): string {
  const base = name.replace(/\.ts$/i, '');
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120).trim();
}

/** "1:05:30" or "12:04" for a length in seconds. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** When a recording of `minutes` started now ends, "21:45"; null for until stopped. */
export function endsAtLabel(minutes: number, now: Date = new Date()): string | null {
  if (minutes <= 0) return null;
  const end = new Date(now.getTime() + minutes * 60_000);
  return `${pad2(end.getHours())}:${pad2(end.getMinutes())}`;
}
