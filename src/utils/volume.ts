// Shared player volume persisted across Live TV + Plex sessions.
// Legacy Live-TV-only key ('snow-livetv-volume-v1') is migrated on first read.
const KEY = 'snow-player-volume-v1';
const LEGACY_KEY = 'snow-livetv-volume-v1';
const DEFAULT_VOLUME = 0.9;
/** Past 100% (up to 150%) the native player boosts the sound (Android's
 *  LoudnessEnhancer, which limits so it does not clip), like VLC's. The web
 *  player stops at 100%. */
export const MAX_VOLUME = 1.5;

const clamp = (v: number): number => {
  if (!Number.isFinite(v)) return DEFAULT_VOLUME;
  if (v < 0) return 0;
  if (v > MAX_VOLUME) return MAX_VOLUME;
  return v;
};

/** One step up or down, kept within 0..MAX_VOLUME. */
export const stepVolume = (v: number, delta: number): number => clamp(+(v + delta).toFixed(2));

/** For a volume bar drawn over the whole 0..150% range. */
export const volumeBar = (v: number): { pct: number; fill: number; boost: boolean } => {
  const c = clamp(v);
  return { pct: Math.round(c * 100), fill: (c / MAX_VOLUME) * 100, boost: c > 1.0001 };
};

export function loadPlayerVolume(): number {
  try {
    let raw = localStorage.getItem(KEY);
    if (raw == null) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy != null) {
        raw = legacy;
        try { localStorage.setItem(KEY, legacy); } catch { /* ignore */ }
      }
    }
    if (raw == null) return DEFAULT_VOLUME;
    const v = clamp(Number(raw));
    if (v === 0) return 0.1;
    return v;
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function savePlayerVolume(v: number): void {
  try { localStorage.setItem(KEY, String(clamp(v))); } catch { /* ignore */ }
}
