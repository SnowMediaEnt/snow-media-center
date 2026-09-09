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

export const focusTextInputForDpad = async (
  element: HTMLInputElement | HTMLTextAreaElement | null | undefined
) => {
  if (!element || element.disabled) return;

  element.focus({ preventScroll: true });
  element.click();

  try {
    const end = element.value?.length ?? 0;
    element.setSelectionRange(end, end);
  } catch {
    // Some input types do not support selection ranges.
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const { Keyboard } = await import('@capacitor/keyboard');
      await Keyboard.show();
    } catch (error) {
      console.warn('[DPadKeyboard] Unable to show native keyboard:', error);
    }
  }
};