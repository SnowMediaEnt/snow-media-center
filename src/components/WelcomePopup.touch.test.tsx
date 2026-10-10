// The first-run welcome on a phone (Tronix a794c13): the system Back closes
// it (on a phone that Back is never a key, and the popup used to stay up
// while Back did nothing under it), and What's New has no remote hints. A TV
// adds no platform listener: its remote's Back keeps the key path it had.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ back: [] as Array<() => void>, version: '1.0.0' }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, fn: () => void) => {
      if (ev === 'backButton') h.back.push(fn);
      return { remove: () => { h.back = h.back.filter((f) => f !== fn); } };
    },
  },
}));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: h.version, isLoading: false }) }));

import WelcomePopup from './WelcomePopup';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const hwBack = () => act(() => { for (const f of [...h.back]) f(); });
const KEY = 'smc-welcome-shown-version';

beforeEach(() => {
  h.back = [];
  h.version = '1.0.0';
  localStorage.clear();
  (window as Window & { __overlayHandledBackAt?: number }).__overlayHandledBackAt = 0;
});
afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('the welcome on a phone', () => {
  it('the system Back closes it, and it is not shown again', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const onOpenChange = vi.fn();
    render(<WelcomePopup onOpenChange={onOpenChange} />);
    await flush();
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    hwBack();
    await flush();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(localStorage.getItem(KEY)).toBe('1.0.0');
  });

  it('a TV: no system-Back listener of its own (its keys close it, as before)', async () => {
    render(<WelcomePopup />);
    await flush();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(h.back).toHaveLength(0);
  });
});

describe("What's New on a phone", () => {
  const openWhatsNew = async () => {
    h.version = '1.8.0';
    localStorage.setItem(KEY, '1.0.0');
    render(<WelcomePopup />);
    await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    return screen.getByRole('dialog');
  };

  it('touch: no remote hint', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const dlg = await openWhatsNew();
    expect(dlg.textContent).toContain("What's New in v1.8.0");
    expect(dlg.textContent).not.toMatch(/OK close|▲ ▼/);
  });

  it('a TV: the remote hint, as before', async () => {
    const dlg = await openWhatsNew();
    expect(dlg.querySelector('[data-welcome-hint]')?.textContent).toBe('OK close');
  });
});
