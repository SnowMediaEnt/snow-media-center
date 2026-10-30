// The popups that open on Home at start (Welcome / What's New, the content
// bar offer, a broadcast or pre-event notice, the giveaway popups, the update
// prompt) take turns through one slot (utils/bootPopupQueue). They used to
// stack: a notice is not aria-modal on a TV, so the others' checks were blind
// to it, and one OK — or one Back — reached both. On a Fire TV each Back also
// arrives a second time as the system Back; a popup that closed on the key
// without marking the press let it reach Home, which armed "press again to
// exit", and Back on the next popup closed the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

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
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.0.0', isLoading: false }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import WelcomePopup from './WelcomePopup';
import MediaBarPrompt from './MediaBarPrompt';
import BroadcastAlertPopup from './BroadcastAlertPopup';
import { HOME_SETTLE_MS, useNavigation } from '@/hooks/useNavigation';
import { __resetBootPopupForTests } from '@/utils/bootPopupQueue';

type BackWindow = Window & { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
const WELCOME_KEY = 'smc-welcome-shown-version';
const ALERT = { id: 'a1', title: 'Maintenance tonight', message: 'Back at 2 AM.', severity: 'warning' as const };

/** A notice as Index drives it: OK takes it off (open goes false). */
const Notice = ({ onDismiss }: { onDismiss: () => void }) => {
  const [open, setOpen] = useState(true);
  return <BroadcastAlertPopup open={open} alert={ALERT as never} onDismiss={() => { setOpen(false); onDismiss(); }} />;
};

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const press = (key: string, keyCode?: number) => act(() => { fireEvent.keyDown(window, { key, keyCode }); });
/** The system Back a Fire TV sends after the key, to every Capacitor listener. */
const hardwareBack = () => act(() => { for (const f of [...cap.back]) f({ canGoBack: false }); });
const welcomeUp = () => !!document.querySelector('[data-welcome-primary="true"]');
const noticeUp = () => !!document.querySelector('[data-notice-layer]');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T20:00:00Z'));
  __resetBootPopupForTests();
  localStorage.clear();
  sessionStorage.clear();
  cap.back = [];
  cap.exitApp.mockClear();
  const w = window as BackWindow;
  w.__playerOwnsBack = false;
  w.__overlayHandledBackAt = 0;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('boot popups take turns', () => {
  it('Welcome and a broadcast notice show one at a time', async () => {
    const onNotice = vi.fn();
    // Mounted in the same render pass: whichever takes the slot first shows.
    render(<><WelcomePopup /><Notice onDismiss={onNotice} /></>);
    await tick(100);
    expect(Number(welcomeUp()) + Number(noticeUp())).toBe(1);
    const welcomeFirst = welcomeUp();
    await tick(3000);
    expect(Number(welcomeUp()) + Number(noticeUp())).toBe(1);

    press('Enter', 13); // OK on the one shown
    await tick(600);
    expect(welcomeUp()).toBe(!welcomeFirst);
    expect(noticeUp()).toBe(welcomeFirst);
    expect(onNotice).toHaveBeenCalledTimes(welcomeFirst ? 0 : 1);
  });

  it('the content bar offer waits behind a notice (not aria-modal on a TV)', async () => {
    localStorage.setItem(WELCOME_KEY, '1.0.0');
    localStorage.setItem('snow-media-bar-enabled', '0');
    const r = render(<BroadcastAlertPopup open alert={ALERT as never} onDismiss={vi.fn()} />);
    await tick(100);
    expect(noticeUp()).toBe(true);
    expect(document.querySelector('[data-notice-layer]')?.getAttribute('aria-modal')).toBeNull();
    r.rerender(<><BroadcastAlertPopup open alert={ALERT as never} onDismiss={vi.fn()} /><MediaBarPrompt /></>);
    await tick(3000);
    expect(document.querySelector('[data-mbp-btn]')).toBeNull();
    // The notice goes: the offer gets its turn.
    r.rerender(<><BroadcastAlertPopup open={false} alert={ALERT as never} onDismiss={vi.fn()} /><MediaBarPrompt /></>);
    await tick(1000);
    expect(document.querySelector('[data-mbp-btn]')).not.toBeNull();
  });
});

describe('one press reaches only the top popup', () => {
  it('OK closes Welcome only: not the queued notice, not Home under it', async () => {
    const home = vi.fn();
    window.addEventListener('keydown', home); // Home's own listener (bubble phase)
    const homeCapture = vi.fn();
    try {
      const onNotice = vi.fn();
      const r = render(<WelcomePopup />);
      await tick(100);
      r.rerender(<><WelcomePopup /><BroadcastAlertPopup open alert={ALERT as never} onDismiss={onNotice} /></>);
      await tick(100);
      expect(welcomeUp()).toBe(true);
      // A capture listener added after the popup's (a screen's): a plain
      // stopPropagation let it act on the same press.
      window.addEventListener('keydown', homeCapture, true);
      press('Enter', 13);
      await tick(0);
      expect(welcomeUp()).toBe(false);
      expect(onNotice).not.toHaveBeenCalled();
      expect(home).not.toHaveBeenCalled();
      expect(homeCapture).not.toHaveBeenCalled();

      await tick(600);
      expect(noticeUp()).toBe(true);
      press('Enter', 13);
      expect(onNotice).toHaveBeenCalledTimes(1);
      expect(home).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', home);
      window.removeEventListener('keydown', homeCapture, true);
    }
  });

  it('arrows under a notice stay with it: Home does not move, focus stays on OK', async () => {
    const home = vi.fn();
    window.addEventListener('keydown', home);
    try {
      render(<BroadcastAlertPopup open alert={ALERT as never} onDismiss={vi.fn()} />);
      await tick(100);
      press('ArrowDown', 40);
      press('ArrowRight', 39);
      expect(home).not.toHaveBeenCalled();
      expect(document.activeElement?.closest('[data-notice-layer]')).not.toBeNull();
    } finally {
      window.removeEventListener('keydown', home);
    }
  });
});

describe('Back on one popup, then Back on the next, never exits the app', () => {
  it('Welcome, then a notice: each Back (key + system Back) closes only its popup', async () => {
    const nav = renderHook(() => useNavigation('home'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await tick(HOME_SETTLE_MS + 100);

    const onNotice = vi.fn();
    const r = render(<WelcomePopup />);
    await tick(100);
    r.rerender(<><WelcomePopup /><BroadcastAlertPopup open alert={ALERT as never} onDismiss={onNotice} /></>);
    await tick(100);
    expect(welcomeUp()).toBe(true);
    expect(noticeUp()).toBe(false);

    // Back on Welcome: the key closes it, then the system Back follows.
    press('GoBack', 4);
    await tick(50);
    hardwareBack();
    expect(welcomeUp()).toBe(false);

    // The notice takes its turn; Back on it within two seconds.
    await tick(600);
    expect(noticeUp()).toBe(true);
    press('Escape', 27);
    await tick(50);
    hardwareBack();

    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(cap.exitApp).not.toHaveBeenCalled();
    expect(nav.result.current.backPressCount).toBe(0);
    expect(nav.result.current.currentView).toBe('home');
  });
});

it('the broadcast notice is drawn with its text', async () => {
  render(<BroadcastAlertPopup open alert={ALERT as never} onDismiss={vi.fn()} />);
  await tick(100);
  expect(screen.getByText('Maintenance tonight')).toBeTruthy();
});
