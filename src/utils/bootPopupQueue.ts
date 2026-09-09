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
