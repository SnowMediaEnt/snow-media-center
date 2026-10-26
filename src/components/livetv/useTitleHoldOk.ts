// OK on a title in the line's Movies / Series (a poster, the title page's
// Play, an episode): let go before HOLD_MS it is a press and does what OK
// always did (open the title, play it); held, the title's options menu
// (ReportChannelDialog, kind movie / series: Report a problem).
//
// Owner, 1.9.8: "when you select and hold on a movie in the menu it opens the
// movie and flops back and forth pause/play. A press and hold should bring up
// the menu to report it." The press now runs when OK is let go (the only way
// to tell a press from a hold, as Live TV's channel list does), and a held
// OK is one action: its repeats do nothing (okLatch, which does not trust
// e.repeat). The menu takes OK only after a key goes up (its own latch), so
// the held OK never runs on into it either.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createOkHold } from '@/lib/okHold';
import { isOkKey, okIsRepeat } from '@/lib/okLatch';

export interface TitleHoldOk<T> {
  /** The title whose menu is open, or null. */
  menuFor: T | null;
  /** The menu is open (read in key handlers: they stand aside). */
  menuOpen: () => boolean;
  /** OK went down on `item`: `press` runs when it is let go in time; held, the menu. */
  okDown: (e: KeyboardEvent, item: T, press: () => void) => void;
  /** The highlight moved, the page changed: a hold under way comes to nothing. */
  cancel: () => void;
  /** Open the menu now (a finger's long press, the Menu key). */
  openMenu: (item: T) => void;
  closeMenu: () => void;
}

export function useTitleHoldOk<T>(active: boolean): TitleHoldOk<T> {
  const [menuFor, setMenuFor] = useState<T | null>(null);
  const menuRef = useRef<T | null>(null);
  const holdRef = useRef(createOkHold<{ item: T; press: () => void }>());

  const openMenu = useCallback((item: T) => { menuRef.current = item; setMenuFor(item); }, []);
  const closeMenu = useCallback(() => { menuRef.current = null; setMenuFor(null); }, []);
  const menuOpen = useCallback(() => menuRef.current != null, []);
  const cancel = useCallback(() => { holdRef.current.cancel(); }, []);

  const okDown = useCallback((e: KeyboardEvent, item: T, press: () => void) => {
    // A held OK repeating: the press (or the menu) it started is all it does.
    if (okIsRepeat(e)) return;
    holdRef.current.cancel();
    holdRef.current.press({ item, press }, (k) => openMenu(k.item));
  }, [openMenu]);

  // OK let go before the hold time: the press.
  useEffect(() => {
    const hold = holdRef.current;
    if (!active) { hold.cancel(); return; }
    const onUp = (e: KeyboardEvent) => {
      if (!isOkKey(e)) return;
      const k = hold.release();
      if (k) k.press();
    };
    // The app lost focus mid-hold (Alexa, a system overlay): its keyup never
    // comes here, so the hold comes to nothing rather than popping the menu.
    const onBlur = () => hold.cancel();
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
      hold.cancel();
    };
  }, [active]);

  return { menuFor, menuOpen, okDown, cancel, openMenu, closeMenu };
}
