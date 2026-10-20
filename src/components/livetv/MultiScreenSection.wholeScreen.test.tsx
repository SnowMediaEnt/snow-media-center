/**
 * Multi-Screen uses the whole screen (owner, 2026-10-11: "removing the top
 * and side border and making the screens larger", from Tronix 89c42b3). On a
 * TV, while a screen plays and the tiles have the remote, the section asks
 * the Player to step its header and side menu aside (onImmersiveChange);
 * ◀ off the tiles' left edge and ▲ off their top hand the remote back to
 * them, and the tiles play on meanwhile. Every layout's screens are 16:9 and
 * as large as the grid allows, and the native players are sent exactly those
 * boxes, again whenever the grid changes size. Plus the review fixes: a held
 * OK is one press, a full-screen small screen parks the others off screen,
 * a pop-up during a held OK is left alone, and OK on a failed small screen
 * retries it.
 */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Slot = { url: string | null; buffering: boolean; error: string | null; retries: number; bufferingSince: number | null };
const ms = vi.hoisted(() => ({ load: vi.fn(), close: vi.fn(), focus: vi.fn(), rect: vi.fn(), stop: vi.fn() }));
// The players' own state, for a test to break a stream.
const box = vi.hoisted(() => ({ fail: (_sid: string) => {} }));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null }) }));
vi.mock('@/lib/favoritesSync', () => ({ loadFavoritesForLine: () => new Map(), lineKey: (c: { host: string; username: string }) => `${c.host}|${c.username}` }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/useMultiScreenPlayers', async () => {
  const { useCallback, useState } = await import('react');
  const blank: Slot = { url: null, buffering: false, error: null, retries: 0, bufferingSince: null };
  return {
    MS_SLOT_IDS: ['ms1', 'ms2', 'ms3', 'ms4'],
    useMultiScreenPlayers: () => {
      const [slots, setSlots] = useState<Record<string, Slot>>({ ms1: blank, ms2: blank, ms3: blank, ms4: blank });
      const loadSlot = useCallback(async (sid: string, url: string) => { ms.load(sid, url); setSlots((s) => ({ ...s, [sid]: { ...blank, url } })); }, []);
      const closeSlot = useCallback(async (sid: string) => { ms.close(sid); setSlots((s) => ({ ...s, [sid]: blank })); }, []);
      const applyRect = useCallback(async (sid: string, r: unknown) => { ms.rect(sid, r); }, []);
      const focusAudio = useCallback(async (sid: string | null) => { ms.focus(sid); }, []);
      const stopAll = useCallback(async () => { ms.stop(); setSlots({ ms1: blank, ms2: blank, ms3: blank, ms4: blank }); }, []);
      box.fail = (sid: string) => setSlots((s) => ({ ...s, [sid]: { ...s[sid], buffering: false, error: 'unavailable' } }));
      return { slots, loadSlot, closeSlot, applyRect, focusAudio, stopAll };
    },
  };
});
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => [
    { stream_id: 11, name: 'Alpha News', num: 1, category_id: '1' },
    { stream_id: 22, name: 'Bravo Sports', num: 2, category_id: '1' },
    { stream_id: 33, name: 'Charlie Music', num: 3, category_id: '1' },
  ],
  getShortEpg: async () => ({ epg_listings: [] }),
  buildNativeLiveUrl: (_c: unknown, id: number) => `native://${id}`,
}));

import MultiScreenSection from './MultiScreenSection';
import { threeScreenPx } from './multiScreenLayout';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' } as never;
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = () => document.body.textContent ?? '';
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const key = (k: string, init: Record<string, unknown> = {}) => act(() => { fireEvent.keyDown(window, { key: k, ...init }); });
const keyUp = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const tile = (i: number) => q(`[data-ms-tile="${i}"]`);

