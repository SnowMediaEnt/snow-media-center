import { Capacitor } from '@capacitor/core';

type Editable = HTMLInputElement | HTMLTextAreaElement;
type Listener = () => void;

let target: Editable | null = null;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach((listener) => listener());

export const canUseScreenKeyboard = () => {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return false;
  return window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;
};

export const isScreenKeyboardOpen = () => !Capacitor.isNativePlatform() && !!target?.isConnected;
export const getScreenKeyboardTarget = () => target?.isConnected ? target : null;

export const subscribeScreenKeyboard = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const openScreenKeyboard = (element: Editable) => {
  if (!canUseScreenKeyboard() || !element.isConnected || element.disabled || element.readOnly) return false;
  target = element;
  element.focus({ preventScroll: true });
  emit();
  return true;
};

export const closeScreenKeyboard = () => {
  if (!target) return;
  target = null;
  emit();
};

export const writeScreenKeyboardValue = (text: string) => {
  const element = getScreenKeyboardTarget();
  if (!element) return;
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  const next = element.value.slice(0, start) + text + element.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(element, next);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  const caret = start + text.length;
  element.setSelectionRange(caret, caret);
};

export const deleteScreenKeyboardValue = () => {
  const element = getScreenKeyboardTarget();
  if (!element) return;
  const start = element.selectionStart ?? element.value.length;
  const end = element.selectionEnd ?? start;
  if (start === 0 && end === 0) return;
  const deleteFrom = start === end ? start - 1 : start;
  const next = element.value.slice(0, deleteFrom) + element.value.slice(end);
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(element, next);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  element.setSelectionRange(deleteFrom, deleteFrom);
};

export const nextScreenKeyboardField = () => {
  const element = getScreenKeyboardTarget();
  const form = element?.form;
  if (!element || !form) return null;
  const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))
    .filter((field) => !field.disabled && !field.readOnly && field.type !== 'hidden');
  return fields[fields.indexOf(element) + 1] ?? null;
};