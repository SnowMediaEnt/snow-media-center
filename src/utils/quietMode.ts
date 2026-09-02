/**
 * Quiet mode — "everything for playback" on low-memory devices.
 *
 * While a stream is playing on a device that runs with
 * `<html class="native-low-memory">` (Fire TV, 1–2GB Android boxes) every
 * non-essential background job (RSS refresh, clocks, polling, rotating
 * widgets) should stop so CPU / RAM / network go to the player.
 *
 * Players declare "I am playing" with `enterQuiet(reason)` and release it
 * with `exitQuiet(reason)`. Reasons are held in a Set, so each player is
 * idempotent and several may overlap (web player + native player during a
 * handover). Quiet becomes effective — `isQuiet()` — only when at least one
 * reason is held AND the low-memory gate is on (or `setQuietEverywhere(true)`
 * has disabled the gate for a future settings toggle).
 *
 * On every transition of `isQuiet()` we:
 *   - toggle the `smc-quiet` class on <html> (CSS pauses the ticker etc.),
 *   - notify `onQuietChange` subscribers (pausableInterval uses this),
 *   - dispatch a window CustomEvent 'smc:quiet' with detail { quiet }.
 *
 * Every DOM access is guarded for SSR / tests (typeof document).
 */

const QUIET_CLASS = 'smc-quiet';
const LOW_MEMORY_CLASS = 'native-low-memory';
const EVENT_NAME = 'smc:quiet';

type QuietListener = (quiet: boolean) => void;

const reasons = new Set<string>();
const listeners = new Set<QuietListener>();
let everywhere = false;
let lastQuiet = false;

const hasDocument = (): boolean => typeof document !== 'undefined' && !!document.documentElement;

const isLowMemory = (): boolean => {
  try {
    return hasDocument() && document.documentElement.classList.contains(LOW_MEMORY_CLASS);
  } catch {
    return false;
  }
};

const applyClass = (on: boolean) => {
  if (!hasDocument()) return;
  try {
    if (on) document.documentElement.classList.add(QUIET_CLASS);
    else document.documentElement.classList.remove(QUIET_CLASS);
  } catch { /* ignore */ }
};

const emitEvent = (quiet: boolean) => {
  if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { quiet } }));
  } catch { /* ignore */ }
};

/** Re-evaluate and, if `isQuiet()` changed, apply side effects + notify. */
const sync = () => {
  const next = isQuiet();
  if (next === lastQuiet) return;
  lastQuiet = next;
  applyClass(next);
  try {
    if (next) console.info('[quiet] on', Array.from(reasons));
    else console.info('[quiet] off');
  } catch { /* ignore */ }
  listeners.forEach((cb) => {
    try { cb(next); } catch { /* one bad subscriber must not break the rest */ }
  });
  emitEvent(next);
};

/** Request quiet mode. Idempotent per reason. */
export function enterQuiet(reason: string): void {
  reasons.add(reason);
  sync();
}

/** Release a quiet request. No-op if the reason was never entered. */
export function exitQuiet(reason: string): void {
  if (!reasons.delete(reason)) return;
  sync();
}

/** True when any reason is currently held (regardless of the low-memory gate). */
export function isQuietRequested(): boolean {
  return reasons.size > 0;
}

/** True when quiet is requested AND the device is low-memory (or the gate is bypassed). */
export function isQuiet(): boolean {
  return isQuietRequested() && (everywhere || isLowMemory());
}

/**
 * Subscribe to transitions of `isQuiet()`. The callback fires only on
 * change (not on subscribe). Returns an unsubscribe function.
 */
export function onQuietChange(cb: QuietListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Escape hatch for a future settings toggle: when true, `isQuiet()` ignores
 * the low-memory gate so quiet mode also applies on capable devices.
 * Nothing is persisted; default false.
 */
export function setQuietEverywhere(on: boolean): void {
  everywhere = !!on;
  sync();
}

// Exposed for tests / hot-reload only — not part of the public API.
// Deliberately does NOT clear `listeners`: pausableInterval subscribes once
// at module level and never re-subscribes, so dropping its listener here would
// silently stop quiet mode from pausing intervals. Releasing every reason and
// running sync() notifies subscribers of the off transition instead.
export function __resetQuietModeForTests(): void {
  reasons.clear();
  everywhere = false;
  sync();
  lastQuiet = false;
  applyClass(false);
}
