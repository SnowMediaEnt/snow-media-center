import "core-js/stable";
import "core-js/stable/structured-clone";
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tv.css'
import { isNativePlatform, getPlatform } from './utils/platform'
import { isStorageReady, waitForStorageReady } from './utils/storage'
import { isOnline } from './utils/network'

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
// pause the news-ticker/media-bar marquees — continuous marquee compositing
// competes with focus transitions on Amlogic/Mali GPUs and drops frames.
// Resumes 600ms after the last keypress.
let navIdleTimer: number | undefined;
window.addEventListener('keydown', (e) => {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  document.documentElement.classList.add('nav-active');
  window.clearTimeout(navIdleTimer);
  navIdleTimer = window.setTimeout(() => {
    document.documentElement.classList.remove('nav-active');
  }, 600);
}, { capture: true, passive: true });

// Startup diagnostics for debugging Android issues
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
  
  // Wait for storage to be ready before proceeding
  if (!storageReady) {
    console.log('[STARTUP] Waiting for storage adapter...');
    await waitForStorageReady();
    console.log('[STARTUP] Storage adapter ready!');
  }
  
  // Test Supabase connection
  try {
    const { supabase } = await import('./integrations/supabase/client');
    console.log('[STARTUP] Supabase client imported');
    
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.warn('[STARTUP] Supabase session error:', error.message);
    } else {
      console.log(`[STARTUP] Supabase session: ${session ? 'ACTIVE' : 'NONE'}`);
    }
  } catch (err) {
    console.error('[STARTUP] Supabase initialization failed:', err);
  }
  
  console.log('[STARTUP] Diagnostics complete, rendering app...');
};

// Render IMMEDIATELY — do not block first paint on Supabase round-trips or
// storage probes. Diagnostics run in the background and only log; they never
// gate the UI. This was the cause of perceived slowness after recent edits.
createRoot(document.getElementById("root")!).render(<App />);

// Fire-and-forget diagnostics
logStartupDiagnostics().catch((err) => {
  console.error('[STARTUP] Diagnostics error (non-fatal):', err);
});

