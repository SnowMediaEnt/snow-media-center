// The system Back (Capacitor's 'backButton') for a popup that is up, on a
// phone or tablet (ported from Tronix, a794c13).
//
// On a touch screen that is the ONLY Back the page gets: the back gesture or
// the navigation bar's Back never arrives as a key, so a popup that closes on
// Escape / keyCode 4 alone stayed open while the screen under it went back
// (or did nothing: useNavigation stands aside for an aria-modal popup). This
// closes the popup, and only it: the press is marked handled
// (__overlayHandledBackAt) so the other Back listeners stand aside, and a
// popup that opened over this one and already answered the same press (a
// kickoff reminder) is left alone. The popup also needs aria-modal="true" on
// its root, which is what the app's own Back handling (useNavigation's
// GLOBAL_MODAL_SELECTOR) looks for to step aside first.
//
// TV boxes are left exactly as they were (their Back keeps its key path): the
// listener is only added on a touch screen (src/lib/phoneMode.ts). Popups
// inside the Player don't need it: the Player turns the system Back into the
// Escape their keys already answer.
import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useTouchUI } from '@/lib/phoneMode';
import { voiceOwnsBack } from '@/lib/voiceUi';

/** One press, however many listeners hear it (as overlayBack.ts). */
const BACK_ONCE_MS = 350;

type BackWindow = Window & { __overlayHandledBackAt?: number };

export function usePlatformBack(active: boolean, onBack: () => void): void {
  const touch = useTouchUI();
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const on = active && touch;
  useEffect(() => {
    if (!on) return undefined;
    let mine = 0;
    // Capacitor still runs a removed listener's callback when it was already
    // queued for the press: the popup that closed must not take a 2nd step.
    let disposed = false;
    const back = () => {
      if (disposed) return;
      const now = Date.now();
      const at = (window as BackWindow).__overlayHandledBackAt ?? 0;
      // This same press, already answered: here, or by a popup over this one.
      if (now - at < BACK_ONCE_MS || now - mine < BACK_ONCE_MS) return;
      if (voiceOwnsBack()) return;
      mine = now;
      (window as BackWindow).__overlayHandledBackAt = now;
      onBackRef.current();
    };
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    try {
      void CapApp.addListener('backButton', back)
        .then((h) => { if (cancelled) h.remove(); else handle = h; })
        .catch(() => { /* web: the keys cover Back */ });
    } catch { /* no Capacitor */ }
    return () => { disposed = true; cancelled = true; handle?.remove(); };
  }, [on]);
}
