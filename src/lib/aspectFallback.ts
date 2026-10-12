// CSS aspect-ratio is Chrome 88. On an engine without it (an X96 X4 on
// Android 11 ships Chrome 83-86, the Android 9 boxes Chrome 66) a box sized
// only by `aspect-video` has no height at all. For a box the native player
// draws in, that left the player with no box: it stayed full screen behind
// the page, the channel heard and its picture a shadow under the dark page
// (owner, 2026-10-12). Such boxes are given their 16:9 height in code.

/** CSS aspect-ratio works in this engine. */
export const aspectRatioSupported = (): boolean => {
  try {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('aspect-ratio', '16 / 9');
  } catch {
    return false;
  }
};

/** Give `el` the 16:9 height of its width, where aspect-ratio does not work.
 *  Its max-height still applies. Writes only when the height changes (it is
 *  called from a ResizeObserver, and a write that changed nothing would
 *  loop). True when it wrote. */
export function fitSixteenNine(el: HTMLElement, supported: boolean = aspectRatioSupported()): boolean {
  if (supported) return false;
  const w = el.getBoundingClientRect().width;
  if (!(w > 0)) return false;
  const want = `${Math.round((w * 9) / 16)}px`;
  if (el.style.height === want) return false;
  el.style.height = want;
  return true;
}
