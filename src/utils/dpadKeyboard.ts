import { Capacitor } from '@capacitor/core';

export const hideKeyboardForDpad = async (
  element?: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
) => {
  element?.blur();

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
 * Focus a field and ask for the on-screen keyboard.
 *
 * Returns whether the keyboard was actually asked for successfully. Callers use
 * this instead of assuming: a caller that records "the keyboard is open" when it
 * never opened turns the next OK press into the keyboard's Next key, which walks
 * the viewer down the form and submits it empty.
 */
export const focusTextInputForDpad = async (
  element: HTMLInputElement | HTMLTextAreaElement | null | undefined
): Promise<boolean> => {
  if (!element || element.disabled) return false;

  element.focus({ preventScroll: true });
  element.click();

  try {
    const end = element.value?.length ?? 0;
    element.setSelectionRange(end, end);
  } catch {
    // Some input types do not support selection ranges.
  }

  if (!Capacitor.isNativePlatform()) return true;
  try {
    const { Keyboard } = await import('@capacitor/keyboard');
    await Keyboard.show();
    return true;
  } catch (error) {
    // A missing plugin registration lands here, and used to be swallowed into a
    // console.warn that production strips — the field simply never opened and
    // nothing said why.
    console.warn('[DPadKeyboard] Unable to show native keyboard:', error);
    return false;
  }
};