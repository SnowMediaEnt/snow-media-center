import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import ScrollText, { SCROLL_TEXT_PAUSE_MS, SCROLL_TEXT_PX_PER_SEC } from './ScrollText';

// jsdom has no layout: give the box, the text and the gap fixed widths.
const BOX = 100;
const TEXT = 160;
const GAP = 30;

let animate: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  cancel = vi.fn();
  animate = vi.fn(() => ({ cancel }));
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(BOX);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(TEXT);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('aria-hidden') === 'true' && !this.textContent ? GAP : TEXT;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
});

describe('ScrollText', () => {
  it('stays still and cut off when not highlighted', () => {
    const { container } = render(<ScrollText text="USA BLACK ENTERTAINMENT" active={false} />);
    expect(animate).not.toHaveBeenCalled();
    expect(container.textContent).toBe('USA BLACK ENTERTAINMENT');
  });

  it('scrolls one way like a ticker when highlighted: pause, then text + gap at a readable speed, forever', () => {
    const { container } = render(<ScrollText text="Snow Originals" active />);
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, opts] = animate.mock.calls[0] as [Array<{ transform: string; offset: number }>, KeyframeAnimationOptions];
    const dist = TEXT + GAP;
    const total = SCROLL_TEXT_PAUSE_MS + (dist / SCROLL_TEXT_PX_PER_SEC) * 1000;
    expect(frames[0].transform).toBe('translate3d(0, 0, 0)');
    expect(frames[1]).toEqual({ transform: 'translate3d(0, 0, 0)', offset: SCROLL_TEXT_PAUSE_MS / total });
    expect(frames[2]).toEqual({ transform: `translate3d(-${dist}px, 0, 0)`, offset: 1 });
    expect(opts).toMatchObject({ duration: total, iterations: Infinity, easing: 'linear' });
    // Never bounces back: no alternate direction.
    expect(opts.direction).toBeUndefined();
    // The repeat is there for the loop, hidden from screen readers.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(2);
  });

  it('never moves text that fits', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(BOX);
    render(<ScrollText text="Guide" active />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('stops when the highlight leaves', () => {
    const { rerender } = render(<ScrollText text="Snow Originals" active />);
    rerender(<ScrollText text="Snow Originals" active={false} />);
    expect(cancel).toHaveBeenCalled();
  });
});
