import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';

/**
 * The on-screen keyboard's action key (Done / Go / Next / Enter) on a sign-in
 * field.
 *
 * Android TV keyboards (Gboard for TV, Leanback, Amazon's) hand the action to
 * the WebView as an Enter keydown — keyCode 13, event.key usually 'Enter' but
 * 'Unidentified' or a bare 'Go' / 'Done' / 'Next' on some builds. Left alone,
 * that Enter either submits the form behind the viewer's back (a Sign in they
 * never pressed) or does nothing and leaves the keyboard covering the screen.
 *
 * What it does instead, for screens that do not run useTVFocus (which has the
 * same rule built in): on a field with more fields after it, move to the next
 * one with the keyboard along; on the last field, put the keyboard away and
 * land on the form's button so one OK press signs in. It never submits.
 */

const ACTION_KEYS = ['Enter', 'Go', 'Done', 'Next', 'Select'];

/** DPAD_CENTER (23) is left out on purpose: OK on a field means "let me type". */
export const isFieldActionKey = (e: { key?: string; code?: string; keyCode?: number }) =>
  (!!e.key && ACTION_KEYS.indexOf(e.key) >= 0)
  || e.code === 'Enter' || e.code === 'NumpadEnter'
  || e.keyCode === 13;

// Amazon's keyboard emits a parting Enter as it closes. It lands on the button
// we just moved to and would press it. Swallow OK keys for a moment after a
// landing, in the capture phase so no screen-level handler sees them either.
const LANDING_GRACE_MS = 700;

const swallowPartingEnter = (landed: HTMLElement) => {
  if (typeof window === 'undefined') return;
  const until = Date.now() + LANDING_GRACE_MS;
  const onKey = (ev: KeyboardEvent) => {
    if (Date.now() > until) { window.removeEventListener('keydown', onKey, true); return; }
    if (!isFieldActionKey(ev) && ev.key !== ' ') return;
    if (ev.target !== landed && document.activeElement !== landed) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  };
  window.addEventListener('keydown', onKey, true);
  window.setTimeout(() => window.removeEventListener('keydown', onKey, true), LANDING_GRACE_MS + 50);
};

const isTypable = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return ['text', 'password', 'email', 'search', 'tel', 'url', 'number', ''].indexOf(type) >= 0;
};

const isUsableField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  isTypable(el) && !el.disabled && !el.readOnly;

interface Options {
  /** Where to look for the next field and the button. Default: the field's own form. */
  container?: ParentNode | null;
  /** The button to land on after the last field (id). Default: the form's submit button. */
  buttonId?: string;
  /** Called with whatever received focus, so a screen with its own highlight can follow. */
  onLand?: (el: HTMLElement) => void;
}

/**
 * Wire to a field's onKeyDown. Returns true when the key was the keyboard's
 * action key and has been dealt with (the caller has nothing more to do).
 */
export function onFieldActionKey(e: ReactKeyboardEvent<HTMLElement>, opts: Options = {}): boolean {
  if (!isFieldActionKey(e)) return false;
  const field = e.currentTarget as HTMLInputElement;
  if (!isTypable(field)) return false;
  // Mid-composition (word suggestions) is not an action.
  if (e.nativeEvent?.isComposing || e.keyCode === 229) return false;
  // A multiline box keeps its newline.
  if (field.tagName === 'TEXTAREA') return false;

  // Never submit from the keyboard; the button is the viewer's to press.
  e.preventDefault();
  e.stopPropagation();
  // An empty field: nothing to be done with yet, and no jumping past it.
  if (!field.value) return true;

  const container: ParentNode | null = opts.container ?? field.form ?? null;
  if (container) {
    const fields = Array.prototype.slice.call(
      container.querySelectorAll('input, textarea'),
    ) as Element[];
    const idx = fields.indexOf(field);
    const next = idx >= 0 ? fields.slice(idx + 1).find(isUsableField) : undefined;
    if (next) {
      void focusTextInputForDpad(next);
      opts.onLand?.(next);
      return true;
    }
  }

  const button = (opts.buttonId ? document.getElementById(opts.buttonId) : null)
    ?? field.form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]')
    ?? null;
  // Blur closes the keyboard in the WebView; the plugin call covers the rest.
  void hideKeyboardForDpad(field);
  if (button) {
    swallowPartingEnter(button);
    button.focus();
    opts.onLand?.(button);
  }
  return true;
}
