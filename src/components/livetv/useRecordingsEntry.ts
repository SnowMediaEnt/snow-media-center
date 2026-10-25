// Live TV › Recordings in the far-left menu (between Game Day and VOD): shown
// once there is something to list (a recording, or a schedule set for later
// or missed), on a box that can record (the native app with the recorder
// plugin, never the demo, never a Kids profile). The How-to pictures always
// show it, as a real box with recordings does.
import { useCallback, useEffect, useState } from 'react';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { SnowRecorder, RECORDINGS_CHANGED_EVENT, hasRecorder } from '@/capacitor/SnowRecorder';
import { isDemo, isHowtoCapture } from '@/lib/demoMode';
import { kidsLevel } from '@/lib/kidsFilter';

export interface RecordingsEntry {
  /** The menu entry is drawn. */
  show: boolean;
  /** Something is recording right now (a red dot on the entry). */
  recordingNow: boolean;
  /** The box can record here at all (the screen may be opened, e.g. by the assistant, before the list has answered). */
  capable: boolean;
}

/** `enabled`: Live TV's menu is up (the Player in Live TV mode). */
export function useRecordingsEntry(enabled: boolean): RecordingsEntry {
  const capable = hasNativePlayer() && !isDemo() && hasRecorder() && !kidsLevel();
  const on = enabled && capable;
  const [hasItems, setHasItems] = useState(false);
  const [hasSchedules, setHasSchedules] = useState(false);
  const [recordingNow, setRecordingNow] = useState(false);
  const refresh = useCallback(() => {
    SnowRecorder.list().then((r) => setHasItems(r.recordings.length > 0)).catch(() => { /* older app */ });
    SnowRecorder.listSchedules().then((r) => setHasSchedules(r.schedules.length > 0)).catch(() => { /* older app */ });
    SnowRecorder.active().then((r) => setRecordingNow(r.jobs.length > 0)).catch(() => { /* older app */ });
  }, []);
  // The screens fire RECORDINGS_CHANGED_EVENT after a start, stop, rename or
  // delete, and the native side's own event (a scheduled start, a recording
  // that ended) lands as the same event (SnowRecorder.ts).
  useEffect(() => {
    if (!on) return;
    refresh();
    window.addEventListener(RECORDINGS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(RECORDINGS_CHANGED_EVENT, refresh);
  }, [on, refresh]);
  return {
    show: (on && (hasItems || hasSchedules)) || (enabled && isHowtoCapture()),
    recordingNow: on && recordingNow,
    capable: capable || isHowtoCapture(),
  };
}
