import { Capacitor } from '@capacitor/core';
import { markKeyboardHidden } from '@/utils/keyboardVisibility';
import { SnowKeyboard } from '@/capacitor/SnowKeyboard';

export const hideKeyboardForDpad = async (
  element?: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
) => {
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
  if (!element || element.disabled || !element.isConnected) return false;

  // A real focus EVENT is what makes a platform raise its keyboard.
  //
  // The D-pad already focused this field when the highlight landed on it, and
  // focus() on an element that is ALREADY focused fires nothing at all — no
  // focusin, no new Android input connection, nothing for any platform to
  // react to. Measured in a browser: pressing OK produced zero focus events.
  // That is why OK did nothing, on every screen, on the device and in the
  // browser alike. Blur first so the focus below is a genuine one.
  if (document.activeElement === element) element.blur();
  element.focus({ preventScroll: true });

  if (!Capacitor.isNativePlatform()) return true;
  if (options.isCancelled?.()) return false;

  // Straight to the native request — no visibility poll, no waiting period, no
  // second opinion. SnowKeyboardPlugin restarts the input connection so the IME
  // reads THIS field, asks politely so the layout is the field's own, and
  // forces only when that is refused, which is the normal answer on a TV in
  // non-touch mode.
  try {
    const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
    await SnowKeyboard.show();
    return true;
  } catch (error) {
    console.warn('[DPadKeyboard] Unable to show the keyboard:', error);
    return false;
  }
};
