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
  opts: { watchKeys?: boolean; deps?: ReadonlyArray<unknown>; initial?: boolean } = {},
): [boolean, () => void] {
  const { watchKeys = true, deps = [], initial = true } = opts;
  const [visible, setVisible] = useState(initial);
  const timerRef = useRef<number | null>(null);

  const poke = useCallback(() => {
    setVisible(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; setVisible(false); }, ms);
  }, [ms]);

  // Show on mount / when deps change.
  useEffect(() => {
    poke();
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poke, ...deps]);

  useEffect(() => {
    if (!watchKeys) return;
    const onKey = () => { poke(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [watchKeys, poke]);

  return [visible, poke];
}

export default useTransientVisible;
