import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/tv.css'
import { isNativePlatform, getPlatform } from './utils/platform'
import { isStorageReady, waitForStorageReady } from './utils/storage'
import { isOnline } from './utils/network'

const nativeLowMemory = isNativePlatform() && /Android [6-9]\b|AFT|X96|T95|TX3|TV BOX|Fire TV|Amlogic/i.test(navigator.userAgent);
if (nativeLowMemory) {
  document.documentElement.classList.add('native-low-memory');
}

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

