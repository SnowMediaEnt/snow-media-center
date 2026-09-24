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
 * Whether a hardware Back now belongs to an overlay above the screen rather
 * than to the screen: one is open (any but those inside `own`, the screen's
 * own root), or one has just answered this same press — the voice overlay
 * closes on it and may already be gone from the page when this runs.
 * `ownAt` is when the screen itself last marked a Back handled: that mark is
 * its own, not another overlay's.
 */
export function overlayAboveOwnsBack(own?: Element | null, ownAt = 0): boolean {
  if (voiceOwnsBack()) return true;
  try {
    const open = document.querySelectorAll(OPEN_OVERLAY);
    for (let i = 0; i < open.length; i += 1) if (!own || !own.contains(open[i])) return true;
  } catch { /* ignore */ }
  const at = (window as BackWindow).__overlayHandledBackAt ?? 0;
  return at !== ownAt && Date.now() - at < BACK_ONCE_MS;
}
