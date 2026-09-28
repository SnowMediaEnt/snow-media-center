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
  h.calls.length = 0; h.toast.mockClear(); h.focusInput.mockClear();
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
