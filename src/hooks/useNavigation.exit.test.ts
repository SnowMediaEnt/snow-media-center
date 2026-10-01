/**
 * The app leaves only through Home's own "press Back again to exit". The
 * owner's Fire TV (1.8.1): one Back from a full-screen channel, with a
 * recording running, closed Snow Media Center and showed the app behind it.
 * App.exitApp is called in one place, Home's double press, and it counted any
 * two Back signals that reached Home within two seconds, including presses
 * that belonged to the Player: the one that walked out of it while Home was
 * still drawing, and presses Capacitor held while the page was not listening
 * and replays the moment Home's listener is added.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cap = vi.hoisted(() => ({ back: [] as Array<(e: { canGoBack: boolean }) => void>, exitApp: vi.fn() }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, cb: (e: { canGoBack: boolean }) => void) => {
      if (ev === 'backButton') cap.back.push(cb);
      return { remove() { cap.back = cap.back.filter((f) => f !== cb); } };
    },
    exitApp: cap.exitApp,
  },
}));

import { HOME_SETTLE_MS, useNavigation } from './useNavigation';

type BackWindow = Window & { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
/** The remote's Back as a TV box delivers it: Capacitor's backButton event, to every listener. */
const hardwareBack = () => act(() => { for (const f of [...cap.back]) f({ canGoBack: false }); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** The hook with its native listener registered. */
const mount = async (initial = 'home') => {
  const hook = renderHook(() => useNavigation(initial));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(cap.back).toHaveLength(1);
  return hook;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T20:00:00Z'));
  cap.back = [];
  cap.exitApp.mockClear();
  const w = window as BackWindow;
  w.__playerOwnsBack = false;
  w.__overlayHandledBackAt = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('Back never leaves the app from the Player', () => {
  it('Back in the Player is the Player\'s: no step out, no exit', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    act(() => result.current.navigateTo('livetv'));
    (window as BackWindow).__playerOwnsBack = true;
    for (let i = 0; i < 4; i++) { hardwareBack(); await wait(400); }
    expect(result.current.currentView).toBe('livetv');
    expect(cap.exitApp).not.toHaveBeenCalled();
  });

  it('the press that walks out of the Player, and the ones right behind it, never exit', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    act(() => result.current.navigateTo('livetv'));
    (window as BackWindow).__playerOwnsBack = true;
    // The Player hands Home its last step (LiveTV's onBack) and unmounts.
    act(() => result.current.goBack());
    (window as BackWindow).__playerOwnsBack = false;
    expect(result.current.currentView).toBe('home');
    // Back again while Home is still coming up on a busy box (the video was
    // still on screen): neither press is a step toward leaving.
    await wait(400);
    hardwareBack();
    await wait(380);
    hardwareBack();
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(result.current.backPressCount).toBe(0);
  });

  it('presses replayed to Home\'s listener as the page comes up never exit', async () => {
    // Capacitor keeps a Back that nothing was listening for and replays it to
    // the first listener added: Home's, at boot or after a WebView reload.
    await mount();
    hardwareBack();
    hardwareBack();
    await wait(200);
    hardwareBack();
    expect(cap.exitApp).not.toHaveBeenCalled();
  });
});

describe('Home\'s own way out still works', () => {
  it('Back on Home asks first, a second Back within two seconds leaves, once', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    hardwareBack();
    expect(result.current.backPressCount).toBe(1);
    expect(cap.exitApp).not.toHaveBeenCalled();
    await wait(600);
    hardwareBack();
    expect(cap.exitApp).toHaveBeenCalledTimes(1);
  });

  it('after the two seconds the next Back asks again', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    hardwareBack();
    await wait(2500);
    hardwareBack();
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(result.current.backPressCount).toBe(1);
  });

  it('one press seen twice (the system event and a key) is one press', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    hardwareBack();
    await wait(100);
    act(() => result.current.goBack()); // Index's Escape / keyCode 4 handler
    expect(cap.exitApp).not.toHaveBeenCalled();
    await wait(500);
    act(() => result.current.goBack());
    expect(cap.exitApp).toHaveBeenCalledTimes(1);
  });

  it('coming back to Home starts over: a press made before leaving it does not count', async () => {
    const { result } = await mount();
    await wait(HOME_SETTLE_MS + 100);
    hardwareBack(); // asks
    act(() => result.current.navigateTo('settings'));
    act(() => result.current.goBack());
    await wait(HOME_SETTLE_MS + 100);
    hardwareBack(); // asks again, does not leave
    expect(cap.exitApp).not.toHaveBeenCalled();
  });
});
