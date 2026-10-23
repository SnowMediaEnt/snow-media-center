/**
 * Live TV › Settings › Recording & Rewind (TRACKER 25): the switch and Max
 * rewind by remote, the "one extra stream" line, the explanation on a plan
 * that allows one stream, and Start early / End late for scheduled recordings.
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
import { PADDING_KEY, loadPadding } from '@/lib/recordSchedule';

const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const settle = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { localStorage.removeItem(REWIND_SETTINGS_KEY); localStorage.removeItem(PADDING_KEY); h.plan = 2; h.demo = false; });

describe('Rewind live TV settings', () => {
  it('says it uses one extra stream, only when the line has a free one, and yields to another TV', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    expect(EXTRA_STREAM_LINE).toBe('Uses one extra stream. It turns on only when your line has a free stream, and turns off by itself if another TV needs it.');
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


describe('Start early / End late', () => {
  const chips = (row: string) => Array.from(document.querySelectorAll(`[data-rewind-row="${row}"] span`)).map((n) => n.textContent);

  it('the screen is "Recording & Rewind", with the two rows and their choices', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    expect(document.querySelector('h1')?.textContent).toBe('Recording & Rewind');
    expect(chips('before')).toEqual(['0 min', '2 min', '5 min', '10 min']);
    expect(chips('after')).toEqual(['0 min', '5 min', '10 min', '15 min', '30 min']);
    // The defaults: 2 minutes early, 5 late.
    expect(loadPadding()).toEqual({ beforeMin: 2, afterMin: 5 });
  });

  it('◀▶ change them and the choice is kept', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    key('ArrowDown'); key('ArrowDown'); // Max rewind, then Start early
    expect(document.querySelector('[data-rewind-row="before"]')?.getAttribute('data-focused')).toBe('true');
    key('ArrowRight'); key('ArrowRight');
    expect(loadPadding().beforeMin).toBe(10);
    key('ArrowRight'); // the last choice stays
    expect(loadPadding().beforeMin).toBe(10);
    key('ArrowLeft');
    expect(loadPadding().beforeMin).toBe(5);
    key('ArrowDown'); // End late
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    expect(loadPadding().afterMin).toBe(30);
    expect(loadPadding()).toEqual({ beforeMin: 5, afterMin: 30 });
  });

  it('OK steps to the next choice and wraps round', async () => {
    render(<RewindSettingsScreen onBack={vi.fn()} />);
    await settle();
    key('ArrowDown'); key('ArrowDown'); // Start early
    key('Enter'); key('Enter'); key('Enter'); // 5, 10, back to 0
    expect(loadPadding().beforeMin).toBe(0);
  });

  it('beside the Settings menu: Left on the first row goes back to the menu, Right still switches Rewind', async () => {
    const onBack = vi.fn();
    render(<RewindSettingsScreen embedded active onBack={onBack} />);
    await settle();
    const before = loadRewindSettings().enabled;
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(loadRewindSettings().enabled).toBe(before);
    key('ArrowRight');
    expect(loadRewindSettings().enabled).toBe(!before);
  });
});


describe('Recording & Rewind, laid out to be read at a glance (owner, 2026-10-23)', () => {
  const about = () => document.querySelector('[data-rewind-about]');

  it('two groups, one line per setting, and the highlighted row explained in the box under the list', async () => {
    render(<RewindSettingsScreen embedded active onBack={vi.fn()} />);
    await settle();
    expect(Array.from(document.querySelectorAll('h3')).map((n) => n.textContent)).toEqual(['Rewind', 'Recording']);
    expect(about()?.getAttribute('data-rewind-about')).toBe('enabled');
    expect(about()?.textContent).toContain('Pause and go back on live channels.');
    key('ArrowDown');
    expect(about()?.getAttribute('data-rewind-about')).toBe('max');
    expect(about()?.textContent).toContain('Auto keeps as much as the box can spare');
    // What the buffer uses on this box goes with Max rewind.
    expect(document.querySelector('[data-rewind-usage]')?.textContent).toContain('On this box');
    expect(about()?.textContent).toContain('never wiped by rewind');
    key('ArrowDown');
    expect(about()?.textContent).toBe('A recording scheduled from the Guide starts this long before the programme.');
    key('ArrowDown');
    expect(about()?.textContent).toContain('It keeps recording this long after the programme ends.');
    // Each setting is one line: its name and its value or choices, nothing under them.
    for (const r of ['enabled', 'max', 'before', 'after']) {
      expect(document.querySelectorAll(`[data-rewind-row="${r}"] p`).length).toBe(1);
    }
  });

  it('a tap on a row shows what it does (and a tap on a choice picks it)', async () => {
    render(<RewindSettingsScreen embedded active onBack={vi.fn()} />);
    await settle();
    fireEvent.click(document.querySelector('[data-rewind-row="after"]')!);
    expect(about()?.getAttribute('data-rewind-about')).toBe('after');
    const thirty = Array.from(document.querySelectorAll('[data-rewind-row="after"] span')).find((n) => n.textContent === '30 min')!;
    fireEvent.click(thirty);
    expect(loadPadding().afterMin).toBe(30);
  });
});
