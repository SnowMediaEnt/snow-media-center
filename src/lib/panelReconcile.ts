// One panel reconcile per session, whoever asks first.
//
// Two places re-verify the streaming line against the panel a few seconds
// after the Player opens: LiveTV (to refresh the stored expiry) and
// usePlayerAccountSync (to stamp the website link on the sign-in record).
// For a website-signed-in viewer both ran, seconds apart, each an Xtream
// round-trip plus an edge function, both inside Plex's first screen. The
// second one learns nothing the first did not.

// How long a reconcile stands. A healthy line is re-checked every few
// hours; a line that is expired or expiring is re-checked every ten minutes,
// so a renewal still shows up promptly (the caller says which it is).
export const RECONCILE_EVERY_MS = 3 * 60 * 60 * 1000;
export const RECONCILE_URGENT_MS = 10 * 60 * 1000;
let lastAt = 0;

export const markReconciled = (): void => { lastAt = Date.now(); };
export const reconciledRecently = (windowMs: number = RECONCILE_EVERY_MS): boolean =>
  lastAt > 0 && Date.now() - lastAt < windowMs;
/** Tests only. */
export const __resetPanelReconcileForTests = (): void => { lastAt = 0; };