// jsdom has no layout: the grid is GRID (where the Player puts it on the
// screen, and its size), and every tile is laid out from its own style.
type Rect = { x: number; y: number; width: number; height: number };
const GRID = { left: 0, top: 0, width: 960, height: 540 };
const placeRect = (i: number): Rect => {
  const st = tile(i)!.parentElement!.style;
  const f = (v: string, of: number) => (parseFloat(v) / 100) * of;
  return { x: GRID.left + f(st.left, GRID.width), y: GRID.top + f(st.top, GRID.height), width: f(st.width, GRID.width), height: f(st.height, GRID.height) };
};
const lastRect = (sid: string): Rect | undefined => [...ms.rect.mock.calls].reverse().find(([s]) => s === sid)?.[1] as Rect | undefined;
const near = (a: Rect | undefined, b: Rect) => {
  expect(a).toBeTruthy();
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(a![k]).toBeCloseTo(b[k], 1);
};

beforeEach(() => {
  Object.assign(GRID, { left: 0, top: 0, width: 960, height: 540 });
  for (const f of Object.values(ms)) f.mockReset();
  __setPhoneModeForTests({ touch: false, phone: false });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const st = this.style;
    let r = { x: GRID.left, y: GRID.top, width: GRID.width, height: GRID.height };
    if (st.position === 'absolute' && st.width.endsWith('%')) {
      const f = (v: string, of: number) => (parseFloat(v) / 100) * of;
      r = { x: GRID.left + f(st.left, GRID.width), y: GRID.top + f(st.top, GRID.height), width: f(st.width, GRID.width), height: f(st.height, GRID.height) };
    }
    return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); __setPhoneModeForTests({ touch: false, phone: false }); document.body.innerHTML = ''; });

const mount = () => {
  const onExitLeft = vi.fn();
  const onExitUp = vi.fn();
  const onImmersive = vi.fn();
  const r = render(<MultiScreenSection creds={creds} isActive onExitLeft={onExitLeft} onExitUp={onExitUp} onImmersiveChange={onImmersive} />);
  const again = (active: boolean) => r.rerender(<MultiScreenSection creds={creds} isActive={active} onExitLeft={onExitLeft} onExitUp={onExitUp} onImmersiveChange={onImmersive} />);
  return { onExitLeft, onExitUp, onImmersive, again, unmount: r.unmount };
};
/** The layout chooser: 2 side by side, 2 stacked, 3, 4. */
const choose = async (n: 0 | 1 | 2 | 3) => {
  await waitFor(() => expect(text()).toContain('3 Screens'));
  for (let i = 0; i < n; i++) key('ArrowRight');
  key('Enter');
  await settle();
};
/** OK on the highlighted empty screen, then the News channel at `row`. */
const addChannel = async (row: number, loads: number) => {
  key('Enter'); await settle();
  key('ArrowDown'); await settle(400); // Favorites -> News; its list loads once the highlight rests
  key('ArrowRight'); await settle(100);
  for (let i = 0; i < row; i++) key('ArrowDown');
  key('Enter');
  await waitFor(() => expect(ms.load).toHaveBeenCalledTimes(loads));
  await settle(80);
};
/** 3 screens: Alpha News big (ms1), Bravo Sports left small (ms2), Charlie Music right small (ms3); the highlight back on the big one. */
const fillThree = async () => {
  await choose(2);
  await addChannel(0, 1);
  key('ArrowDown');
  await addChannel(1, 2);
  key('ArrowRight');
  await addChannel(2, 3);
  key('ArrowUp');
  expect(ms.load.mock.calls).toEqual([['ms1', 'native://11'], ['ms2', 'native://22'], ['ms3', 'native://33']]);
};

