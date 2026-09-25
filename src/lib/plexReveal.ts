// Bring a whole Plex rail — its heading, the posters and the focused
// poster's lift and ring — into the page's scroll view.
//
// The focused tile scrolls itself into view (scrollIntoView 'nearest'), but
// that only brings the TILE's own box to the scroller's edge: moving Up, the
// rail's heading and the 8 px above the poster (where the 1.06 lift and the
// 3 px ring are drawn) were left above the top, and the edge itself is the
// scroller's border box — the 3.5vh of padding kept clear for the TV's
// overscan counts as visible to scrollIntoView, so even a rail brought to
// the top sat partly under the overscan. This scrolls the page just enough
// that the rail box sits inside the scroller's PADDING box: its top below
// the top padding, its bottom above the bottom padding.
//
// Plain getBoundingClientRect / getComputedStyle / scrollTop: Chromium 66
// has no scroll-padding / scroll-margin (69+) to ask scrollIntoView for this.

/** Marks the scroller the Plex pages scroll in (PlexSection's content column). */
export const PLEX_SCROLLER_ATTR = 'data-plex-scroller';

/** Scroll `scroller` so that all of `el`, and `margin` px around it, sits
 *  inside its padding box. Only as far as needed; a box taller than the view
 *  gets its top shown. */
export function revealInScroller(el: HTMLElement, scroller: HTMLElement, margin = 0): void {
  let padT = 0;
  let padB = 0;
  try {
    const cs = window.getComputedStyle(scroller);
    padT = parseFloat(cs.paddingTop) || 0;
    padB = parseFloat(cs.paddingBottom) || 0;
  } catch { /* no padding then */ }
  const s = scroller.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const viewTop = s.top + scroller.clientTop + padT + margin;
  const viewBottom = s.top + scroller.clientTop + scroller.clientHeight - padB - margin;
  let delta = 0;
  if (b.top < viewTop) delta = b.top - viewTop;
  else if (b.bottom > viewBottom) delta = Math.min(b.bottom - viewBottom, b.top - viewTop);
  if (delta !== 0) scroller.scrollTop += delta;
}

/** revealInScroller in the Plex page's scroller; the browser's own
 *  scrollIntoView when there is none (a panel rendered on its own). A rail
 *  box already holds its poster's lift and ring (its 8 px padding); a bare
 *  tile passes `margin` for them. */
export function revealPlexRail(el: HTMLElement | null | undefined, margin = 0): void {
  if (!el) return;
  const scroller = el.closest ? (el.closest(`[${PLEX_SCROLLER_ATTR}]`) as HTMLElement | null) : null;
  if (scroller) revealInScroller(el, scroller, margin);
  else if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
