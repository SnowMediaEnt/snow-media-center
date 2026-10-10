/**
 * Plex posters: the small copy first, then — once nothing else is loading —
 * a sharp copy sized to the pixels the poster covers, swapped in only after
 * it has loaded. Never while a film plays, and never while browsing is still
 * pulling in small posters.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/platform', async (orig) => ({ ...(await orig<typeof import('@/utils/platform')>()), isNativePlatform: () => false }));

import PlexImage, { UPGRADE_QUIET_MS, __resetPlexImageUpgradesForTests, clearPlexImageCache } from './PlexImage';
import { setPlexPlaybackActive } from '@/lib/plex';

const BASE = 'https://plex.test:32400';
const TOKEN = 'tok';

// Preloads made by the upgrade pass (new Image()).
let preloads: Array<{ src: string; onload: (() => void) | null; onerror: (() => void) | null }> = [];
class FakeImage {
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(v: string) { preloads.push({ src: v, onload: () => this.onload?.(), onerror: () => this.onerror?.() }); }
}

const widthOf = (url: string) => Number(new URL(url).searchParams.get('width'));
const heightOf = (url: string) => Number(new URL(url).searchParams.get('height'));

beforeEach(() => {
  vi.useFakeTimers();
  preloads = [];
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('IntersectionObserver', undefined);
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  // Every poster is a 104x156 box on screen.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 114, bottom: 166, width: 104, height: 156, toJSON: () => ({}) } as DOMRect);
  clearPlexImageCache();
  setPlexPlaybackActive(false);
  __resetPlexImageUpgradesForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const poster = (path: string) => <PlexImage base={BASE} path={path} token={TOKEN} w={140} h={210} />;

describe('Plex poster sharp-art pass', () => {
  it('shows the small copy first, then swaps in a sharp copy sized to the screen once loading settles', () => {
    const { container } = render(poster('/library/metadata/1/thumb/1'));
    const img = container.querySelector('img')!;
    expect(widthOf(img.src)).toBe(140);
    act(() => { fireEvent.load(img); });
    // Nothing yet: the quiet period hasn't passed.
    expect(preloads).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS + 10); });
    expect(preloads).toHaveLength(1);
    // 104 px drawn x 2 = 208, rounded up to 220; same 2:3 shape.
    expect(widthOf(preloads[0].src)).toBe(220);
    expect(heightOf(preloads[0].src)).toBe(330);
    // Still the small copy until the sharp one has loaded: no flash.
    expect(widthOf(container.querySelector('img')!.src)).toBe(140);
    act(() => { preloads[0].onload?.(); });
    expect(widthOf(container.querySelector('img')!.src)).toBe(220);
  });

  it('waits while other small posters are still loading', () => {
    const a = render(poster('/library/metadata/1/thumb/1'));
    render(poster('/library/metadata/2/thumb/1')); // still loading
    act(() => { fireEvent.load(a.container.querySelector('img')!); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS * 2); });
    expect(preloads).toHaveLength(0);
  });

  it('never runs while a film plays, and resumes after', () => {
    setPlexPlaybackActive(true);
    const { container } = render(poster('/library/metadata/1/thumb/1'));
    act(() => { fireEvent.load(container.querySelector('img')!); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS * 3); });
    expect(preloads).toHaveLength(0);
    act(() => { setPlexPlaybackActive(false); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS + 10); });
    expect(preloads).toHaveLength(1);
  });

  it('a poster coming back paints sharp at once', () => {
    const first = render(poster('/library/metadata/1/thumb/1'));
    act(() => { fireEvent.load(first.container.querySelector('img')!); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS + 10); });
    act(() => { preloads[0].onload?.(); });
    first.unmount();
    const again = render(poster('/library/metadata/1/thumb/1'));
    expect(widthOf(again.container.querySelector('img')!.src)).toBe(220);
  });

  it('keeps the small copy when the sharp one fails', () => {
    const { container } = render(poster('/library/metadata/1/thumb/1'));
    act(() => { fireEvent.load(container.querySelector('img')!); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS + 10); });
    act(() => { preloads[0].onerror?.(); });
    expect(widthOf(container.querySelector('img')!.src)).toBe(140);
  });

  it('does nothing on a screen that already shows the small copy pixel for pixel', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    const { container } = render(poster('/library/metadata/1/thumb/1'));
    act(() => { fireEvent.load(container.querySelector('img')!); });
    act(() => { vi.advanceTimersByTime(UPGRADE_QUIET_MS * 2); });
    expect(preloads).toHaveLength(0);
  });
});
