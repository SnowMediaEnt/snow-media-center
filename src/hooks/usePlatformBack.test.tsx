// The system Back for a popup on a phone or tablet (usePlatformBack, ported
// from Tronix with its tests): there
// the gesture / the navigation bar's Back reaches the page only as
// Capacitor's 'backButton', never as a key. One press closes the popup and
// only it; a TV box gets no listener at all (its Back is as it was).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({ back: [] as Array<() => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, fn: () => void) => {
      if (ev === 'backButton') h.back.push(fn);
      return { remove: () => { h.back = h.back.filter((f) => f !== fn); } };
    },
  },
}));

import { usePlatformBack } from './usePlatformBack';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

type BackWindow = Window & { __overlayHandledBackAt?: number };
const Popup = ({ open, onBack }: { open: boolean; onBack: () => void }) => {
  usePlatformBack(open, onBack);
  return null;
};
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
/** One press of the phone's Back: every listener, in the order added. */
const hwBack = () => act(() => { for (const f of [...h.back]) f(); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.back = [];
  (window as BackWindow).__overlayHandledBackAt = 0;
  __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __setPhoneModeForTests({ touch: false, phone: false });
});

describe('usePlatformBack', () => {
  it('on a phone: one press calls it once and marks the press handled for the other listeners', async () => {
    const onBack = vi.fn();
    render(<Popup open onBack={onBack} />);
    await flush();
    expect(h.back).toHaveLength(1);
    hwBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(Date.now() - ((window as BackWindow).__overlayHandledBackAt ?? 0)).toBeLessThan(50);
    // The same press arriving again (the key and the event): not a second Back.
    hwBack();
    expect(onBack).toHaveBeenCalledTimes(1);
    // The next press is.
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    hwBack();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('a press another popup (over this one) already answered is left alone', async () => {
    const onBack = vi.fn();
    render(<Popup open onBack={onBack} />);
    await flush();
    (window as BackWindow).__overlayHandledBackAt = Date.now();
    hwBack();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('closed: no listener; open again: one', async () => {
    const onBack = vi.fn();
    const { rerender } = render(<Popup open={false} onBack={onBack} />);
    await flush();
    expect(h.back).toHaveLength(0);
    rerender(<Popup open onBack={onBack} />);
    await flush();
    expect(h.back).toHaveLength(1);
    rerender(<Popup open={false} onBack={onBack} />);
    await flush();
    expect(h.back).toHaveLength(0);
  });

  it('a TV box: no listener at all (its Back keeps the key path it always had)', async () => {
    __setPhoneModeForTests({ touch: false, phone: false });
    const onBack = vi.fn();
    render(<Popup open onBack={onBack} />);
    await flush();
    expect(h.back).toHaveLength(0);
  });
});
