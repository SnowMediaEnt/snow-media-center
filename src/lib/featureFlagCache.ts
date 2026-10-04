// The last-known value of each remote feature flag (public.feature_flags),
// kept in localStorage so a flag reads right on the first frame. Written by
// useFeatureFlag and usePlayerFlagSync; read synchronously wherever a value
// is needed outside React (the native player's load options).

const cacheKey = (key: string) => `snow-feature-flag:${key}`;

/** The cached value, or `fallback` when nothing is cached (a missing row). */
export function readCachedFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* ignore */ }
  return fallback;
}

export function writeCachedFlag(key: string, value: boolean): void {
  try { localStorage.setItem(cacheKey(key), value ? '1' : '0'); } catch { /* ignore */ }
}

/** The row is gone: back to the flag's own default on the next read. */
export function clearCachedFlag(key: string): void {
  try { localStorage.removeItem(cacheKey(key)); } catch { /* ignore */ }
}
