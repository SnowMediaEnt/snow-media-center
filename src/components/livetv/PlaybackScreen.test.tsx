/**
 * Settings → Playback: pick the player engine (owner test builds only) and
 * see the Compare table. D-pad only: one Back = one step, nothing needs a
 * pointer.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getEngines: vi.fn(async () => ({ mpv: { available: true } })),
  prefs: new Map<string, string>(),
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: { getEngines: h.getEngines },
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: h.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => { h.prefs.set(key, value); },
  },
}));

import PlaybackScreen from './PlaybackScreen';

const wait = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const key = (init: KeyboardEventInit & { keyCode?: number }) => act(() => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode != null) Object.defineProperty(e, 'keyCode', { get: () => init.keyCode });
  window.dispatchEvent(e);
});
const ok = () => key({ key: 'Enter', keyCode: 13 });
const back = () => key({ key: 'Escape', keyCode: 27 });
const down = () => key({ key: 'ArrowDown' });
const up = () => key({ key: 'ArrowUp' });
// Full chip labels ("ExoPlayer (default)" / "MPV (beta)") — the bare engine
// name alone also appears as a Compare table cell.
const CHIP_TEXT: Record<string, string> = { ExoPlayer: 'ExoPlayer (default)', MPV: 'MPV (beta)' };
const chip = (label: string) => screen.getByText(CHIP_TEXT[label] ?? label, { exact: false }).closest('[data-focused]') as HTMLElement;

beforeEach(() => {
  h.prefs.clear();
  h.getEngines.mockReset();
  h.getEngines.mockImplementation(async () => ({ mpv: { available: true } }));
});
afterEach(() => { localStorage.clear(); });

describe('PlaybackScreen', () => {
  it('ExoPlayer is selected by default; Back leaves in one step', async () => {
    const onBack = vi.fn();
    render(<PlaybackScreen onBack={onBack} />);
    await wait();
    expect(chip('ExoPlayer').getAttribute('data-selected')).toBe('true');
    back();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('down to MPV, OK selects it and remembers it (Preferences)', async () => {
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    down();
    expect(chip('MPV').getAttribute('data-focused')).toBe('true');
    ok();
    await wait();
    expect(chip('MPV').getAttribute('data-selected')).toBe('true');
    expect(h.prefs.get('smc-player-engine-v1')).toBe('mpv');
  });

  it('MPV disabled shows why, and OK on it does nothing', async () => {
    h.getEngines.mockImplementation(async () => ({ mpv: { available: false, reason: 'android-too-old' } }));
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    expect(screen.getByText('Needs Android 8 or later')).toBeTruthy();
    down();
    ok();
    await wait();
    expect(chip('MPV').getAttribute('data-selected')).toBe('false');
    expect(h.prefs.get('smc-player-engine-v1')).toBeUndefined();
  });

  it('an app too old to answer getEngines treats MPV as unavailable, not a crash', async () => {
    h.getEngines.mockImplementation(async () => { throw new Error('not implemented'); });
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    expect(screen.getByText('Not in this build')).toBeTruthy();
  });

  it('shows the hint about volume past 100% being plain gain on MPV', async () => {
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    expect(screen.getByText(/plain gain/)).toBeTruthy();
  });

  it('the Compare table reads as dashes with nothing recorded yet', async () => {
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    const table = screen.getByRole('table');
    expect(table.textContent).toContain('ExoPlayer');
    expect(table.textContent).toContain('MPV');
    expect(table.textContent).toMatch(/—/);
  });

  it('Up from MPV goes back to ExoPlayer, Up again reaches Back', async () => {
    render(<PlaybackScreen onBack={() => {}} />);
    await wait();
    down();
    expect(chip('MPV').getAttribute('data-focused')).toBe('true');
    up();
    expect(chip('ExoPlayer').getAttribute('data-focused')).toBe('true');
  });
});
