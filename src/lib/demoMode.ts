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

// Hosts where the published bundle must ALWAYS serve demo mode, regardless of
// query string. Add more here as new published hosts come online.
const FORCED_DEMO_HOSTS: string[] = ['snow-tv-hub-center.lovable.app'];

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
  // Query-string / sessionStorage latch (Lovable previews etc.)
  try {
    if (sessionStorage.getItem(DEMO_KEY) === '1') return true;
  } catch { /* private mode */ }
  // Forced demo on the published marketing host(s) — non-native only.
  try {
    if (typeof location !== 'undefined' && FORCED_DEMO_HOSTS.includes(location.hostname)) {
      return true;
    }
  } catch { /* non-browser */ }
  return false;
};

export const DEMO_DIALOG_MSG =
  "You're in the live demo — playback works in the installed app on your TV.";
