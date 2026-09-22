// One panel reconcile per session, whoever asks first.
//
// Two places re-verify the streaming line against the panel a few seconds
// after the Player opens: LiveTV (to refresh the stored expiry) and
// usePlayerAccountSync (to stamp the website link on the sign-in record).
// For a website-signed-in viewer both ran, seconds apart, each an Xtream
// round-trip plus an edge function, both inside Plex's first screen. The
// second one learns nothing the first did not.

const RECENT_MS = 10 * 60 * 1000;
let lastAt = 0;

export const markReconciled = (): void => { lastAt = Date.now(); };
export const reconciledRecently = (): boolean => Date.now() - lastAt < RECENT_MS;
/** Tests only. */
export const __resetPanelReconcileForTests = (): void => { lastAt = 0; };
