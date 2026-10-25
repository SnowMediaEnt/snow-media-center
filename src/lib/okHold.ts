// OK on something with a hold menu (Home's tiles, the content bar): let go
// before HOLD_MS it is a press; held, the menu (the Services list's hold).
//
//   keydown OK (not a repeat)  → press(key, onHold): the timer starts
//   keyup OK                   → release(): the key when it was a press
//                                (let go in time), else null (the hold fired)
//   moving away, leaving       → cancel(): neither
//
// The menu the hold opens must not take the OK still held down: open it
// latched (useHomeEditor's viaOk).
import { HOLD_MS } from '@/hooks/useLongPress';

export interface OkHold<K> {
  /** OK went down on `key`. False when a hold is already under way (a repeat). */
  press: (key: K, onHold: (key: K) => void) => boolean;
  /** OK let go: the key if it was a press, null if there was none or the hold fired. */
  release: () => K | null;
  cancel: () => void;
  pending: () => boolean;
}

export function createOkHold<K>(ms: number = HOLD_MS): OkHold<K> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held: K | null = null;
  const cancel = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    held = null;
  };
  return {
    press: (key, onHold) => {
      if (timer != null) return false;
      held = key;
      timer = setTimeout(() => {
        timer = null;
        held = null;
        onHold(key);
      }, ms);
      return true;
    },
    release: () => {
      if (timer == null) return null;
      const k = held;
      cancel();
      return k;
    },
    cancel,
    pending: () => timer != null,
  };
}
