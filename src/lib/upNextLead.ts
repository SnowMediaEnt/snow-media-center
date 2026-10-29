// When "Up next" comes up without a credits marker: Plex episodes whose
// server never ran credits detection, and every Live TV series episode (a
// panel has no markers). A minute before the end (the old 20 s fell deep in
// the credits), or for a short episode 5% of it, at least 20 s.
export const NO_CREDITS_LEAD = 60;
export const NO_CREDITS_MIN_LEAD = 20;

/** Seconds before the end that Up Next shows, for an episode `duration` s long. */
export function upNextLeadSeconds(duration: number): number {
  if (!(duration > 0)) return NO_CREDITS_MIN_LEAD;
  return Math.max(NO_CREDITS_MIN_LEAD, Math.min(NO_CREDITS_LEAD, Math.round(duration * 0.05)));
}
