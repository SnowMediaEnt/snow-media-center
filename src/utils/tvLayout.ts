/**
 * TV / legacy-WebView layout detector.
 *
 * Detects Android TV / STB / legacy Capacitor builds so the home screen
 * can switch to a fixed 16:9-safe canvas instead of relying on
 * screenHeight thresholds (which lie on STB devices that report
 * 1440 / 2160 heights but really render at ~1080).
 *
 * Triggers when ANY of the following are true:
 *   - window.__SMC_BUNDLE__ === 'legacy' (set by the dual-bundle loader)
 *   - Running inside a Capacitor native shell
 *   - UA contains "Android" AND viewport aspect ratio is roughly 16:9
 */
import { useState } from 'react';
import { isNativePlatform } from './platform';

declare global {
  interface Window {
    __SMC_BUNDLE__?: string;
    __SMC_TV_LAYOUT__?: boolean;
  }
}

const computeTvLegacy = (): boolean => {
  try {
    if (typeof window === 'undefined') return false;
    if (window.__SMC_BUNDLE__ === 'legacy') return true;
    if (isNativePlatform()) return true;

    const ua = navigator.userAgent || '';
    const isAndroid = /Android/i.test(ua);
    const w = window.innerWidth || 0;
    const h = window.innerHeight || 1;
    const ratio = w / h;
    // 16:9 ~= 1.777; allow 1.5–1.95 with a min width that excludes phones.
    const wide = ratio >= 1.5 && ratio <= 1.95 && w >= 1024;
    if (isAndroid && wide) return true;
    return false;
  } catch {
    return false;
  }
};

let cached: boolean | undefined;

export const isTvLegacyLayout = (): boolean => {
  if (cached === undefined) {
    cached = computeTvLegacy();
    if (typeof document !== 'undefined') {
      if (cached) document.documentElement.classList.add('is-tv-legacy');
      try { window.__SMC_TV_LAYOUT__ = cached; } catch { /* ignore */ }
    }
  }
  return cached;
};

export const useTvLegacyLayout = (): boolean => {
  const [val] = useState(isTvLegacyLayout);
  return val;
};

// Eager init on import so the class lands on <html> before first paint.
isTvLegacyLayout();

// 100dvh is broken on Android WebView 66. Mirror viewport height into
// --smc-vh so CSS can fall back to calc(var(--smc-vh)) when needed.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const setVh = () => {
    try {
      document.documentElement.style.setProperty('--smc-vh', `${window.innerHeight}px`);
    } catch { /* ignore */ }
  };
  setVh();
  window.addEventListener('resize', setVh, { passive: true });
}
