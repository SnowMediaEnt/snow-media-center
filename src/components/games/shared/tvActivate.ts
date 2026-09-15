import { useEffect, useRef } from 'react';

/**
 * Shared TV activation guard for the games section.
 *
 * Fire TV / Android TV remotes deliver OK as Enter, Space, "Select" or
 * DPAD_CENTER (keyCode 23) and repeat it while the key is held. The browser
 * also synthesises its own click for Enter/Space on a focused button, which
 * would double-fire a socket call. This guard:
 *  - prevents the browser's duplicate activation,
 *  - activates the focused control exactly once per physical press,
 *  - swallows every repeat until keyup, even if the previous ack already
 *    resolved,
 *  - leaves mouse/touch clicks completely alone.
 *
 * Back stays globally owned by Index; only an open details/fairness overlay
 * may capture one Back to close itself.
 */
const SELECT_KEYS = new Set(['Enter', ' ', 'Spacebar', 'Select']);

export const isSelectKey = (event: KeyboardEvent): boolean =>
  SELECT_KEYS.has(event.key) || event.code === 'Space' || event.keyCode === 23;

export const isActivatable = (el: Element | null | undefined): el is HTMLElement => {
  if (!el || !(el instanceof HTMLElement)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('data-busy') === 'true') return false;
  return true;
};

export const useTvActivate = (
  onActivate: (target: HTMLElement | null) => void,
  enabled = true,
): void => {
  const held = useRef(false);
  const handler = useRef(onActivate);
  handler.current = onActivate;

  useEffect(() => {
    if (!enabled) return;
    const down = (event: KeyboardEvent) => {
      if (!isSelectKey(event)) return;
      // Stop the browser's own click synthesis so we never activate twice.
      event.preventDefault();
      if (event.repeat || held.current) return;
      held.current = true;
      handler.current(document.activeElement as HTMLElement | null);
    };
    const up = (event: KeyboardEvent) => {
      if (isSelectKey(event)) held.current = false;
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      held.current = false;
    };
  }, [enabled]);
};

/** Default activation: click the focused control once when it is usable. */
export const activateFocused = (target: HTMLElement | null): void => {
  if (isActivatable(target)) target.click();
};
