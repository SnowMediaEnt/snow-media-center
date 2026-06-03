import { isNativePlatform } from './platform';

/**
 * setInterval that automatically pauses when the app goes to background
 * and resumes when it returns to the foreground.
 *
 * Phase 6B.2: a SINGLE module-level appStateChange listener (and a single
 * visibilitychange listener on web) is shared by every pausable interval.
 * Previously every call registered its own native listener via a lazy
 * import — 6+ timers produced a storm of add/remove native calls on the
 * UI thread. Now adding/removing a pausable interval is pure JS.
 *
 * NOTE: do NOT use this for the analytics flush timer — analytics must
 * keep flushing on background/hide.
 */

interface Entry {
  fn: () => void;
  ms: number;
  id: ReturnType<typeof setInterval> | null;
}

const entries = new Set<Entry>();
let isActive = true;
let nativeWired = false;
let webWired = false;
let nativeHandle: { remove: () => void } | null = null;
let nativeImportStarted = false;

const stopEntry = (e: Entry) => {
  if (e.id) { clearInterval(e.id); e.id = null; }
};
const startEntry = (e: Entry) => {
  if (!e.id) { e.id = setInterval(e.fn, e.ms); }
};

const handleActiveChange = (active: boolean) => {
  if (active === isActive) return;
  isActive = active;
  if (active) {
    entries.forEach(startEntry);
  } else {
    entries.forEach(stopEntry);
  }
};

const ensureListeners = () => {
  if (isNativePlatform()) {
    if (nativeWired || nativeImportStarted) return;
    nativeImportStarted = true;
    // Single lazy import; the resulting listener lives for the lifetime of
    // the page and is shared by every pausable interval.
    import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('appStateChange', ({ isActive: active }) => {
          handleActiveChange(!!active);
        })
      )
      .then((h: any) => { nativeHandle = h; nativeWired = true; })
      .catch(() => { /* ignore — timers will simply never auto-pause */ });
  } else if (typeof document !== 'undefined') {
    if (webWired) return;
    document.addEventListener('visibilitychange', () => {
      handleActiveChange(document.visibilityState !== 'hidden');
    });
    webWired = true;
  }
};

export function setPausableInterval(fn: () => void, ms: number): () => void {
  ensureListeners();
  const entry: Entry = { fn, ms, id: null };
  entries.add(entry);
  if (isActive) startEntry(entry);

  return () => {
    stopEntry(entry);
    entries.delete(entry);
  };
}

// Exposed for tests / hot-reload only — not part of the public API.
export function __resetPausableIntervalsForTests() {
  entries.forEach(stopEntry);
  entries.clear();
  if (nativeHandle?.remove) { try { nativeHandle.remove(); } catch { /* ignore */ } }
  nativeHandle = null;
  nativeWired = false;
  nativeImportStarted = false;
  webWired = false;
  isActive = true;
}
