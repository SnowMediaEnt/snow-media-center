import "core-js/stable";
import "core-js/stable/structured-clone";
import './i18n';
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tv.css'
import { isNativePlatform, getPlatform, isFireTV } from './utils/platform'
import { isStorageReady, waitForStorageReady } from './utils/storage'
import { isOnline } from './utils/network'
import { readTheme, applyTheme } from '@/lib/theme'

// Apply user theme before React mounts to avoid FOUC.
applyTheme(readTheme());

try { if ((window as any).__SMC_BOOT__) (window as any).__SMC_BOOT__('js'); } catch(e){}

// Low-memory by actual RAM, not by box brand.
// navigator.deviceMemory is approximate GiB (0.25–8) in Chromium WebViews.
const dm = (navigator as any).deviceMemory;
const lowRam = typeof dm === 'number' && dm > 0 && dm <= 2;          // genuine 1–2 GB boxes
const ancientAndroid = /Android [4-7]\b/i.test(navigator.userAgent);  // very old OS fallback
// Fire TV Cube / Firestick: ~2GB RAM, weak GPU tile budget, repeated
// WebMediaPlayer creation. Force low-memory mode regardless of native flag
// (Fire TV WebView sometimes lies about deviceMemory).
const fireTv = isFireTV();
// A WebView too old for CSS clamp() (Chrome < 79 — index.html adds
// `legacy-webview` before this runs) is the 2019-era Amlogic box: X96 Max+,
// T95, Android 9 with the factory WebView. Those report 4 GB and dodged the
// RAM gate, then got the full-fat Plex: hundred-deep rails, the Most
// Watched queries, glow transitions on every focus move. Treat them as the
// weak boxes they are.
const legacyWebView = document.documentElement.classList.contains('legacy-webview');
const nativeLowMemory = (isNativePlatform() && (lowRam || ancientAndroid || legacyWebView)) || fireTv;
if (nativeLowMemory) {
  document.documentElement.classList.add('native-low-memory');
}
if (fireTv) {
  document.documentElement.classList.add('is-firetv');
}

// While the user is D-pad navigating, add html.nav-active so index.css can
// pause the news-ticker marquee — continuous marquee compositing
// competes with focus transitions on Amlogic/Mali GPUs and drops frames.
// Resumes ~950ms after the last keypress (raised from 600ms — the previous
// window released too early and the ticker resumed mid-navigation, causing
// the focus jump that users perceived as "jank").
let navIdleTimer: number | undefined;
window.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  document.documentElement.classList.add('nav-active');
  window.clearTimeout(navIdleTimer);
  navIdleTimer = window.setTimeout(() => {
    document.documentElement.classList.remove('nav-active');
  }, 950);
}, { capture: true, passive: true });

// Startup diagnostics — log-only, never gate UI. The duplicate Supabase
// getSession + storage probe that used to live here was removed; useAuth
// already owns the session lifecycle and the storage adapter logs its own
// readiness state.
const logStartupDiagnostics = async () => {
  const platform = getPlatform();
  const isNative = isNativePlatform();
  const online = isOnline();
  const storageReady = isStorageReady();

  console.log('='.repeat(60));
  console.log('[STARTUP] Snow Media App Initializing...');
  console.log(`[STARTUP] Platform: ${platform} (native: ${isNative})`);
  console.log(`[STARTUP] Network: ${online ? 'ONLINE' : 'OFFLINE'}`);
  console.log(`[STARTUP] Storage Ready: ${storageReady}`);
  console.log(`[STARTUP] User Agent: ${navigator.userAgent.substring(0, 100)}...`);
  console.log(`[STARTUP] Location: ${window.location.href}`);
  console.log('='.repeat(60));

  if (!storageReady) {
    console.log('[STARTUP] Waiting for storage adapter...');
    await waitForStorageReady();
    console.log('[STARTUP] Storage adapter ready!');
  }

  console.log('[STARTUP] Diagnostics complete.');
};

// Render IMMEDIATELY — do not block first paint on storage probes.
// The guard in index.html has already drawn its page on a WebView too old
// to run this bundle; mounting the app over it would only white it out.
if (!(window as unknown as { __smcWebViewTooOld?: boolean }).__smcWebViewTooOld) {
createRoot(document.getElementById("root")!).render(<App />);
}
try { if ((window as any).__SMC_BOOT__) (window as any).__SMC_BOOT__('render'); } catch(e){}

// Fire-and-forget diagnostics
logStartupDiagnostics().catch((err) => {
  console.error('[STARTUP] Diagnostics error (non-fatal):', err);
});
