import { useEffect, useRef } from 'react';
import { isGlobalModalOpen } from './gameInput';

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

/**
 * The React focus graph is the source of truth for TV navigation. Some TV
 * WebViews keep `document.activeElement` on the previous button even after the
 * visible cursor has moved, which can otherwise turn OK on "Play Again" into
 * a click on Back. Prefer the single managed cursor when it exists; if the
 * screen is not using managed focus (or is temporarily inconsistent), fall
 * back to the browser's active element rather than guessing.
 */
export const resolveTvActivationTarget = (
  active: HTMLElement | null,
): HTMLElement | null => {
  if (typeof document === 'undefined') return active;
  const managed = Array.from(
    document.querySelectorAll<HTMLElement>('[data-tv-focused="true"]'),
  ).filter((element) => element.isConnected && !element.closest('[aria-hidden="true"]'));
  if (managed.length !== 1 || managed[0] === active) return active;

  // A direct pointer/native-focus change is allowed to win. The broken TV
  // case is specifically a stale Back focus (or body after a phase unmount)
  // while the managed cursor has already advanced to the next action.
  const activeIsStaleBack = !!active
    && active.getAttribute('data-focus-id') === 'back'
    && active.getAttribute('data-tv-focused') === 'false';
  const activeIsPage = !active
    || active === document.body
    || active === document.documentElement
    || !active.isConnected;
  return activeIsStaleBack || activeIsPage ? managed[0] : active;
};

const focusTvTarget = (target: HTMLElement): void => {
  if (document.activeElement === target) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    // Older Fire TV / Android System WebViews only implement focus() without
    // FocusOptions. Activation must still follow the visible cursor there.
    target.focus();
  }
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
      // A global modal owns input: never activate a control behind it.
      if (isGlobalModalOpen()) return;
      // Own the press: stop the browser's own click synthesis and any second
      // copy of this guard from activating the same control again.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || held.current) return;
      held.current = true;
      const target = resolveTvActivationTarget(document.activeElement as HTMLElement | null);
      if (target) focusTvTarget(target);
      handler.current(target);
    };
    const up = (event: KeyboardEvent) => {
      if (isSelectKey(event)) held.current = false;
    };
    /* A keyup can be lost when the system IME, a launcher overlay or app
       backgrounding steals focus mid-press. Releasing on blur and visibility
       change means OK can never end up permanently dead. */
    const release = () => { held.current = false; };

    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      held.current = false;
    };
  }, [enabled]);
};

/** Default activation: click the focused control once when it is usable. */
export const activateFocused = (target: HTMLElement | null): void => {
  if (isActivatable(target)) target.click();
};
