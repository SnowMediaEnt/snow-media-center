import { Capacitor } from '@capacitor/core';
import { markKeyboardHidden } from '@/utils/keyboardVisibility';
import { closeScreenKeyboard, openScreenKeyboard } from '@/lib/screenKeyboard';

export const hideKeyboardForDpad = async (
  element?: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
) => {
  // Browser preview: the keyboard is drawn by the app, so closing it is a
  // local state change. No-op on native and when it was never open.
  closeScreenKeyboard();
  element?.blur();
  markKeyboardHidden();

  if (Capacitor.isNativePlatform()) {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.hide();
    } catch (error) {
      console.warn('[DPadKeyboard] Unable to hide native keyboard:', error);
    }
  }
};

interface FocusOptions {
  /**
   * Checked before every stage that has a native side effect. Returning true
   * abandons the request — the viewer has navigated, the hook was disabled, or
   * the field went away, and raising a keyboard then is worse than not raising
   * one at all.
   */
  isCancelled?: () => boolean;
}

/**
 * Focus a field and ask the platform for its on-screen keyboard.
 *
 * The returned boolean says the REQUEST was accepted — NOT that a keyboard is
 * on screen. Fire TV and some Android TV WebViews accept the request and show
 * nothing at all. Callers that need real visibility must read
 * `isNativeKeyboardVisible()` (keyboardDidShow) or wait for editing evidence,
 * and must stay able to retry when neither arrives.
 */
export const focusTextInputForDpad = async (
  element: HTMLInputElement | HTMLTextAreaElement | null | undefined,
  options: FocusOptions = {}
): Promise<boolean> => {
  // Focus is only required to STAY on the field, never to be there already:
  // the very first stage is what puts it there.
  let focused = false;
  const cancelled = () =>
    !element || !element.isConnected || element.disabled
    || (focused && document.activeElement !== element)
    || !!options.isCancelled?.();
  if (!element || element.disabled || cancelled()) return false;

  // No blur/refocus dance, no inputmode juggling, no synthetic click and no
  // caret rewriting: the caller's inputMode and the viewer's own selection are
  // left exactly as they are. Blurring first only tore down the input
  // connection Android had just built, which is why the keyboard never came up.
  element.focus({ preventScroll: true });
  focused = true;

  if (!Capacitor.isNativePlatform()) {
    if (cancelled()) return false;
    // Desktop preview has no system IME to summon: draw our own keyboard so
    // OK on a text bar visibly opens something that can be typed on with a
    // remote. Gated inside openScreenKeyboard (never native, never mobile).
    openScreenKeyboard(element);
    return !cancelled();
  }


  let requested = false;
  if (cancelled()) return false;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    if (cancelled()) return false;
    await Keyboard.show();
    requested = true;
  } catch (error) {
    // A missing plugin registration lands here. Do not give up: the forced
    // native fallback below can still raise the keyboard on TV devices.
    console.warn('[DPadKeyboard] Unable to show native keyboard:', error);
  }

  // Fire TV and some Android TV launchers ignore Keyboard.show() because it
  // uses a non-forced IME request. Follow it with the forced native fallback;
  // phones normally already have the keyboard open, so this is harmless there.
  if (cancelled()) return false;
  try {
    const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
    if (cancelled()) return false;
    await SnowKeyboard.show();
    requested = true;
  } catch (error) {
    console.warn('[DPadKeyboard] Forced keyboard fallback unavailable:', error);
  }

  return requested && !cancelled();
};
