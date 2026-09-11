import { Capacitor } from '@capacitor/core';
import { isNativeKeyboardVisible, markKeyboardHidden } from '@/utils/keyboardVisibility';
import { closeScreenKeyboard, openScreenKeyboard } from '@/lib/screenKeyboard';

export const hideKeyboardForDpad = async (
  element?: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
) => {
  element?.blur();
  markKeyboardHidden();
  closeScreenKeyboard();

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

  // Desktop browsers have no system IME to summon, so use the app-rendered
  // keyboard. Phone/tablet browsers are excluded by its capability gate and
  // continue using their own keyboard without a duplicate overlay.
  if (!Capacitor.isNativePlatform()) return !cancelled() && openScreenKeyboard(element);

  let requested = false;
  if (cancelled()) return false;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    if (cancelled()) return false;
    await Keyboard.show();
    requested = true;
  } catch (error) {
    // A missing plugin registration lands here. Do not give up: the native
    // fallback below can still raise the keyboard on TV devices.
    console.warn('[DPadKeyboard] Unable to show native keyboard:', error);
    if (cancelled()) return false;
    try {
      const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
      if (cancelled()) return false;
      await SnowKeyboard.show();
      return !cancelled();
    } catch (fallbackError) {
      console.warn('[DPadKeyboard] Keyboard fallback unavailable:', fallbackError);
      return false;
    }
  }

  // Fire TV and some Android TV launchers accept Keyboard.show() and raise
  // nothing at all, so a fallback is needed — but ONLY then. Asking twice when
  // the first request already worked is what put a second, generic keyboard on
  // screen instead of the usual one. Give the platform a moment to report
  // keyboardDidShow before deciding.
  if (cancelled()) return false;
  const showFallback = async () => {
    if (cancelled() || isNativeKeyboardVisible()) return false;
    try {
      const { SnowKeyboard } = await import('@/capacitor/SnowKeyboard');
      if (cancelled()) return false;
      await SnowKeyboard.show();
      return true;
    } catch (error) {
      console.warn('[DPadKeyboard] Keyboard fallback unavailable:', error);
      return false;
    }
  };

  if (!isNativeKeyboardVisible()) {
    // Do not keep the caller's request slot occupied during this grace period:
    // an accepted-but-invisible show must remain immediately retryable.
    window.setTimeout(() => { void showFallback(); }, 250);
  }

  return requested && !cancelled();
};
