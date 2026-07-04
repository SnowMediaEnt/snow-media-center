// Shared player volume persisted across Live TV + Plex sessions.
// Legacy Live-TV-only key ('snow-livetv-volume-v1') is migrated on first read.
const KEY = 'snow-player-volume-v1';
const LEGACY_KEY = 'snow-livetv-volume-v1';
const DEFAULT_VOLUME = 0.9;

const clamp = (v: number): number => {
  if (!Number.isFinite(v)) return DEFAULT_VOLUME;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
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
    return clamp(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function savePlayerVolume(v: number): void {
  try { localStorage.setItem(KEY, String(clamp(v))); } catch { /* ignore */ }
}
