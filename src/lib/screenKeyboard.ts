/**
 * Shared on-screen keyboard fallback — BROWSER PREVIEW ONLY.
 *
 * The installed Android / Fire TV app asks the platform for its own system
 * keyboard (see `src/utils/dpadKeyboard.ts`) and nothing here runs there. A
 * desktop browser has no system IME to summon, so the preview gets a keyboard
 * the app draws itself, driven by the same arrows + OK the remote sends.
 *
 * Mobile / tablet browsers raise their own keyboard on focus, so they are gated
 * out too: two keyboards at once is worse than one.
 */
import { Capacitor } from '@capacitor/core';
import { markKeyboardHidden, markKeyboardVisible } from '@/utils/keyboardVisibility';

export type EditableField = HTMLInputElement | HTMLTextAreaElement;

/** Input types that hold real typed text (a checkbox or a slider must not open it). */
const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'url', 'tel', 'search', 'number', '']);

export const isEditableField = (el: Element | null): el is EditableField => {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).disabled && !(el as HTMLTextAreaElement).readOnly;
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (input.disabled || input.readOnly) return false;
  return TEXT_INPUT_TYPES.has((input.getAttribute('type') ?? 'text').toLowerCase());
};

/**
 * Capability decision, deliberately narrow: not native, and a desktop-class
 * pointer (a real mouse / trackpad). That is exactly the Lovable preview on a
 * computer, and excludes the APK and phone/tablet browsers.
 */
export const screenKeyboardAvailable = (): boolean => {
  try {
    if (Capacitor.isNativePlatform()) return false;
  } catch {
    /* no Capacitor: treat as web */
  }
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
};

let target: EditableField | null = null;
const listeners = new Set<(el: EditableField | null) => void>();

const emit = () => {
  listeners.forEach((cb) => {
    try {
      cb(target);
    } catch {
      /* one listener must never break the others */
    }
  });
};

export const getScreenKeyboardTarget = () => target;

export const onScreenKeyboardChange = (cb: (el: EditableField | null) => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

/** Open (or move) the shared keyboard onto a field. Returns false when unavailable. */
export const openScreenKeyboard = (el: Element | null | undefined): boolean => {
  if (!screenKeyboardAvailable() || !isEditableField(el ?? null)) return false;
  const field = el as EditableField;
  if (target === field) return true;
  target = field;
  // The rest of the app reads keyboard visibility from this one place, so Back
  // closes the keyboard before leaving the screen and Next/Done behave.
  markKeyboardVisible();
  emit();
  return true;
};

export const closeScreenKeyboard = () => {
  if (!target) return;
  target = null;
  markKeyboardHidden();
  emit();
};

/**
 * Write a value into a React-controlled input without breaking its state.
 * React tracks the last value it wrote on the DOM node, so a plain
 * `el.value = x` is silently reverted on the next render; going through the
 * prototype setter and dispatching a real `input` event is what React listens
 * for.
 */
export const setFieldValue = (el: EditableField, value: string, caret: number) => {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    /* number inputs do not support selection */
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Every editable field of the field's own form / screen, in DOM order. */
export const editableSiblings = (el: EditableField): EditableField[] => {
  const scope: ParentNode = el.form ?? document;
  return Array.from(scope.querySelectorAll<EditableField>('input, textarea'))
    .filter((f) => isEditableField(f) && f.offsetParent !== null);
};

/** True while the app-drawn keyboard owns the remote keys. */
export const isScreenKeyboardOpen = () => target !== null;
