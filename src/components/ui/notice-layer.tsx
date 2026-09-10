import { memo, useEffect, useRef, type ReactNode } from 'react';

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

  if (!open) return null;

  return (
    <div className="fixed left-0 right-0 top-0 bottom-0 z-[130] flex items-center justify-center p-4 pointer-events-none">
      {/* Dim only. Deliberately inert: a notice that is on screen when it
          should not be must never be able to block the app underneath it —
          that failure mode is what made every field and button dead. The OK
          button and the remote's OK / Back are how it is dismissed. */}
      <div
        className="absolute left-0 right-0 top-0 bottom-0 bg-black/80 pointer-events-none"
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-labelledby={labelledBy}
        className="pointer-events-auto relative w-full max-w-lg"
      >
        {children}
      </div>
    </div>
  );
};

export default memo(NoticeLayer);
