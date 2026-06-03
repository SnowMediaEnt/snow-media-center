import { isNativePlatform } from './platform';

/**
 * setInterval that automatically pauses when the app goes to background
 * (Capacitor App `appStateChange`) or when the browser tab becomes hidden,
 * and resumes when the app/tab comes back to foreground.
 *
 * Returns a cleanup function — call it from useEffect's cleanup.
 *
 * NOTE: do NOT use this for the analytics flush timer — analytics must
 * keep flushing on background/hide.
 */
export function setPausableInterval(fn: () => void, ms: number): () => void {
  let id: ReturnType<typeof setInterval> | null = setInterval(fn, ms);
  let nativeHandle: { remove: () => void } | null = null;
  let onVis: (() => void) | null = null;

  const stop = () => {
    if (id) { clearInterval(id); id = null; }
  };
  const start = () => {
    if (!id) { id = setInterval(fn, ms); }
  };

  if (isNativePlatform()) {
    // Lazy-import so web bundles don't pull Capacitor App into the critical path.
    import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) start(); else stop();
        })
      )
      .then((h: any) => { nativeHandle = h; })
      .catch(() => { /* ignore */ });
  } else if (typeof document !== 'undefined') {
    onVis = () => {
      if (document.visibilityState === 'hidden') stop(); else start();
    };
    document.addEventListener('visibilitychange', onVis);
  }

  return () => {
    stop();
    if (nativeHandle?.remove) { try { nativeHandle.remove(); } catch { /* ignore */ } }
    if (onVis) { document.removeEventListener('visibilitychange', onVis); }
  };
}
