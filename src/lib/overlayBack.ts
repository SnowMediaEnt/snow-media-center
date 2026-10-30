// Hardware Back reaches every Capacitor backButton listener, in the order they
// were added and in separate turns. A screen whose own listener acts on Back
// directly (the Buffering Guide, Home's pinned-apps row) also hears a press
// meant for an overlay on top of it — the voice overlay, a kickoff reminder —
// and one press closed both. Such a listener asks here first.
import { voiceOwnsBack } from '@/lib/voiceUi';

/** Overlays mark themselves aria-modal or data-state="open" (Radix); boot
 *  notices use data-notice-layer. */
const OPEN_OVERLAY = '[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-notice-layer]';
/** One press, however many listeners hear it. */
const BACK_ONCE_MS = 350;

type BackWindow = Window & { __overlayHandledBackAt?: number };

/**
 * Whether a pop-up is open above the screen now (any but those inside
 * `own`, the screen's own root). A screen acting on a key some time after it
 * was pressed (a hold timer, the release) asks here: the pop-up has the
 * remote by then, and nothing should happen behind it.
 */
export function overlayOpenAbove(own?: Element | null): boolean {
  if (voiceOwnsBack()) return true;
  try {
    const open = document.querySelectorAll(OPEN_OVERLAY);
    for (let i = 0; i < open.length; i += 1) if (!own || !own.contains(open[i])) return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * Whether a hardware Back now belongs to an overlay above the screen rather
 * than to the screen: one is open (any but those inside `own`, the screen's
 * own root), or one has just answered this same press — the voice overlay
 * closes on it and may already be gone from the page when this runs.
 * `ownAt` is when the screen itself last marked a Back handled: that mark is
 * its own, not another overlay's.
 */
export function overlayAboveOwnsBack(own?: Element | null, ownAt = 0): boolean {
  if (overlayOpenAbove(own)) return true;
  const at = (window as BackWindow).__overlayHandledBackAt ?? 0;
  return at !== ownAt && Date.now() - at < BACK_ONCE_MS;
}

/**
 * Mark a hardware Back as answered by an overlay. Call it on every path where
 * a popup closes (or otherwise consumes) the remote's Back key.
 *
 * On a Fire TV one press of Back arrives twice: as a keydown (keyCode 4 /
 * Escape) and, a moment later, as Capacitor's 'backButton'. A popup that
 * closes on the key is gone from the page by the time the system Back comes,
 * so useNavigation sees a bare Home and arms "press again to exit" — and
 * Back on the next popup within two seconds closed the app. The mark makes
 * every other Back listener stand aside for this press (BACK_ONCE_MS).
 */
export function markBackHandled(now = Date.now()): number {
  (window as BackWindow).__overlayHandledBackAt = now;
  return now;
}
