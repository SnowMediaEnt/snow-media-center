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

/** The main player draws on a SurfaceView (smooth 4K, HDR passed through);
 *  off falls back to the TextureView. Missing row: on. */
export const SURFACE_VIEW_FLAG = 'video_surface_view';
/** MediaCodec's asynchronous queueing forced on API 28-30 boxes, an A/B
 *  switch: Fire TVs already get it from Media3 itself (Amazon's TV feature
 *  check), and Media3 calls it reliable elsewhere only on API 31+.
 *  Missing row: OFF. */
export const ASYNC_CODEC_FLAG = 'async_codec';
/** Tunneled playback for films, for an A/B test on the owner's box.
 *  Missing row: OFF. */
export const TUNNELED_VOD_FLAG = 'tunneled_vod';

/** Films get the box's hardware audio (or passthrough) first, FFmpeg as the
 *  fallback; off puts FFmpeg first everywhere, as before. Missing row: on. */
export const AUDIO_HW_FIRST_FLAG = 'audio_hw_first';

/** Every player flag and its default (what a missing row means). */
export const PLAYER_FLAG_DEFAULTS: Record<string, boolean> = {
  [MATCH_FRAME_RATE_FLAG]: true,
  [SURFACE_VIEW_FLAG]: true,
  [ASYNC_CODEC_FLAG]: false,
  [TUNNELED_VOD_FLAG]: false,
  [AUDIO_HW_FIRST_FLAG]: true,
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

/** "Decode audio on this box": off unless the viewer turns it on. The way
 *  out for a TV or receiver that takes the Dolby / DTS bitstream and plays
 *  no sound: every track is then decoded here (FFmpeg first), as before. */
export const DECODE_AUDIO_KEY = 'smc-decode-audio-on-box-v1';
export const loadDecodeAudioOnBox = (): boolean => readBool(DECODE_AUDIO_KEY, false);
export const saveDecodeAudioOnBox = (on: boolean): void => writeBool(DECODE_AUDIO_KEY, on);

/**
 * What every load() of the main player adds to its options. `frameRate` is
 * the film's rate when the caller knows it (Plex's metadata). How the main
 * player draws and decodes goes with every load (the native side applies it
 * to the main slot only); film-only options never go with a live stream.
 */
export function nativeLoadExtras(live: boolean, frameRate?: number): Partial<SnowPlayerLoadOpts> {
  const out: Partial<SnowPlayerLoadOpts> = {
    surfaceView: playerFlag(SURFACE_VIEW_FLAG),
    asyncCodec: playerFlag(ASYNC_CODEC_FLAG),
    // The native side applies it to films only; Live TV stays FFmpeg first.
    audioHwFirst: playerFlag(AUDIO_HW_FIRST_FLAG) && !loadDecodeAudioOnBox(),
  };
  if (!live && playerFlag(TUNNELED_VOD_FLAG)) out.tunneled = true;
  if (!live && loadMatchFrameRate() && playerFlag(MATCH_FRAME_RATE_FLAG)) {
    out.matchFrameRate = true;
    if (typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0) out.frameRate = frameRate;
  }
  return out;
}
