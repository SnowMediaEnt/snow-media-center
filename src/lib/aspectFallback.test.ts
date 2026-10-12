// The Live TV preview boxes on an engine with no CSS aspect-ratio (owner,
// 2026-10-12, an X96 X4: the box had no height, the player stayed full
// screen behind the page): given their 16:9 height in code.
import { describe, expect, it } from 'vitest';
import { fitSixteenNine } from './aspectFallback';

const box = (width: number) => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  return el;
};

describe('a 16:9 box where aspect-ratio does not work', () => {
  it('gets the height of its width (the classic layout\'s 256 px box: 144 px)', () => {
    const el = box(256);
    expect(fitSixteenNine(el, false)).toBe(true);
    expect(el.style.height).toBe('144px');
  });

  it('writes only when the height changes (it runs from a ResizeObserver)', () => {
    const el = box(600);
    fitSixteenNine(el, false);
    expect(el.style.height).toBe('338px');
    expect(fitSixteenNine(el, false)).toBe(false);
  });

  it('leaves the box alone where aspect-ratio works, or while it has no width yet', () => {
    const el = box(256);
    expect(fitSixteenNine(el, true)).toBe(false);
    expect(el.style.height).toBe('');
    expect(fitSixteenNine(box(0), false)).toBe(false);
  });
});
