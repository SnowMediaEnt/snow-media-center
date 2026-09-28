// JS bridge for recording live channels (com.snowmedia.dvr.RecorderPlugin).
// The recording runs in an Android foreground service with its own
// connection; files go to the app's folder on the box or on a USB drive.
import { registerPlugin, Capacitor } from '@capacitor/core';

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