describe('the whole screen on a TV', () => {
  it('the header and side menu step aside only while a screen plays and the tiles have the remote; ◀ / ▲ hand it over and the tiles play on', async () => {
    const m = mount();
    await choose(2);
    expect(m.onImmersive).toHaveBeenLastCalledWith(false); // the layouts, then the empty grid
    await addChannel(0, 1);
    expect(m.onImmersive).toHaveBeenLastCalledWith(true);

    // ◀ off the big screen: the side menu (and the header) have the remote.
    key('ArrowLeft');
    expect(m.onExitLeft).toHaveBeenCalledTimes(1);
    m.again(false);
    await settle();
    expect(m.onImmersive).toHaveBeenLastCalledWith(false);
    // Playing on behind them: nothing stopped, the layout and its channel kept, no highlight on the tiles.
    expect(ms.stop).not.toHaveBeenCalled();
    expect(tile(0)?.textContent).toContain('Alpha News');
    expect(tile(0)?.getAttribute('data-focused')).toBe('false');
    // Back on the tiles: aside again, nothing loaded again.
    m.again(true);
    await settle();
    expect(m.onImmersive).toHaveBeenLastCalledWith(true);
    expect(ms.load).toHaveBeenCalledTimes(1);
    expect(tile(0)?.getAttribute('data-focused')).toBe('true');
    // ▲ off the top: the header.
    key('ArrowUp');
    expect(m.onExitUp).toHaveBeenCalledTimes(1);

    // Full screen and back: still the whole screen; Back from the grid: the layouts, with them.
    key('Enter'); await settle(); // the big screen's options
    key('ArrowDown'); key('Enter'); // Fullscreen
    await settle(400);
    expect(m.onImmersive).toHaveBeenLastCalledWith(true);
    key('Escape');
    await settle(400);
    expect(m.onImmersive).toHaveBeenLastCalledWith(true);
    key('Escape');
    await settle();
    expect(text()).toContain('Choose a Multi-Screen layout');
    expect(ms.stop).toHaveBeenCalled();
    expect(m.onImmersive).toHaveBeenLastCalledWith(false);
    m.unmount();
    expect(m.onImmersive).toHaveBeenLastCalledWith(false);
  });

  it('never on a touch screen (no ◀ / ▲ to bring them back)', async () => {
    __setPhoneModeForTests({ touch: true, phone: false });
    const m = mount();
    await choose(2);
    await addChannel(0, 1);
    expect(m.onImmersive.mock.calls.length).toBeGreaterThan(0);
    expect(m.onImmersive.mock.calls.every(([on]) => on === false)).toBe(true);
  });

  it('3 screens on the whole screen: the players get 720x405 and two 240x135, and new boxes when the header and side menu come back', async () => {
    mount();
    await fillThree();
    await settle(50);
    near(lastRect('ms1'), { x: 120, y: 0, width: 720, height: 405 });
    near(lastRect('ms2'), { x: 240, y: 405, width: 240, height: 135 });
    near(lastRect('ms3'), { x: 480, y: 405, width: 240, height: 135 });
    // The header (57 px) and the open side menu (176 px) back: the grid is
    // smaller and further in, and every player follows its tile there.
    Object.assign(GRID, { left: 176, top: 57, width: 784, height: 483 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    await settle(80);
    // The tiles' edges are whole px (multiScreenLayout rounds each once).
    const want = threeScreenPx(784, 483).rects.map((r) => {
      const [l, t, rr, bb] = [Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w), Math.round(r.y + r.h)];
      return { x: l, y: t, w: rr - l, h: bb - t };
    });
    ['ms1', 'ms2', 'ms3'].forEach((sid, i) => {
      near(lastRect(sid), { x: 176 + want[i].x, y: 57 + want[i].y, width: want[i].w, height: want[i].h });
      near(lastRect(sid), placeRect(i));
    });
    // Nothing reloaded for it.
    expect(ms.load).toHaveBeenCalledTimes(3);
  });

  it('2 side by side on the whole screen: two 480x270 screens, centred', async () => {
    mount();
    await choose(0);
    await addChannel(0, 1);
    key('ArrowRight');
    await addChannel(1, 2);
    await settle(50);
    near(lastRect('ms1'), { x: 0, y: 135, width: 480, height: 270 });
    near(lastRect('ms2'), { x: 480, y: 135, width: 480, height: 270 });
  });
});

describe('review fixes (from Tronix 89c42b3)', () => {
  it('a held OK is one press: on the big screen it opens the options and nothing more (no picker, no channel replaced)', async () => {
    mount();
    await choose(2);
    await addChannel(0, 1);
    key('Enter'); // the big screen's options
    for (let i = 0; i < 12; i++) key('Enter', { repeat: true });
    keyUp('Enter');
    await settle(100);
    expect(text()).toContain('Change channel');
    expect(text()).not.toContain('Add a channel to screen 1');
    expect(ms.load).toHaveBeenCalledTimes(1);
  });

  it('a held OK on the layouts chooses one and does not open a screen\'s picker', async () => {
    mount();
    await waitFor(() => expect(text()).toContain('3 Screens'));
    key('Enter'); // 2 side by side
    for (let i = 0; i < 6; i++) key('Enter', { repeat: true });
    await settle(100);
    expect(tile(0)).toBeTruthy();
    expect(text()).not.toContain('Add a channel to screen 1');
  });

  it('a small screen full screen: the other players move off screen (none drawn over it), and come back on Back', async () => {
    mount();
    await fillThree();
    key('ArrowDown');
    key('Enter'); await settle(700); keyUp('Enter'); // held: its options
    expect(text()).toContain('Change channel');
    key('ArrowDown');
    ms.rect.mockClear();
    key('Enter'); // Fullscreen
    await settle();
    const calls = ms.rect.mock.calls as Array<[string, Rect]>;
    expect(calls.find(([sid]) => sid === 'ms2')?.[1]).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    for (const sid of ['ms1', 'ms3']) {
      const r = calls.find(([s]) => s === sid)?.[1];
      expect(r && r.x + r.width).toBeLessThanOrEqual(0);
    }
    expect(ms.load).toHaveBeenCalledTimes(3);
    ms.rect.mockClear();
    await settle(400);
    key('Escape');
    await settle(100);
    near(lastRect('ms1'), placeRect(0));
    near(lastRect('ms2'), placeRect(1));
    near(lastRect('ms3'), placeRect(2));
  });

  it('a pop-up over the screens during a held OK: no swap behind it on the release, no options from the timer', async () => {
    mount();
    await choose(2);
    await addChannel(0, 1);
    key('ArrowDown');
    await addChannel(1, 2);
    ms.load.mockClear();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    key('Enter');
    document.body.appendChild(modal);
    try {
      keyUp('Enter');
      await settle();
      expect(ms.load).not.toHaveBeenCalled();
      // Again, held: the timer finds the pop-up and opens nothing.
      modal.remove();
      key('Enter');
      document.body.appendChild(modal);
      await settle(700);
      expect(text()).not.toContain('Change channel');
      keyUp('Enter');
      await settle();
      expect(ms.load).not.toHaveBeenCalled();
    } finally { modal.remove(); }
  });

  it('a small screen whose stream failed: OK tries it again (no swap), one hint; held, still its options', async () => {
    mount();
    await choose(2);
    await addChannel(0, 1);
    key('ArrowDown');
    await addChannel(1, 2);
    expect(q('[data-ms-swap-hint]')).toBeTruthy();
    act(() => { box.fail('ms2'); });
    await settle();
    expect(tile(1)?.textContent).toContain('Stream unavailable');
    expect(tile(1)?.textContent).toContain('OK to retry');
    expect(q('[data-ms-swap-hint]')).toBeNull();
    ms.load.mockClear(); ms.focus.mockClear();
    key('Enter'); keyUp('Enter');
    await waitFor(() => expect(ms.load).toHaveBeenCalledTimes(1));
    expect(ms.load).toHaveBeenLastCalledWith('ms2', 'native://22');
    expect(tile(0)?.textContent).toContain('Alpha News'); // not swapped
    await settle();
    expect(ms.focus.mock.calls.every(([sid]) => sid === 'ms1')).toBe(true); // the sound stays up top
    // Failed again: held OK still opens its options (Change channel, Close).
    act(() => { box.fail('ms2'); });
    await settle();
    key('Enter'); await settle(700); keyUp('Enter');
    expect(text()).toContain('Close screen');
  });
});
