// Idle / first-interaction scheduling helpers used to defer non-critical mount
// work on weak Android TV boxes so the home cards become focusable on first
// paint and secondary data loads afterward.

type IdleHandle = number;

interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining: () => number;
}

const ric: ((cb: (d: IdleDeadline) => void, opts?: { timeout?: number }) => IdleHandle) | undefined =
  typeof window !== 'undefined' ? (window as any).requestIdleCallback : undefined;
const cic: ((h: IdleHandle) => void) | undefined =
  typeof window !== 'undefined' ? (window as any).cancelIdleCallback : undefined;

/**
 * Runs `fn` when the browser is idle. If requestIdleCallback isn't available
 * (older WebViews) falls back to a setTimeout with the same timeoutMs.
 * Returns a cancel function.
 */
export const runWhenIdle = (fn: () => void, timeoutMs = 1000): (() => void) => {
  if (ric) {
    const handle = ric(() => { try { fn(); } catch (e) { console.warn('[idle] task threw', e); } }, { timeout: timeoutMs });
    return () => { try { cic?.(handle); } catch { /* ignore */ } };
  }
  const t = window.setTimeout(() => { try { fn(); } catch (e) { console.warn('[idle] task threw', e); } }, timeoutMs);
  return () => window.clearTimeout(t);
};

const firstInteractionListeners = new Set<() => void>();
let firstInteractionFired = false;
let firstInteractionFallback: number | undefined;

const fireFirstInteraction = () => {
  if (firstInteractionFired) return;
  firstInteractionFired = true;
  window.clearTimeout(firstInteractionFallback);
  document.removeEventListener('keydown', fireFirstInteraction, true);
  document.removeEventListener('pointerdown', fireFirstInteraction, true);
  document.removeEventListener('touchstart', fireFirstInteraction, true);
  firstInteractionListeners.forEach((l) => { try { l(); } catch (e) { console.warn('[idle] first-interaction listener threw', e); } });
  firstInteractionListeners.clear();
};

if (typeof window !== 'undefined') {
  document.addEventListener('keydown', fireFirstInteraction, true);
  document.addEventListener('pointerdown', fireFirstInteraction, true);
  document.addEventListener('touchstart', fireFirstInteraction, true);
  // Hard fallback so deferred work still runs if the user never interacts
  firstInteractionFallback = window.setTimeout(fireFirstInteraction, 5000);
}

/**
 * Runs `fn` once on the first user interaction (keydown/pointer/touch). If the
 * user never interacts within ~5s a fallback timer still triggers it so
 * background sync isn't permanently starved.
 */
export const onFirstInteraction = (fn: () => void): (() => void) => {
  if (firstInteractionFired) {
    // Run async to avoid surprising callers
    queueMicrotask(() => { try { fn(); } catch (e) { console.warn('[idle] listener threw', e); } });
    return () => { /* noop */ };
  }
  firstInteractionListeners.add(fn);
  return () => { firstInteractionListeners.delete(fn); };
};
