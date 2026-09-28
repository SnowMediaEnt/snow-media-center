/**
 * Live TV › Settings › Rewind live TV (TRACKER 25): the switch and Max rewind
 * by remote, the "one extra stream" line, and the explanation on a plan that
 * allows one stream.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ plan: 2 as number | null, demo: false }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: { timeshiftUsage: async () => ({ usedBytes: 0, freeBytes: 20 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 }) },
}));
vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({ account: h.plan === null && !h.demo ? null : { host: 'http://h', username: 'u', password: 'p', maxConnections: h.plan } }),
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));

import RewindSettingsScreen, { EXTRA_STREAM_LINE } from './RewindSettingsScreen';
import { REWIND_SETTINGS_KEY, loadRewindSettings } from '@/lib/liveRewind';

const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { localStorage.removeItem(REWIND_SETTINGS_KEY); h.plan = 2; h.demo = false; });

describe('Rewind live TV settings', () => {
  it('says it uses one extra stream on the line', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    expect(EXTRA_STREAM_LINE).toBe('Uses one extra stream on your line');
    expect(document.querySelector('[data-rewind-extra-stream]')?.textContent).toContain(EXTRA_STREAM_LINE);
    // A plan with two streams has nothing else to explain.
    expect(document.querySelector('[data-rewind-plan]')).toBeNull();
  });

  it('on a one-stream plan it says rewind works only on channels with catch-up', async () => {
    h.plan = 1;
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    expect(document.querySelector('[data-rewind-plan]')?.textContent).toBe('Your plan allows 1 stream, so rewind works only on channels with catch-up.');
  });

  it('OK turns it off and on; the choice is kept', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    key('Enter');
    expect(loadRewindSettings().enabled).toBe(false);
    key('Enter');
    expect(loadRewindSettings().enabled).toBe(true);
  });

  it('Max rewind steps along 10 / 30 / 60 with the arrows; Back leaves', async () => {
    const onBack = vi.fn();
    render(<RewindSettingsScreen onBack={onBack} />);
    await settle();
    key('ArrowDown');
    key('ArrowRight');
    expect(loadRewindSettings().maxRewind).toBe(10);
    key('ArrowRight');
    expect(loadRewindSettings().maxRewind).toBe(30);
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
