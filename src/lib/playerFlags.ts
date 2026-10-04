// The native player's remote kill switches (public.feature_flags) and the
// viewer's own player settings that go with every load() (SnowPlayer.load's
// options). The flags are kept fresh by usePlayerFlagSync (one read and one
// realtime channel for all of them, mounted once in the app shell) and read
// here synchronously from the cache, so every player — Live TV, Plex, VOD,
// Originals, Backups, Recordings — sends the same thing without each one
// opening its own subscription. A missing row means the flag's default.
import { readCachedFlag } from '@/lib/featureFlagCache';
import type { SnowPlayerLoadOpts } from '@/capacitor/SnowPlayer';

/** Frame-rate matching (FrameRateMatch.kt). Missing row: on. */
export const MATCH_FRAME_RATE_FLAG = 'match_frame_rate';

/** Every player flag and its default (what a missing row means). */
export const PLAYER_FLAG_DEFAULTS: Record<string, boolean> = {
  [MATCH_FRAME_RATE_FLAG]: true,
};

export const PLAYER_FLAG_KEYS = Object.keys(PLAYER_FLAG_DEFAULTS);

export function playerFlag(key: string): boolean {
  return readCachedFlag(key, PLAYER_FLAG_DEFAULTS[key] ?? true);
}

// ---- the viewer's settings (Player Settings › Playback), per box ----------

/** "Match frame rate": on unless the viewer turned it off. */
export const MATCH_FRAME_RATE_KEY = 'smc-match-frame-rate-v1';
/** Sent when a player setting changes, so a mounted screen re-reads it. */
export const PLAYER_SETTINGS_EVENT = 'smc:player-settings-changed';

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

function writeBool(key: string, value: boolean): void {
  try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(PLAYER_SETTINGS_EVENT)); } catch { /* ignore */ }
}

export const loadMatchFrameRate = (): boolean => readBool(MATCH_FRAME_RATE_KEY, true);
export const saveMatchFrameRate = (on: boolean): void => writeBool(MATCH_FRAME_RATE_KEY, on);

/**
 * What every load() of the main player adds to its options. `frameRate` is
 * the film's rate when the caller knows it (Plex's metadata). Nothing here
 * for a live stream that it does not need: matching never applies there.
 */
export function nativeLoadExtras(live: boolean, frameRate?: number): Partial<SnowPlayerLoadOpts> {
  const out: Partial<SnowPlayerLoadOpts> = {};
  if (!live && loadMatchFrameRate() && playerFlag(MATCH_FRAME_RATE_FLAG)) {
    out.matchFrameRate = true;
    if (typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0) out.frameRate = frameRate;
  }
  return out;
}
