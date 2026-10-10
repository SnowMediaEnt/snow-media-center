/**
 * A phone's system Back (Tronix fe50f34, 6cd9617): it reaches the page only as
 * Capacitor's backButton. The screen gets the Escape a remote's Back gives it
 * first, so it takes its own step (a ticket back to the list); only a press
 * nobody answered pops the screen. A TV is unchanged.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const cap = vi.hoisted(() => ({ back: [] as Array<(e: { canGoBack: boolean }) => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, cb: (e: { canGoBack: boolean }) => void) => {
      if (ev === 'backButton') cap.back.push(cb);
      return { remove() { cap.back = cap.back.filter((f) => f !== cb); } };
    },
    exitApp: vi.fn(),
  },
}));

import { useNavigation } from './useNavigation';

const hardwareBack = () => act(() => { for (const f of [...cap.back]) f({ canGoBack: false }); });
const mount = async () => {
  const hook = renderHook(() => useNavigation('home'));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  act(() => hook.result.current.navigateTo('support'));
  return hook;
};
let screenStep: ((e: KeyboardEvent) => void) | null = null;

beforeEach(() => { cap.back = []; (window as Window & { __overlayHandledBackAt?: number }).__overlayHandledBackAt = 0; });
afterEach(() => {
  if (screenStep) window.removeEventListener('keydown', screenStep, true);
  screenStep = null;
  __setPhoneModeForTests({ touch: false, phone: false });
});

describe('a phone\'s system Back on a screen', () => {
  it('a screen that takes the Escape keeps the viewer on it (its own step)', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const steps: string[] = [];
    screenStep = (e) => { if (e.key === 'Escape') { e.preventDefault(); steps.push('ticket→list'); } };
    window.addEventListener('keydown', screenStep, true);
    const hook = await mount();
    hardwareBack();
    expect(steps).toEqual(['ticket→list']);
    expect(hook.result.current.currentView).toBe('support');
  });

  it('nobody answers it: one step back', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const hook = await mount();
    hardwareBack();
    expect(hook.result.current.currentView).toBe('home');
  });

  it('a TV: no Escape is made, the step back is as before', async () => {
    const seen: string[] = [];
    screenStep = (e) => { seen.push(e.key); e.preventDefault(); };
    window.addEventListener('keydown', screenStep, true);
    const hook = await mount();
    hardwareBack();
    expect(seen).toEqual([]);
    expect(hook.result.current.currentView).toBe('home');
  });
});
