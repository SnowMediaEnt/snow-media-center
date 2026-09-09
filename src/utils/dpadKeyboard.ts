import { Capacitor } from '@capacitor/core';
import { markKeyboardHidden } from '@/utils/keyboardVisibility';

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
  element: HTMLInputElement | HTMLTextAreaElement | null | undefined
): Promise<boolean> => {
  if (!element || element.disabled) return false;

  // No blur/refocus dance and no inputmode juggling: the app does not suppress
  // the keyboard any more, so the input connection Android builds on focus is
  // already the right one. Blurring first only tore that connection down and,
  // on TV WebViews, left the keyboard unable to appear at all.
  element.focus({ preventScroll: true });
  element.click();

  try {
    const end = element.value?.length ?? 0;
    element.setSelectionRange(end, end);
  } catch {
    // Some input types do not support selection ranges.
  }

  if (!Capacitor.isNativePlatform()) return true;

  let requested = false;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
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
  try {
    const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
    await SnowKeyboard.show();
    requested = true;
  } catch (error) {
    console.warn('[DPadKeyboard] Forced keyboard fallback unavailable:', error);
  }

  return requested;
};
