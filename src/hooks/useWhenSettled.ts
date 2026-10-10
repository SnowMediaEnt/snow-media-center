import { useEffect, useRef } from 'react';

/** How long a channel list must rest before the rows on it ask for their
 *  programme info (a finger's fling or a held remote key moves it every frame). */
export const ROWS_SETTLE_MS = 250;

/**
 * Runs `run` once `key` (what is on screen, as a string) has stayed the same
 * for `ms`. Live TV and the Guide asked the panel for the programme info of
 * every row a fling passed (625 requests flicking 640 channels to the end, and
 * again on the way back once the early ones had been pushed out of the cache):
 * now only the rows the list comes to rest on are asked for. A re-render that
 * leaves `key` as it was neither restarts the wait nor runs it again.
 */
export function useWhenSettled(key: string, run: () => void, ms: number = ROWS_SETTLE_MS): void {
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    const t = window.setTimeout(() => runRef.current(), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
}
