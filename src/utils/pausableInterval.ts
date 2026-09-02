import { isNativePlatform } from './platform';
import { isQuiet, onQuietChange } from './quietMode';

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
 * Quiet mode (see ./quietMode): while a stream is playing on a low-memory
 * device (html.native-low-memory) every NON-essential interval is paused
 * as well, so CPU / RAM / network go to playback. Pass
 * `{ essential: true }` for a job that must keep running during playback
 * (no current caller needs it — the update check already skips while
 * `streaming-active`, and player server alerts ride a Supabase realtime
 * channel, not a timer). An entry runs only when
 * `appActive && (essential || !quiet)`. When quiet lifts, paused entries
 * simply restart their interval — they do NOT fire immediately, which
 * avoids a burst of fetches the moment playback stops.
 *
 * NOTE: do NOT use this for the analytics flush timer — analytics must
 * keep flushing on background/hide.
 */

export interface PausableIntervalOptions {
  /** Keep running during quiet mode (stream playing on a low-memory box). */
  essential?: boolean;
}

interface Entry {
  fn: () => void;
  ms: number;
  essential: boolean;
  id: ReturnType<typeof setInterval> | null;
}

const entries = new Set<Entry>();
let isActive = true;
let quiet = false;
let nativeWired = false;
let webWired = false;
let quietUnsub: (() => void) | null = null;
let nativeHandle: { remove: () => void } | null = null;
let nativeImportStarted = false;

const shouldRun = (e: Entry) => isActive && (e.essential || !quiet);

const stopEntry = (e: Entry) => {
  if (e.id) { clearInterval(e.id); e.id = null; }
};
const startEntry = (e: Entry) => {
  if (!e.id) { e.id = setInterval(e.fn, e.ms); }
};
/** Bring one entry in line with the current active/quiet state. */
const syncEntry = (e: Entry) => {
  if (shouldRun(e)) startEntry(e);
  else stopEntry(e);
};

const handleActiveChange = (active: boolean) => {
  if (active === isActive) return;
  isActive = active;
  entries.forEach(syncEntry);
};

const handleQuietChange = (on: boolean) => {
  if (on === quiet) return;
  quiet = on;
  // Only non-essential entries are affected; essential ones are already in
  // whatever state `isActive` dictates.
  entries.forEach((e) => { if (!e.essential) syncEntry(e); });
};

const ensureListeners = () => {
  if (!quietUnsub) {
    quiet = isQuiet();
    quietUnsub = onQuietChange(handleQuietChange);
  }
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
      .then((h) => { nativeHandle = h; nativeWired = true; })
      .catch(() => { /* ignore — timers will simply never auto-pause */ });
  } else if (typeof document !== 'undefined') {
    if (webWired) return;
    document.addEventListener('visibilitychange', () => {
      handleActiveChange(document.visibilityState !== 'hidden');
    });
    webWired = true;
  }
};

export function setPausableInterval(fn: () => void, ms: number, opts?: PausableIntervalOptions): () => void {
  ensureListeners();
  const entry: Entry = { fn, ms, essential: !!opts?.essential, id: null };
  entries.add(entry);
  syncEntry(entry);

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
  if (quietUnsub) { try { quietUnsub(); } catch { /* ignore */ } }
  quietUnsub = null;
  quiet = false;
  isActive = true;
}
