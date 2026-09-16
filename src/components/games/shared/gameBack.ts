import { useCallback, useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isGlobalModalOpen } from './gameInput';

/**
 * Shared, wager-safe Back ownership for every casino game.
 *
 * A TV remote's Back arrives as Escape, Android KEYCODE_BACK (4), a "GoBack"
 * key name, or — on some launcher WebViews — Backspace. On a real Fire TV /
 * Android TV APK it does NOT reach the page as a keydown at all: it arrives on
 * Capacitor's App.backButton listener. This hook owns BOTH paths so that
 * exactly one press produces exactly one decision, and that decision never
 * silently abandons a committed wager:
 *
 *   1. an open Fairness/details disclosure closes and nothing else happens,
 *   2. a request in flight, a running settle animation, or a committed round
 *      awaiting a decision keeps the player on the game and shows a localized
 *      "finish this hand first" note,
 *   3. only in a safe phase does the game actually exit, once.
 *
 * While the guard is mounted it raises `window.__gameOwnsBack`, which
 * useNavigation checks before popping a route, so the app's own native Back
 * handler yields instead of tearing the table down under the player. Devices
 * that deliver a single press through BOTH the native listener and the DOM are
 * de-duplicated by one shared press latch.
 *
 * A global modal (auto-update, download progress, any aria-modal overlay) owns
 * input outright: the guard yields the press untouched.
 */
export type BackOutcome = 'closed-details' | 'blocked' | 'exit' | 'yielded';

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

type BackOwnerWindow = Window & { __gameOwnsBack?: boolean };

/**
 * Ownership is reference counted: StrictMode double-invokes effects and a
 * player can cross-fade between two games, so the flag may only drop when the
 * LAST guard unmounts.
 */
let ownerCount = 0;

const claimOwnership = (): (() => void) => {
  ownerCount += 1;
  (window as BackOwnerWindow).__gameOwnsBack = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    ownerCount = Math.max(0, ownerCount - 1);
    if (ownerCount === 0) (window as BackOwnerWindow).__gameOwnsBack = false;
  };
};

/** True while any casino game owns hardware Back. Read by useNavigation. */
export const gameOwnsHardwareBack = (): boolean =>
  typeof window !== 'undefined' && (window as BackOwnerWindow).__gameOwnsBack === true;

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

/** A native press has no keyup, so its latch releases itself. */
const NATIVE_RELEASE_MS = 400;

export const useGameBack = (config: GameBackConfig): { requestBack: () => BackOutcome } => {
  const cfg = useRef(config);
  cfg.current = config;
  /** Shared by the DOM and native paths: one physical press, one decision. */
  const held = useRef(false);

  /** The single Back decision. The visible Back button calls this too. */
  const requestBack = useCallback((): BackOutcome => {
    if (isGlobalModalOpen()) return 'yielded';
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
    const release = () => { held.current = false; };
    const releaseOwnership = claimOwnership();

    const down = (event: KeyboardEvent) => {
      if (!isBackKey(event)) return;
      // A global modal owns input: leave the press completely untouched.
      if (isGlobalModalOpen()) return;
      // Own the press outright: no other listener, anywhere, sees it.
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      if (event.repeat || held.current) return;
      held.current = true;
      requestBack();
    };
    const up = (event: KeyboardEvent) => {
      if (isBackKey(event)) release();
    };

    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    // A lost keyup (focus stolen by the system, app backgrounded) must never
    // leave Back permanently dead.
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);

    /**
     * Native hardware Back. It is delivered as a direct callback, not as a
     * synthesized keydown: synthesizing only a press would leave the shared
     * latch stuck with no matching release.
     */
    let nativeHandle: { remove?: () => void } | undefined;
    let nativeReleaseTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const onNativeBack = () => {
      if (cancelled) return;
      if (isGlobalModalOpen()) return;
      if (held.current) return; // the same press already arrived via the DOM
      held.current = true;
      // Pair the press with its own release: no keyup follows a native Back.
      nativeReleaseTimer = setTimeout(release, NATIVE_RELEASE_MS);
      requestBack();
    };

    (async () => {
      try {
        const handle = await CapApp.addListener('backButton', onNativeBack);
        if (cancelled) handle?.remove?.();
        else nativeHandle = handle;
      } catch {
        // Not running natively: the DOM path above is the only Back there is.
      }
    })();

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', release);
      if (nativeReleaseTimer) clearTimeout(nativeReleaseTimer);
      nativeHandle?.remove?.();
      held.current = false;
      releaseOwnership();
    };
  }, [requestBack]);

  return { requestBack };
};
