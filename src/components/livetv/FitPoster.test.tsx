/**
 * Live TV › VOD's detail pages: the cover is sized by the height it is given
 * (a fixed-width 2:3 poster ran off the bottom of a 960×540 screen), keeps
 * its 2:3 shape without aspect-ratio (Chrome 66), and shows a wide picture whole.
 */
import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import FitPoster from './FitPoster';

const realH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
const withHeight = (h: number) => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.hasAttribute('data-fit-poster') ? h : 0; } });
};
afterEach(() => { if (realH) Object.defineProperty(HTMLElement.prototype, 'clientHeight', realH); });

const box = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-fit-poster]')!;

describe('FitPoster', () => {
  it('a short screen: as wide as a 2:3 poster that tall', () => {
    withHeight(390);
    const { container } = render(<FitPoster src="a.jpg" maxWidth={300} />);
    expect(box(container).style.width).toBe('260px');
    const frame = box(container).firstElementChild as HTMLElement;
    expect(frame.style.paddingBottom).toBe('150%');
    expect(frame.getAttribute('style')).not.toMatch(/aspect/);
  });

  it('a tall screen: never wider than maxWidth', () => {
    withHeight(900);
    const { container } = render(<FitPoster src="a.jpg" maxWidth={300} />);
    expect(box(container).style.width).toBe('300px');
  });

  it('a wide picture is shown whole; a tall one fills the frame', () => {
    withHeight(390);
    const { container } = render(<FitPoster src="wide.jpg" maxWidth={300} />);
    const img = container.querySelector('img')!;
    expect(img.className).toContain('object-cover');
    Object.defineProperty(img, 'naturalWidth', { configurable: true, value: 1280 });
    Object.defineProperty(img, 'naturalHeight', { configurable: true, value: 720 });
    fireEvent.load(img);
    expect(img.className).toContain('object-contain');
  });
});
