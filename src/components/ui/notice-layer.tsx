import { memo, useEffect, useRef, type ReactNode } from 'react';
import { usePlatformBack } from '@/hooks/usePlatformBack';
import { useTouchUI } from '@/lib/phoneMode';

interface NoticeLayerProps {
  open: boolean;
  /** Announced to screen readers as the notice's name. */
  labelledBy?: string;
  children: ReactNode;
  /** Called for OK / Enter / Back / Escape. */
  onDismiss: () => void;
}

/**
 * A boot notice: a card over a dim backdrop, with an OK button.
 *
 * NOT a Radix Dialog, and that is the whole point. A Radix modal sets
 * pointer-events:none on document.body for as long as it is open, so any
 * notice that opened while the viewer was elsewhere — or that stacked with
 * another — left the ENTIRE APP unclickable and untypeable with nothing
 * visibly wrong. Every text field went dead and the on-screen keyboard could
 * not be raised. That cost three days to find, twice, because the app looks
 * fine while it happens.
 *
 * Here only the card takes pointer events. The rest of the page keeps working
 * even if a notice is somehow left open, so the worst case is a stray card
 * rather than a bricked app.
 */
const NoticeLayer = ({ open, labelledBy, children, onDismiss }: NoticeLayerProps) => {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const touch = useTouchUI();

  // OK / Enter / Back / Escape dismiss. Capture phase, and
  // stopImmediatePropagation so the screen underneath does not also act on the
  // press — other window-capture listeners still run after stopPropagation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 23 is KEYCODE_DPAD_CENTER, 4 is Back: a Fire TV remote sends those.
      const dismisses = ['Enter', ' ', 'Escape', 'Backspace'].includes(e.key)
        || e.keyCode === 4 || e.keyCode === 23;
      if (!dismisses) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onDismissRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  // A phone's Back is never a key: the system Back closes the notice too
  // (it used to reach Home underneath; Tronix a794c13).
  usePlatformBack(open, () => onDismissRef.current());

  if (!open) return null;

  return (
    <div className="fixed left-0 right-0 top-0 bottom-0 z-[130] flex items-center justify-center p-4 pointer-events-none">
      {/* Dim only. Deliberately inert on a TV: a notice that is on screen
          when it should not be must never be able to block the app underneath
          it — that failure mode is what made every field and button dead. The
          OK button and the remote's OK / Back are how it is dismissed. On a
          phone or tablet a tap on the dim closes the notice (a finger meant
          to close it used to open whatever tile was under it); a stray
          notice is still one tap from gone, never a dead app. */}
      <div
        className={`absolute left-0 right-0 top-0 bottom-0 bg-black/80 ${touch ? 'pointer-events-auto' : 'pointer-events-none'}`}
        aria-hidden="true"
        data-notice-dim=""
        onClick={touch ? () => onDismissRef.current() : undefined}
      />
      {/* data-notice-layer: popups that wait their turn (the profiles intro)
          look for it. On a phone or tablet it is also aria-modal, so the
          app's own Back handling (useNavigation) stands aside and the system
          Back closes the notice, not the screen under it. Only an attribute:
          the page still takes pointer events (see above). A TV keeps its Back
          as it was. */}
      <div
        role="dialog"
        aria-modal={touch ? 'true' : undefined}
        aria-labelledby={labelledBy}
        data-notice-layer="open"
        className="pointer-events-auto relative w-full max-w-lg"
      >
        {children}
      </div>
    </div>
  );
};

export default memo(NoticeLayer);
