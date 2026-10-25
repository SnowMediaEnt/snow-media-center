// A finger held still on something (or a right click) for its menu: the
// Services list's hold (ServicesScreen), for any element. Spread `bind(key)`
// on the element; `isHoldLift()` says the click that follows is only the lift
// of the finger whose hold opened the menu (the click must then do nothing).
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';

/** Hold OK, or a finger, this long for a menu (the Services list's hold). */
export const HOLD_MS = 600;
/** A tap this soon after a finger's hold opened the menu is that finger's lift. */
const LIFT_CLICK_MS = 700;

export function useLongPress<K>(onLongPress: (key: K) => void) {
  const cbRef = useRef(onLongPress);
  cbRef.current = onLongPress;
  const st = useRef<{ timer: number | null; touching: boolean; firedAt: number }>({ timer: null, touching: false, firedAt: 0 });

  const cancel = useCallback(() => {
    if (st.current.timer != null) window.clearTimeout(st.current.timer);
    st.current.timer = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const isHoldLift = useCallback(() => Date.now() - st.current.firedAt < LIFT_CLICK_MS, []);

  const bind = useCallback((key: K) => ({
    onTouchStart: () => {
      cancel();
      st.current.touching = true;
      st.current.timer = window.setTimeout(() => {
        st.current.timer = null;
        st.current.firedAt = Date.now();
        cbRef.current(key);
      }, HOLD_MS) as unknown as number;
    },
    // A finger that moves is scrolling.
    onTouchMove: cancel,
    onTouchEnd: (e: ReactTouchEvent) => {
      st.current.touching = false;
      cancel();
      if (Date.now() - st.current.firedAt < LIFT_CLICK_MS && e.cancelable) e.preventDefault();
    },
    onTouchCancel: () => { st.current.touching = false; cancel(); },
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault();
      if (Date.now() - st.current.firedAt < LIFT_CLICK_MS) return;
      // The WebView's own long press comes before the timer: it is the one.
      if (st.current.touching) cancel();
      st.current.firedAt = Date.now();
      cbRef.current(key);
    },
  }), [cancel]);

  return { bind, isHoldLift };
}
