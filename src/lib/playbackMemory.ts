// Free memory for playback. On a 2 GB Fire TV, apps the viewer opened earlier
// (the Plex app alone held 305 MB on the owner's box, plus Tubi, Silk, a VPN
// app…) stay in memory in the background. Once the box runs out, Android
// starts killing processes every few seconds and playback freezes for 15–35 s
// at a time, even with fast internet (Fire TV monitoring, 2026-10-06: four
// freezes in three minutes at ~250 MB free; none in 18 minutes at ~530 MB).
//
// Before a stream starts, and every few minutes while it plays, this checks
// the box's free memory. When it is low, SMC asks Android to close the
// background apps (AppManager.closeBackgroundApps: the normal-permission
// killBackgroundProcesses, which never touches SMC itself, a foreground app or
// a protected service) and says how much it freed. TV boxes only; nothing on
// the web or on a box that can't be asked.
import { AppManager } from '@/capacitor/AppManager';
import { isNativePlatform } from '@/utils/platform';

/** Below this much free memory (bytes), background apps are closed. */
export const LOW_FREE_MEMORY_BYTES = 450 * 1024 * 1024;
/** Never more often than this (a check right after a channel change is skipped). */
export const MIN_INTERVAL_MS = 3 * 60 * 1000;
/** While a stream plays, memory is checked this often. */
export const WATCH_INTERVAL_MS = 4 * 60 * 1000;
/** A toast only when it made a real difference. */
const TOAST_MIN_FREED_BYTES = 40 * 1024 * 1024;

let lastRunAt = 0;
let running: Promise<FreedResult | null> | null = null;

export interface FreedResult {
  freedBytes: number;
  freeBytes: number;
}

type Notify = (freedMb: number) => void;
let notify: Notify | null = null;
/** The app's toast (set once by the shell, so this module needs no UI). */
export function setFreedMemoryNotifier(fn: Notify | null): void { notify = fn; }

/**
 * Checks free memory and, when it is low, closes background apps.
 * Resolves with what was freed, or null when nothing was done. Never throws
 * and never delays playback (callers don't await it).
 */
export function freeMemoryForPlayback(now = Date.now()): Promise<FreedResult | null> {
  if (!isNativePlatform()) return Promise.resolve(null);
  if (running) return running;
  if (now - lastRunAt < MIN_INTERVAL_MS) return Promise.resolve(null);
  lastRunAt = now;
  running = (async () => {
    try {
      const info = await AppManager.getStorageInfo();
      const free = Number(info?.freeMemoryBytes) || 0;
      if (!info?.lowMemory && (free <= 0 || free >= LOW_FREE_MEMORY_BYTES)) return null;
      const res = await AppManager.closeBackgroundApps();
      const freed = Math.max(0, Number(res?.freedMemoryBytes) || 0);
      if (freed >= TOAST_MIN_FREED_BYTES) {
        try { notify?.(Math.round(freed / (1024 * 1024))); } catch { /* ignore */ }
      }
      return { freedBytes: freed, freeBytes: Number(res?.freeMemoryBytes) || 0 };
    } catch {
      return null;
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Tests only. */
export function __resetPlaybackMemoryForTests(): void { lastRunAt = 0; running = null; notify = null; }
