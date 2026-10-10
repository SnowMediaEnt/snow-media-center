/**
 * Live TV › Recordings (TRACKER 25): list (part files of a long recording are
 * rows of their own), the OK menu (Play / Rename / Delete with a confirm /
 * Stop), Rename by the app's keyboard rule (OK asks for the keyboard, nothing
 * autofocuses, Enter saves), full-screen playback on the transparent
 * snowplayer-fullscreen layer, and one Back = one step.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  items: [] as Array<Record<string, unknown>>,
  schedules: [] as Array<Record<string, unknown>>,
  canExact: true,
  toast: vi.fn(),
  focusInput: vi.fn(),
}));

vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => { window.dispatchEvent(new CustomEvent('smc-recordings:changed')); },
  SnowRecorder: {
    list: async () => ({
      recordings: h.items,
      volumes: [{ id: 'box', label: 'This box', removable: false, freeBytes: 30 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 }],
    }),
    remove: async (o: Record<string, unknown>) => { h.calls.push({ fn: 'remove', opts: o }); },
    rename: async (o: Record<string, unknown>) => { h.calls.push({ fn: 'rename', opts: o }); return { path: 'x', name: 'x', playUrl: 'file:///x' }; },
    stop: async (o: Record<string, unknown>) => { h.calls.push({ fn: 'stop', opts: o }); },
    listSchedules: async () => ({ schedules: h.schedules }),
    cancelSchedule: async (o: Record<string, unknown>) => { h.calls.push({ fn: 'cancelSchedule', opts: o }); },
    exactAlarmStatus: async () => ({ canExact: h.canExact, canOpenSettings: true }),
    openExactAlarmSettings: async () => { h.calls.push({ fn: 'openExactAlarmSettings' }); },
  },
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: { stop: async () => { h.calls.push({ fn: 'player-stop' }); } },
}));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: { url: string }) => {
    h.calls.push({ fn: 'play', opts: { url: a.url } });
    return { controller: { togglePlay: vi.fn() }, paused: false, error: null, getPosition: async () => ({ position: 5, duration: 100 }), seekTo: async () => {} };
  },
}));
vi.mock('@/utils/dpadKeyboard', () => ({
  focusTextInputForDpad: (el: HTMLElement | null) => { h.focusInput(el); },
  hideKeyboardForDpad: async () => {},
}));
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast }));

import RecordingsScreen from './RecordingsScreen';

const rec = (over: Record<string, unknown>) => ({
  id: 'a', name: 'CNN – 2026-09-28 20.00', channel: 'CNN', path: '/r/a.ts', playUrl: 'file:///r/a.ts',
  bytes: 3 * 1024 ** 3, startedAt: Date.UTC(2026, 8, 28, 20, 0), durationSec: 3600, recording: false, volumeId: 'box', volumeLabel: 'This box', ...over,
});

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const okKey = () => { key('Enter'); act(() => { fireEvent.keyUp(window, { key: 'Enter' }); }); };
const up = () => act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
const rows = () => document.querySelectorAll('[data-recording-row]');
const menuRows = () => Array.from(document.querySelectorAll('[data-menu-row]')).map((n) => n.getAttribute('data-menu-row'));

async function open(onClose = vi.fn()) {
  render(<RecordingsScreen onClose={onClose} />);
  await settle();
  up(); // the OK that opened the screen is released
  return onClose;
}

beforeEach(() => {
  h.calls.length = 0; h.toast.mockClear(); h.focusInput.mockClear(); h.schedules = []; h.canExact = true;
  h.items = [
    rec({}),
    rec({ id: 'a-p2', name: 'CNN – 2026-09-28 20.00 (part 2)', path: '/r/a (part 2).ts', playUrl: 'file:///r/a2.ts', volumeId: 'usb', volumeLabel: 'USB drive' }),
    rec({ id: 'b', name: 'BBC – live', path: '/r/b.ts', playUrl: 'file:///r/b.ts', recording: true }),
  ];
});
afterEach(() => { document.documentElement.className = ''; });

describe('the list', () => {
  it('lists every file, a part file as a row of its own, with free space per drive', async () => {
    await open();
    expect(rows()).toHaveLength(3);
    expect(document.body.textContent).toContain('(part 2)');
    expect(document.body.textContent).toContain('This box: 30.0 GB free');
    expect(document.body.textContent).toContain('Recording now');
  });

  it('a recording that is still going offers Stop, not Rename / Delete', async () => {
    await open();
    key('ArrowDown'); key('ArrowDown');
    okKey();
    expect(menuRows()).toEqual(['play', 'stop', 'cancel']);
    key('ArrowDown'); okKey();
    await settle();
    expect(h.calls.find((c) => c.fn === 'stop')?.opts).toEqual({ id: 'b' });
  });
});

describe('Delete asks first', () => {
  it('starts on Keep it; Delete it removes the file', async () => {
    await open();
    okKey(); // menu on the first row
    expect(menuRows()).toEqual(['play', 'rename', 'delete', 'cancel']);
    key('ArrowDown'); key('ArrowDown'); okKey(); // Delete
    expect(document.querySelector('[data-menu-row="keep"]')?.getAttribute('data-focused')).toBe('true');
    okKey(); // Keep it: nothing removed, back to the menu
    expect(h.calls.find((c) => c.fn === 'remove')).toBeUndefined();
    key('ArrowDown'); key('ArrowDown'); okKey(); // Delete again
    key('ArrowUp'); okKey(); // Delete it
    await settle();
    expect(h.calls.find((c) => c.fn === 'remove')?.opts).toEqual({ path: '/r/a.ts' });
  });
});

describe('one Back = one step', () => {
  it('confirm → menu → list → out', async () => {
    const onClose = await open();
    okKey();
    key('ArrowDown'); key('ArrowDown'); okKey(); // the delete question
    expect(document.querySelector('[data-menu-row="sure"]')).not.toBeNull();
    key('Escape');
    expect(document.querySelector('[data-menu-row="sure"]')).toBeNull();
    expect(menuRows()).toContain('delete');
    key('Escape');
    expect(document.querySelector('[data-recording-menu]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Rename uses the keyboard path of the app', () => {
  const openRename = async () => {
    await open();
    okKey(); key('ArrowDown'); okKey(); // Rename
    up();
  };

  it('nothing autofocuses; OK on the field asks for the keyboard; Enter saves', async () => {
    await openRename();
    const input = document.querySelector('[data-recording-rename] input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).not.toBe(input);
    expect(h.focusInput).not.toHaveBeenCalled();
    okKey();
    expect(h.focusInput).toHaveBeenCalledWith(input);
    fireEvent.change(input, { target: { value: 'Match of the day' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 850)); });
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await settle();
    expect(h.calls.find((c) => c.fn === 'rename')?.opts).toEqual({ path: '/r/a.ts', name: 'Match of the day' });
  });

  it('Back with no keyboard up cancels the rename and nothing else', async () => {
    const onClose = vi.fn();
    render(<RecordingsScreen onClose={onClose} />);
    await settle(); up();
    okKey(); key('ArrowDown'); okKey(); up();
    key('Escape');
    expect(document.querySelector('[data-recording-rename]')).toBeNull();
    expect(document.querySelector('[data-recordings-screen]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(h.calls.find((c) => c.fn === 'rename')).toBeUndefined();
  });
});

describe('playing a recording', () => {
  it('plays full screen on a transparent layer, and Back returns to the list', async () => {
    await open();
    okKey(); okKey(); // menu, then Play
    expect(document.querySelector('[data-recording-player]')).not.toBeNull();
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(true);
    expect((document.querySelector('[data-recording-player]') as HTMLElement).className).toMatch(/bg-transparent/);
    expect(h.calls.find((c) => c.fn === 'play')?.opts?.url).toBe('file:///r/a.ts');
    key('Escape');
    await settle();
    expect(document.querySelector('[data-recording-player]')).toBeNull();
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(false);
    expect(document.querySelector('[data-recordings-screen]')).not.toBeNull();
    expect(h.calls.some((c) => c.fn === 'player-stop')).toBe(true);
  });
});


// ---- scheduled recordings (TRACKER 25.13) -------------------------------------

const HOUR = 3_600_000;
const sched = (over: Record<string, unknown>) => ({
  id: 's1', streamId: 301, channelName: 'CNN', programmeTitle: 'The News',
  startUtcMs: Date.now() + 5 * HOUR, endUtcMs: Date.now() + 6 * HOUR, padBeforeMin: 2, padAfterMin: 5,
  volumeId: 'box', status: 'scheduled', finishedAtMs: 0, ...over,
});
const headings = () => Array.from(document.querySelectorAll('[data-recordings-heading]')).map((n) => n.textContent);
const rowKinds = () => Array.from(document.querySelectorAll('[data-recording-row]')).map((n) =>
  n.hasAttribute('data-scheduled-row') ? 'sched' : n.hasAttribute('data-issue-row') ? 'issue' : n.hasAttribute('data-recordings-banner') ? 'banner' : 'rec');

describe('Scheduled group', () => {
  beforeEach(() => {
    h.items = [rec({})];
    h.schedules = [
      sched({ id: 's2', programmeTitle: 'Late Film', startUtcMs: Date.now() + 9 * HOUR, endUtcMs: Date.now() + 11 * HOUR }),
      sched({ id: 's1' }),
      sched({ id: 'm1', programmeTitle: 'Morning Show', status: 'missed', reason: 'The box was off or SMC was force-stopped.', startUtcMs: Date.now() - 20 * HOUR, endUtcMs: Date.now() - 19 * HOUR, finishedAtMs: Date.now() - HOUR }),
      sched({ id: 'f1', programmeTitle: 'Cup Final', status: 'failed', reason: 'Not enough free space.', startUtcMs: Date.now() - 30 * HOUR, endUtcMs: Date.now() - 29 * HOUR, finishedAtMs: Date.now() - 2 * HOUR }),
      sched({ id: 'd1', programmeTitle: 'Done One', status: 'done' }),
      sched({ id: 'r1', programmeTitle: 'Going Now', status: 'recording' }),
    ];
  });

  it('lists scheduled ones first (soonest first), then missed / failed, then the recordings; done and running ones are not rows', async () => {
    await open();
    expect(rowKinds()).toEqual(['sched', 'sched', 'issue', 'issue', 'rec']);
    expect(headings()).toEqual(['Scheduled', "Missed / didn't start", 'Recordings']);
    const first = document.querySelector('[data-scheduled-row="s1"]')!;
    expect(first.textContent).toContain('The News');
    // Day and time, channel and drive, and the padded times.
    // 12-hour clock in every language (owner's choice).
    expect(first.textContent).toMatch(/(Today|Tomorrow) \d{1,2}:\d\d\s[AP]M/);
    expect(first.textContent).toContain('CNN · This box');
    expect(first.textContent).toMatch(/\d{1,2}:\d\d\s[AP]M \u2192 \d{1,2}:\d\d\s[AP]M/);
    expect(document.querySelector('[data-scheduled-row="s2"]')).not.toBeNull();
    expect(document.querySelector('[data-scheduled-row="d1"]')).toBeNull();
    expect(document.querySelector('[data-scheduled-row="r1"]')).toBeNull();
  });

  it('missed and failed rows say why, in plain words', async () => {
    await open();
    const m = document.querySelector('[data-issue-row="m1"]')!;
    expect(m.textContent).toContain('Morning Show');
    expect(m.textContent).toContain('Missed');
    expect(m.textContent).toContain('The box was off or SMC was force-stopped.');
    const f = document.querySelector('[data-issue-row="f1"]')!;
    expect(f.textContent).toContain("Didn't start");
    expect(f.textContent).toContain('Not enough free space.');
  });

  it('OK on a scheduled one offers Cancel schedule (asks first, starts on Keep) or Back', async () => {
    await open();
    okKey();
    expect(menuRows()).toEqual(['cancelSchedule', 'cancel']);
    expect(document.querySelector('[data-menu-row="cancel"]')?.textContent).toBe('Back');
    okKey(); // Cancel schedule → the question
    expect(document.querySelector('[data-menu-row="keep"]')?.getAttribute('data-focused')).toBe('true');
    expect(document.body.textContent).toContain('Cancel this scheduled recording?');
    okKey(); // Keep the schedule: back to the menu, nothing cancelled
    expect(h.calls.find((c) => c.fn === 'cancelSchedule')).toBeUndefined();
    expect(menuRows()).toEqual(['cancelSchedule', 'cancel']);
    okKey(); key('ArrowUp'); okKey(); // Cancel schedule → Cancel it
    await settle();
    expect(h.calls.find((c) => c.fn === 'cancelSchedule')?.opts).toEqual({ id: 's1' });
  });

  it('one Back = one step: question → menu → list → out', async () => {
    const onClose = await open();
    okKey(); okKey();
    expect(document.querySelector('[data-menu-row="sure"]')).not.toBeNull();
    key('Escape');
    expect(menuRows()).toEqual(['cancelSchedule', 'cancel']);
    key('Escape');
    expect(document.querySelector('[data-recording-menu]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a missed one is dismissed at once (no question)', async () => {
    await open();
    key('ArrowDown'); key('ArrowDown'); // the first missed row
    okKey();
    expect(menuRows()).toEqual(['dismiss', 'cancel']);
    okKey();
    await settle();
    expect(h.calls.find((c) => c.fn === 'cancelSchedule')?.opts).toEqual({ id: 'm1' });
    expect(document.querySelector('[data-menu-row="sure"]')).toBeNull();
  });

  it('shows the lists even with no recording file at all', async () => {
    h.items = [];
    await open();
    expect(rowKinds()).toEqual(['sched', 'sched', 'issue', 'issue']);
    expect(document.body.textContent).not.toContain('No recordings yet');
  });

  it('says how to start one when there is nothing at all', async () => {
    h.items = []; h.schedules = [];
    await open();
    expect(document.body.textContent).toContain('No recordings yet');
    expect(document.body.textContent).toContain('hold OK on a channel in the Guide');
  });
});

describe('exact-alarm banner', () => {
  beforeEach(() => { h.items = []; h.schedules = [sched({})]; });

  it('is not there when the box allows exact alarms', async () => {
    await open();
    expect(document.querySelector('[data-recordings-banner]')).toBeNull();
  });

  it('warns that scheduled recordings may start late, and OK opens the system page', async () => {
    h.canExact = false;
    await open();
    expect(rowKinds()).toEqual(['banner', 'sched']);
    const b = document.querySelector('[data-recordings-banner]')!;
    expect(b.textContent).toContain('This box may start scheduled recordings late.');
    expect(b.textContent).toContain('Open settings');
    okKey();
    await settle();
    expect(h.calls.some((c) => c.fn === 'openExactAlarmSettings')).toBe(true);
    // It is a button, not a menu.
    expect(document.querySelector('[data-recording-menu]')).toBeNull();
  });

  it('is not shown when nothing is scheduled (nothing to start late)', async () => {
    h.canExact = false;
    h.schedules = [];
    await open();
    expect(document.querySelector('[data-recordings-banner]')).toBeNull();
  });
});

describe('the key hint never covers a row', () => {
  // At 960x540 the list pane is 300 px tall; each row is 64 px with 8 px
  // between, drawn from the pane's scroll position.
  const PANE_TOP = 100;
  const PANE_H = 300;
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  const box = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 540 });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const pane = document.querySelector('[data-recordings-list]') as HTMLElement | null;
      if (pane && this === pane) return box(PANE_TOP, PANE_H);
      if (pane && this.hasAttribute('data-recording-row')) {
        const shown = Array.from(pane.querySelectorAll('[data-recording-row]'));
        return box(PANE_TOP + shown.indexOf(this) * 72 - pane.scrollTop, 64);
      }
      return realRect.call(this);
    };
  });
  afterEach(() => { HTMLElement.prototype.getBoundingClientRect = realRect; });

  it('the hint sits outside the list, and the list follows the highlight down and back up', async () => {
    h.items = Array.from({ length: 5 }, (_, n) => rec({ id: `r${n}`, name: `Show ${n}`, path: `/r/${n}.ts`, playUrl: `file:///r/${n}.ts` }));
    await open();
    const pane = document.querySelector('[data-recordings-list]') as HTMLElement;
    const hint = document.querySelector('[data-recordings-hint]') as HTMLElement;
    expect(pane.contains(hint)).toBe(false);
    for (let n = 0; n < 4; n++) key('ArrowDown');
    const last = document.querySelector('[data-recording-row="4"]') as HTMLElement;
    expect(last.getAttribute('data-focused')).toBe('true');
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(PANE_TOP + PANE_H);
    for (let n = 0; n < 4; n++) key('ArrowUp');
    expect(pane.scrollTop).toBe(0);
  });
});
