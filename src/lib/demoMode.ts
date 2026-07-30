// Website-embedded demo mode.
//
// This is a RUNTIME flag, not a build flag — the exact same bundle serves the
// Android APK and the marketing-site iframe. `?demo=1` on the URL latches the
// flag into sessionStorage for the rest of the tab's life.
//
// isDemo() is ALWAYS false on native, so nothing about the shipped TV app
// changes: every demo gate is dead code on device.
import { isNativePlatform } from '@/utils/platform';

const DEMO_KEY = 'smc-demo';

// Latch at module load so deep navigation (which drops the query string)
// keeps the demo active.
try {
  if (typeof location !== 'undefined') {
    const qs = new URLSearchParams(location.search);
    if (qs.get('demo') === '1') {
      try { sessionStorage.setItem(DEMO_KEY, '1'); } catch { /* private mode */ }
    }
  }
} catch { /* non-browser */ }

export const isDemo = (): boolean => {
  if (isNativePlatform()) return false;
  try { return sessionStorage.getItem(DEMO_KEY) === '1'; } catch { return false; }
};

export const DEMO_DIALOG_MSG =
  "You're in the live demo — playback works in the installed app on your TV.";
