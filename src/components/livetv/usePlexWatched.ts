// The watched checks (plexProgress) for one list of Plex posters. A list
// calls this ONCE and hands each tile a plain `watched` flag: a check that
// changes redraws the list, its memoised tiles skip unless their own flag
// moved, and a cursor move costs a map lookup per tile on screen. No tile
// listens for anything itself.
//
// Held while a title plays: the lists sit hidden under the player, and a
// film being finished would otherwise redraw them behind it. They catch up
// as it closes.
import { useSyncExternalStore } from 'react';
import { isPlexPlaybackActive, onPlexPlaybackActiveChange } from '@/lib/plex';
import { plexWatchedVersion, PLEX_WATCHED_EVENT } from '@/lib/plexProgress';

let held = -1;
const snapshot = (): number => {
  if (held < 0 || !isPlexPlaybackActive()) held = plexWatchedVersion();
  return held;
};
const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener(PLEX_WATCHED_EVENT, cb);
  const off = onPlexPlaybackActiveChange(() => cb());
  return () => { window.removeEventListener(PLEX_WATCHED_EVENT, cb); off(); };
};

/** Re-renders the caller when a check may have changed. The number itself
 *  means nothing; read the checks with plexItemWatched and friends. */
export function usePlexWatched(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
