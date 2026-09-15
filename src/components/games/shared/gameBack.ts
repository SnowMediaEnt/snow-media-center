import { useCallback, useEffect, useRef } from 'react';

/**
 * Shared, wager-safe Back ownership for every casino game.
 *
 * A TV remote's Back arrives as Escape, Android KEYCODE_BACK (4), a "GoBack"
 * key name, or — on some launcher WebViews — Backspace. Exactly one press must
 * produce exactly one decision, and that decision must never silently abandon
 * a committed wager:
 *
 *   1. an open Fairness/details disclosure closes and nothing else happens,
 *   2. a request in flight, a running settle animation, or a committed round
 *      awaiting a decision keeps the player on the game and shows a localized
 *      "finish this hand first" note,
 *   3. only in a safe phase does the game actually exit, once.
 *
 * The listener runs in the capture phase on `window` and calls
 * stopImmediatePropagation, so no other Back handler in the app (including a
 * second copy of this guard) can act on the same press.
 */
export type BackOutcome = 'closed-details' | 'blocked' | 'exit';

export interface GameBackConfig {
  /** True while a Fairness/details disclosure is open. */
  isDetailsOpen?: () => boolean;
  /** Close that disclosure — called for the first Back press only. */
  closeDetails?: () => void;
  /** True while a request, reveal animation or committed round is unfinished. */
  isBusy?: () => boolean;
  /** Show the localized "finish this hand/spin first" message. */
  onBlocked?: () => void;
  /** Leave the game. Called at most once per physical Back press. */
  onExit: () => void;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Every Back shape a TV remote or launcher WebView can deliver. */
export const isBackKey = (event: KeyboardEvent): boolean => {
  const code = event.keyCode || (event as KeyboardEvent & { which?: number }).which || 0;
  if (code === 4) return true;
  const key = event.key;
  if (key === 'Escape' || key === 'Esc' || key === 'GoBack' || key === 'BrowserBack') return true;
  if (event.code === 'GoBack' || event.code === 'BrowserBack') return true;
  // Backspace is Back on several TV browsers, but never while typing.
  if (key === 'Backspace') return !isEditable(event.target);
  return false;
};

export const useGameBack = (config: GameBackConfig): { requestBack: () => BackOutcome } => {
  const cfg = useRef(config);
  cfg.current = config;
  const held = useRef(false);

  /** The single Back decision. The visible Back button calls this too. */
  const requestBack = useCallback((): BackOutcome => {
    const { isDetailsOpen, closeDetails, isBusy, onBlocked, onExit } = cfg.current;
    if (isDetailsOpen?.()) {
      closeDetails?.();
      return 'closed-details';
    }
    if (isBusy?.()) {
      onBlocked?.();
      return 'blocked';
    }
    onExit();
    return 'exit';
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      // Own the press outright: no other listener, anywhere, sees it.
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.repeat || held.current) return;
      held.current = true;
      requestBack();
    };
    const up = (event: KeyboardEvent) => {
      if (isBackKey(event)) held.current = false;
    };
    // A lost keyup (focus stolen by the system, app backgrounded) must never
    // leave Back permanently dead.
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
  }, [requestBack]);

  return { requestBack };
};
