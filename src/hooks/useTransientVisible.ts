import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A flag that is true for `ms` after mount and after every `poke()`, then
 * flips false. Used for player chrome that should not sit on screen for the
 * whole film — the title in the corner, the "Vol 60%" pill, etc.
 *
 * `watchKeys` re-shows on ANY keydown (capture phase, never consumes the
 * event) so a viewer can tap a D-pad key to check what is playing without
 * the component having to thread `poke` through every key handler.
 *
 * `deps` re-shows when they change (e.g. the title switched to the next
 * episode). Pass a stable array literal.
 */
export function useTransientVisible(
  ms = 4000,
  opts: { watchKeys?: boolean; deps?: ReadonlyArray<unknown>; initial?: boolean; enabled?: boolean } = {},
): [boolean, () => void] {
  // `enabled: false` parks the flag: hidden, no timer, no re-shows. For chrome
  // that only exists some of the time (the player's title bar), so its timer
  // does not re-render the host while the chrome is not even on screen.
  const { watchKeys = true, deps = [], initial = true, enabled = true } = opts;
  const [visible, setVisible] = useState(initial && enabled);
  const timerRef = useRef<number | null>(null);

  const poke = useCallback(() => {
    setVisible(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; setVisible(false); }, ms);
  }, [ms]);

  // Show on mount / when deps change (or when it becomes enabled).
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      setVisible(false);
      return;
    }
    poke();
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poke, enabled, ...deps]);

  useEffect(() => {
    if (!watchKeys || !enabled) return;
    const onKey = () => { poke(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [watchKeys, enabled, poke]);

  return [visible, poke];
}

export default useTransientVisible;
