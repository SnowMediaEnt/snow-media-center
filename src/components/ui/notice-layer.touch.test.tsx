// A boot notice on a phone (Tronix a794c13): the system Back closes it, a tap
// on the dim closes it, and it is aria-modal so the app's own Back stands
// aside. A TV: an inert dim, not aria-modal, no system-Back listener.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

const h = vi.hoisted(() => ({ back: [] as Array<() => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, fn: () => void) => {
      if (ev === 'backButton') h.back.push(fn);
      return { remove: () => { h.back = h.back.filter((f) => f !== fn); } };
    },
  },
}));

import NoticeLayer from './notice-layer';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const hwBack = () => act(() => { for (const f of [...h.back]) f(); });

beforeEach(() => { h.back = []; (window as Window & { __overlayHandledBackAt?: number }).__overlayHandledBackAt = 0; });
afterEach(() => { cleanup(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('a boot notice', () => {
  it('a phone: aria-modal, closed by the system Back and by a tap on the dim', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    const onDismiss = vi.fn();
    const { container } = render(<NoticeLayer open onDismiss={onDismiss}><p>notice</p></NoticeLayer>);
    await flush();
    expect(container.querySelector('[data-notice-layer]')?.getAttribute('aria-modal')).toBe('true');
    hwBack();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.click(container.querySelector('[data-notice-dim]')!); });
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('a TV: an inert dim, not aria-modal, no system-Back listener', async () => {
    const onDismiss = vi.fn();
    const { container } = render(<NoticeLayer open onDismiss={onDismiss}><p>notice</p></NoticeLayer>);
    await flush();
    expect(container.querySelector('[data-notice-layer]')?.getAttribute('aria-modal')).toBeNull();
    expect(h.back).toHaveLength(0);
    act(() => { fireEvent.click(container.querySelector('[data-notice-dim]')!); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
