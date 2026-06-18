import "core-js/stable";
import "core-js/stable/structured-clone";
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tv.css'
import { isNativePlatform, getPlatform } from './utils/platform'
import { isStorageReady, waitForStorageReady } from './utils/storage'
import { isOnline } from './utils/network'

try { if ((window as any).__SMC_BOOT__) (window as any).__SMC_BOOT__('js'); } catch(e){}

// Low-memory by actual RAM, not by box brand.
// navigator.deviceMemory is approximate GiB (0.25–8) in Chromium WebViews.
const dm = (navigator as any).deviceMemory;
const lowRam = typeof dm === 'number' && dm > 0 && dm <= 2;          // genuine 1–2 GB boxes
const ancientAndroid = /Android [4-7]\b/i.test(navigator.userAgent);  // very old OS fallback
const nativeLowMemory = isNativePlatform() && (lowRam || ancientAndroid);
if (nativeLowMemory) {
  document.documentElement.classList.add('native-low-memory');
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
createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget diagnostics
logStartupDiagnostics().catch((err) => {
  console.error('[STARTUP] Diagnostics error (non-fatal):', err);
});
