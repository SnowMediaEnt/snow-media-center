// Keep a focused row visible inside its own scroll container, by adjusting
// only that container's scrollTop (never scrollIntoView, which also scrolls
// ancestors on a TV WebView). Measured from the DOM, and against the screen
// as well as the container: on some boxes the pane runs past the bottom of
// the visible screen, so "inside the pane" was not "on screen".
export function keepInView(container: HTMLElement, el: HTMLElement, pad = 8): void {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const viewH = window.innerHeight || document.documentElement.clientHeight || c.bottom;
  const top = Math.max(c.top, 0);
  const bottom = Math.min(c.bottom, viewH);
  if (bottom - top < r.height) return; // pane too short to help; leave it
  if (r.top - pad < top) container.scrollTop -= top - (r.top - pad);
  else if (r.bottom + pad > bottom) container.scrollTop += r.bottom + pad - bottom;
}
