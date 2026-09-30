// Website-embedded demo mode.
//
// This is a RUNTIME flag, not a build flag — the exact same bundle serves the
// Android APK and the marketing-site iframe. `?demo=1` on the URL latches the
// flag into sessionStorage for the rest of the tab's life.
//
// isDemo() is ALWAYS false on native, so nothing about the shipped TV app
// changes: every demo gate is dead code on device.
import i18n from '@/i18n';
import { isNativePlatform } from '@/utils/platform';

const DEMO_KEY = 'smc-demo';
/** The How-to capture latch (`?howto=1`), developer build only. */
const HOWTO_KEY = 'smc-howto';

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
    if (import.meta.env.DEV && qs.get('howto') === '1') {
      try { sessionStorage.setItem(HOWTO_KEY, '1'); } catch { /* private mode */ }
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

/**
 * The How-to guide's screenshot run (scripts/howto): the demo, in the
 * developer build, with `?howto=1`. It only SHOWS what the demo hides (the
 * Live TV Settings button, the Updates tab…) so the pictures match a real
 * box; it never turns an action on. The production build (the APK and the
 * website) reads `import.meta.env.DEV` as false, so this is always false
 * there and every branch it guards is dropped.
 */
export const isHowtoCapture = (): boolean => {
  if (!import.meta.env.DEV) return false;
  if (!isDemo()) return false;
  try { return sessionStorage.getItem(HOWTO_KEY) === '1'; } catch { return false; }
};

/** The "you're in the demo" line, in the app's language (call it while drawing). */
export const demoDialogMsg = (): string => i18n.t('popups.demo.msg');
