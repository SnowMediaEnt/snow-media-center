// JS bridge for recording live channels (com.snowmedia.dvr.RecorderPlugin).
// The recording runs in an Android foreground service with its own
// connection; files go to the app's folder on the box or on a USB drive.
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface RecordVolume {
  /** "box" for the box itself, the volume's id for a USB drive / SD card. */
  id: string;
  label: string;
  removable: boolean;
  freeBytes: number;
  totalBytes: number;
}

export interface RecordingJob {
  id: string;
  channel: string;
  name: string;
  startedAt: number;
  /** 0 = until stopped. */
  endsAt: number;
  bytes: number;
}

export interface RecordingItem {
  /** A recording that ran past 3.9 GB on a USB drive carries on in "(part 2)": each part has its own id. */
  id: string;
  /** File name without ".ts". */
  name: string;
  channel: string;
  path: string;
  /** file:// address for the native player. */
  playUrl: string;
  bytes: number;
  startedAt: number;
  durationSec: number;
  /** Still being recorded. */
  recording: boolean;
  volumeId: string;
  volumeLabel: string;
}

/** The error codes `start` rejects with (err.code), besides a plain message. */
export type RecordStartError = 'TOO_MANY' | 'NO_SPACE';

export type ScheduleStatus = 'scheduled' | 'recording' | 'done' | 'missed' | 'failed';

/**
 * One scheduled programme (a recording set for later). It holds names, times
 * and ids only: never the stream address, user name or password (the native
 * scheduler rebuilds the address at start time from the saved Player login).
 */
export interface RecordSchedule {
  id: string;
  streamId: number;
  channelName: string;
  programmeTitle: string;
  /** The programme's true UTC start and end, ms. */
  startUtcMs: number;
  endUtcMs: number;
  /** The padding it was made with (a later change of the setting does not move it). */
  padBeforeMin: number;
  padAfterMin: number;
  volumeId: string;
  status: ScheduleStatus;
  /** Why it was missed or failed, in plain words. */
  reason?: string;
  /** The recording carrying it out, once started. */
  recordingId?: string;
  finishedAtMs: number;
}

/** The error codes `schedule` rejects with (err.code); `data` has `atMs` and `count` for CONFLICT. */
export type ScheduleError = 'CONFLICT' | 'NO_LOGIN' | 'OTHER_LINE' | 'OVER';

export interface SnowRecorderPlugin {
  getVolumes(): Promise<{ volumes: RecordVolume[] }>;
  /**
   * The URL carries the line's credentials: it goes to the service only and
   * is never logged.
   *
   * `maxSimultaneous`: how many recordings the line allows at once, at most
   * 2 (each recording is one more stream). Past it the call rejects with code
   * 'TOO_MANY', a plain-words message and `data.maxSimultaneous`. Omitted: 2.
   * A drive with too little room rejects with code 'NO_SPACE'.
   */
  start(opts: {
    url: string; channel: string; fileName: string; volumeId: string; durationMin: number; maxSimultaneous?: number;
  }): Promise<{ id: string; name: string; volumeLabel: string }>;
  stop(opts?: { id?: string }): Promise<void>;
  active(): Promise<{ jobs: RecordingJob[] }>;
  list(): Promise<{ recordings: RecordingItem[]; volumes: RecordVolume[] }>;
  rename(opts: { path: string; name: string }): Promise<{ path: string; name: string; playUrl: string }>;
  remove(opts: { path: string }): Promise<void>;
  /**
   * Set a programme to record later. `host` must be the line the Player is
   * signed in to (the native side checks it against the saved login and keeps
   * only a short hash of the account). The address is NOT sent: it is rebuilt
   * at start time. Rejects with code CONFLICT (more recordings than the plan
   * allows at that time), NO_LOGIN, OTHER_LINE or OVER (already finished).
   * `exact` is false when the box only allows inexact alarms (it then starts
   * about five minutes early).
   */
  schedule(opts: {
    streamId: number; host: string; channel: string; title: string;
    startUtcMs: number; endUtcMs: number; padBeforeMin: number; padAfterMin: number;
    volumeId: string; maxConnections?: number | null;
  }): Promise<{ id: string; exact: boolean }>;
  /** Cancel one schedule (or dismiss a missed / failed one); no id = every schedule (sign-out). */
  cancelSchedule(opts?: { id?: string }): Promise<void>;
  listSchedules(): Promise<{ schedules: RecordSchedule[] }>;
  /** Can this box set exact alarms, and is there a settings page to allow them (Android 12)? */
  exactAlarmStatus(): Promise<{ canExact: boolean; canOpenSettings: boolean }>;
  openExactAlarmSettings(): Promise<void>;
  /** 'recordingsChanged': a recording or schedule started, ended or changed on the native side. */
  addListener(eventName: 'recordingsChanged', listener: () => void): Promise<PluginListenerHandle>;
}

const unavailable = async (): Promise<never> => { throw new Error('Recording needs the Snow Media Center app on a TV box.'); };

const webFallback: SnowRecorderPlugin = {
  async getVolumes() { return { volumes: [] }; },
  start: unavailable,
  async stop() {},
  async active() { return { jobs: [] }; },
  async list() { return { recordings: [], volumes: [] }; },
  rename: unavailable,
  remove: unavailable,
  schedule: unavailable,
  async cancelSchedule() {},
  async listSchedules() { return { schedules: [] }; },
  async exactAlarmStatus() { return { canExact: true, canOpenSettings: false }; },
  async openExactAlarmSettings() {},
  async addListener() { return { remove: async () => {} }; },
};

export const SnowRecorder = registerPlugin<SnowRecorderPlugin>('SnowRecorder', { web: webFallback });

/** Recording is possible here (native app with the plugin: builds before it have none). */
export function hasRecorder(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SnowRecorder');
}

/** Fired (on window) after a recording starts, stops, is renamed or deleted. */
export const RECORDINGS_CHANGED_EVENT = 'smc-recordings:changed';
export const notifyRecordingsChanged = (): void => {
  try { window.dispatchEvent(new CustomEvent(RECORDINGS_CHANGED_EVENT)); } catch { /* no window */ }
};

// The native side says when a recording starts or ends by itself (a scheduled
// start, a full drive): pass it on to every screen that lists recordings.
// Older builds have no such plugin; the web never does.
if (Capacitor.isNativePlatform()) {
  try {
    void SnowRecorder.addListener('recordingsChanged', notifyRecordingsChanged).catch(() => { /* older app */ });
  } catch { /* older app */ }
}
