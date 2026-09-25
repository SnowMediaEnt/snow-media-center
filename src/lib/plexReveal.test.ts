import { describe, expect, it, vi } from 'vitest';
import { revealInScroller, revealPlexRail } from './plexReveal';

// A 540-px-tall scroller at the top of the screen with the Plex page's
// padding: 3.5vh (19 px at 540) on top for the TV's overscan, 16 below.
// jsdom does no layout, so the boxes are given: the rail box moves up the
// screen as the scroller scrolls down.
function page(railTopInContent: number, railH = 236) {
  const scroller = document.createElement('div');
  scroller.setAttribute('data-plex-scroller', '');
  scroller.style.paddingTop = '19px';
  scroller.style.paddingBottom = '16px';
  Object.defineProperty(scroller, 'clientHeight', { value: 540 });
  Object.defineProperty(scroller, 'clientTop', { value: 0 });
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (v: number) => { scrollTop = Math.max(0, v); } });
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 540, left: 0, right: 900, width: 900, height: 540, x: 0, y: 0, toJSON() { return this; } });
  const rail = document.createElement('div');
  rail.getBoundingClientRect = () => {
    const top = 19 + railTopInContent - scrollTop;
    return { top, bottom: top + railH, left: 0, right: 900, width: 900, height: railH, x: 0, y: top, toJSON() { return this; } };
  };
  scroller.appendChild(rail);
  document.body.appendChild(scroller);
  return { scroller, rail, setScroll: (v: number) => { scrollTop = v; } };
}

describe('revealInScroller', () => {
  it('moving Up: a rail half above the top comes down to just under the overscan padding, heading and all', () => {
    // The tile's own scrollIntoView had put the POSTER's top at the scroller's
    // edge: the heading (28 px) and the 8 px of lift/ring room were above it.
    const { scroller, rail, setScroll } = page(1000);
    setScroll(1000 + 19 + 36);
    revealInScroller(rail, scroller);
    expect(rail.getBoundingClientRect().top).toBe(19);
    expect(scroller.scrollTop).toBe(1000);
  });

  it('moving Down: a rail below the view comes up to sit above the bottom padding', () => {
    const { scroller, rail } = page(600);
    revealInScroller(rail, scroller);
    expect(rail.getBoundingClientRect().bottom).toBe(540 - 16);
  });

  it('leaves a rail that is already wholly in view where it is', () => {
    const { scroller, rail, setScroll } = page(300);
    setScroll(100);
    revealInScroller(rail, scroller);
    expect(scroller.scrollTop).toBe(100);
  });

  it('a box taller than the view shows its top', () => {
    const { scroller, rail } = page(800, 700);
    revealInScroller(rail, scroller);
    expect(rail.getBoundingClientRect().top).toBe(19);
  });

  it('keeps a margin around a bare tile for its lift and ring', () => {
    const { scroller, rail, setScroll } = page(1000, 200);
    setScroll(1000);
    revealInScroller(rail, scroller, 12);
    expect(rail.getBoundingClientRect().top).toBe(19 + 12);
  });
});

describe('revealPlexRail', () => {
  it('finds the Plex page scroller, and falls back to scrollIntoView outside it', () => {
    const { rail, setScroll } = page(1000);
    setScroll(1100);
    revealPlexRail(rail);
    expect(rail.getBoundingClientRect().top).toBe(19);
    const loose = document.createElement('div');
    loose.scrollIntoView = vi.fn();
    document.body.appendChild(loose);
    revealPlexRail(loose);
    expect(loose.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(() => revealPlexRail(null)).not.toThrow();
  });
});
