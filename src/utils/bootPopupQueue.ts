/**
 * One-at-a-time gate for the popups that open on app start (welcome, pre-event
 * steps, update prompt, giveaway winners, broadcast alert).
 *
 * Each popup used to decide on its own by polling for an open Radix dialog.
 * Two popups mounted in the same render pass poll on synchronised timers, so
 * both saw an empty DOM and both opened — and one OK press, caught by both
 * capture-phase key handlers, dismissed (and permanently suppressed) both.
 *
 * A shared claim removes the race: only the holder opens, and it releases on
 * dismiss so the next one can take its turn.
 */

let holder: string | null = null;

/** Take the boot-popup slot for `id`, or report it is busy. */
export const claimBootPopup = (id: string): boolean => {
  if (holder !== null && holder !== id) return false;
  holder = id;
  return true;
};

/** Hand the slot back once the popup is dismissed (or unmounted unopened). */
export const releaseBootPopup = (id: string) => {
  if (holder === id) holder = null;
};

/** Who holds the slot now (tests, diagnostics). */
export const bootPopupHolder = (): string | null => holder;

/** Tests only: drop any holder left by a previous test. */
export const __resetBootPopupForTests = () => { holder = null; };

/**
 * Any popup on screen that a boot popup must wait behind: an aria-modal
 * overlay (the app's own popups, the update prompt, a device message), an
 * open Radix dialog, or a boot notice (data-notice-layer — on a TV it is not
 * aria-modal, so a check for aria-modal alone was blind to it and the two
 * stacked, one OK reaching both).
 */
export const OTHER_POPUP_SELECTOR =
  '[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-notice-layer]';

export const otherPopupOpen = (): boolean => {
  if (typeof document === 'undefined') return false;
  try { return document.querySelector(OTHER_POPUP_SELECTOR) !== null; } catch { return false; }
};
