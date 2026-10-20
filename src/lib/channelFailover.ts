/**
 * "When a channel is down, play it from my other service": what Live TV's
 * failover (components/livetv/useChannelFailover) keeps on the box. Light on
 * purpose: the settings page reads it without loading Live TV's code.
 */
import { readBool, writeBool } from '@/lib/playerFlags';

// ---- the setting (Player Settings › Playback), per box --------------------
// Kept like the page's other switches (lib/playerFlags): '1' / '0'.

const FAILOVER_KEY = 'smc-live-failover-v1';

/** On unless the viewer turned it off. */
export const loadFailoverOn = (): boolean => readBool(FAILOVER_KEY, true);
export const saveFailoverOn = (on: boolean): void => writeBool(FAILOVER_KEY, on);

// ---- how many lines Live TV shows -----------------------------------------
// The setting is only offered with more than one line. Live TV knows its
// lines (every saved account, and any other source it lists), the settings
// page does not: Live TV leaves the number here.

const LINE_COUNT_KEY = 'smc-live-line-count-v1';

export function noteLiveLineCount(n: number): void {
  try { localStorage.setItem(LINE_COUNT_KEY, String(Math.max(0, Math.floor(n)))); } catch { /* ignore */ }
}

export function readLiveLineCount(): number {
  try { return Number(localStorage.getItem(LINE_COUNT_KEY)) || 0; } catch { return 0; }
}
