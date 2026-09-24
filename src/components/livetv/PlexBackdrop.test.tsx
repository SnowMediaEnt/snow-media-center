import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem } from '@/lib/plex';

vi.mock('@/lib/plex', () => ({
  plexPhotoTranscodeUrl: (base: string, path: string, _t: string, w: number, h: number) => `${base}/photo?w=${w}&h=${h}&url=${path}`,
}));

// Image loads are driven by the test: each `new Image()` is recorded, and
// the test decides when it loads or fails.
const made: FakeImage[] = [];
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  className = '';
  alt = '';
  style: Record<string, string> = {};
  private _src = '';
  el = document.createElement('img');
  constructor() { made.push(this); }
  set src(v: string) { this._src = v; this.el.setAttribute('src', v); }
  get src() { return this._src; }
  removeAttribute(n: string) { if (n === 'src') this._src = ''; }
}

const item = (k: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey: k, title: `T${k}`, type: 'movie', thumb: `/library/metadata/${k}/thumb/1`, ...extra });

beforeEach(async () => {
  vi.useFakeTimers();
  made.length = 0;
  vi.stubGlobal('Image', FakeImage);
  (await import('@/lib/plexBackdrop')).__resetBackdropForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('PlexBackdrop', () => {
  it('loads nothing while the highlight moves, and the rested title once it has rested', async () => {
    const { default: PlexBackdrop } = await import('./PlexBackdrop');
    const { focusBackdrop, BACKDROP_SETTLE_MS } = await import('@/lib/plexBackdrop');
    render(<PlexBackdrop base="http://pms" token="t" />);
    // A held D-pad: a move every 120 ms.
    for (let i = 0; i < 10; i++) { focusBackdrop(item(String(100 + i))); await act(async () => { vi.advanceTimersByTime(120); }); }
    expect(made).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(BACKDROP_SETTLE_MS); });
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe('http://pms/photo?w=960&h=540&url=/library/metadata/109/art');
  });

  it('leaving the rails (null) cancels a pending change', async () => {
    const { default: PlexBackdrop } = await import('./PlexBackdrop');
    const { focusBackdrop } = await import('@/lib/plexBackdrop');
    render(<PlexBackdrop base="http://pms" token="t" />);
    focusBackdrop(item('1'));
    await act(async () => { vi.advanceTimersByTime(200); });
    focusBackdrop(null);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(made).toHaveLength(0);
  });

  it('a newer rest cancels the load still in flight; a failed art falls back to the poster', async () => {
    const { default: PlexBackdrop } = await import('./PlexBackdrop');
    const { focusBackdrop } = await import('@/lib/plexBackdrop');
    render(<PlexBackdrop base="http://pms" token="t" />);
    focusBackdrop(item('1'));
    await act(async () => { vi.advanceTimersByTime(500); });
    focusBackdrop(item('2'));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(made).toHaveLength(2);
    expect(made[0].src).toBe('');
    act(() => { made[1].onerror?.(); });
    expect(made).toHaveLength(3);
    expect(made[2].src).toBe('http://pms/photo?w=960&h=540&url=/library/metadata/2/thumb/1');
  });

  it("an episode shows its show's art", async () => {
    const { backdropPaths } = await import('@/lib/plexBackdrop');
    expect(backdropPaths(item('9', { type: 'episode', thumb: '/library/metadata/5/thumb' }))[0]).toBe('/library/metadata/5/art');
    expect(backdropPaths(item('9', { art: '/library/metadata/9/art/77' }))).toEqual(['/library/metadata/9/art/77', '/library/metadata/9/thumb/1']);
  });
});
