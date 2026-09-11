import { Capacitor } from '@capacitor/core';

/**
 * Real on-screen-keyboard visibility, as reported by the platform.
 *
 * A `Keyboard.show()` call that resolves only proves the REQUEST was accepted.
 * Several Fire TV / Android TV WebViews accept it and show nothing. Anything
 * that needs to know whether the viewer can actually type must therefore key
 * off the platform's own lifecycle events (keyboardDidShow / keyboardDidHide)
 * or off real editing evidence (an input / composition event), never off the
 * resolved promise.
 */

let visible = false;
let subscribed = false;
const listeners = new Set<(open: boolean) => void>();

const emit = (open: boolean) => {
  if (visible === open) return;
  visible = open;
  listeners.forEach((cb) => {
    try {
      cb(open);
    } catch {
      /* a listener must never break the others */
    }
  });
};

const subscribe = () => {
  if (subscribed) return;
  subscribed = true;
  if (!Capacitor.isNativePlatform()) return;
  void (async () => {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.addListener('keyboardDidShow', () => emit(true));
      await Keyboard.addListener('keyboardDidHide', () => emit(false));
    } catch (error) {
      // No keyboard plugin: visibility can still be inferred from real editing
      // evidence via markKeyboardVisible below, and from SnowKeyboard's own
      // report just below this.
      console.warn('[Keyboard] Unable to observe keyboard lifecycle:', error);
    }
  })();
  // SnowKeyboard reports what InputMethodManager actually DID with each show
  // and hide request, plus the dismissals the page never asked for — Back
  // closing a docked keyboard is handled entirely inside Android, and without
  // this the page would still believe a keyboard it can no longer see is up.
  // That was a real bug and not a cosmetic one: useTVFocus spends a Back press
  // closing the keyboard it thinks is open, so the viewer had to press Back
  // twice to leave the screen.
  void (async () => {
    try {
      const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
      await SnowKeyboard.addListener('keyboardVisibility', ({ visible }) => emit(!!visible));
    } catch (error) {
      console.warn('[Keyboard] Unable to observe native keyboard visibility:', error);
    }
  })();
};

/** True only when the platform has said the keyboard is on screen. */
export const isNativeKeyboardVisible = () => {
  subscribe();
  return visible;
};

/**
 * Record hard evidence that editing is live — a real `input`, `beforeinput` or
 * `compositionstart` on a focused field. This covers devices that raise a
 * keyboard without ever firing keyboardDidShow.
 */
export const markKeyboardVisible = () => {
  subscribe();
  emit(true);
};

/** Record that the keyboard has been dismissed (we asked it to hide). */
export const markKeyboardHidden = () => {
  subscribe();
  emit(false);
};

export const onKeyboardVisibilityChange = (cb: (open: boolean) => void) => {
  subscribe();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
