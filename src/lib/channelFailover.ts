/**
 * "When a channel is down, play it from my other service": what Live TV's
 * failover (components/livetv/useChannelFailover) keeps on the box. Light on
 * purpose: the settings page reads it without loading Live TV's code.
 */
import { PLAYER_SETTINGS_EVENT } from '@/lib/playerFlags';

// ---- the setting (Player Settings › Playback), per box --------------------

const FAILOVER_KEY = 'smc-live-failover-v1';

/** On unless the viewer turned it off. */
export function loadFailoverOn(): boolean {
  try { return localStorage.getItem(FAILOVER_KEY) !== '0'; } catch { return true; }
}

export function saveFailoverOn(on: boolean): void {
  try { localStorage.setItem(FAILOVER_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(PLAYER_SETTINGS_EVENT)); } catch { /* ignore */ }
}

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
