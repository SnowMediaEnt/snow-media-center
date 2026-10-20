// "Still buffering?" — when it shows: 20 s of buffering without a break, or
// three stalls within two minutes after the channel's start-up (a reload's
// and a jump's buffering are start-up too); never with the error card,
// behind another layer, in the background, or for a channel it was meant
// for once another plays; it goes by itself with the error card or a
// channel change (no rest, not counted); 15 minutes' rest after the viewer
// closes it, three a day (in memory with storage off), the restart step
// left out once confirmed today; the VPN step asked on every service.
// Analytics carry no channel, host or address.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds } from '@/lib/xtream';

const h = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  appState: null as null | ((s: { isActive: boolean }) => void),
  hidden: false,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.trackEvent }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: async (_e: string, cb: (s: { isActive: boolean }) => void) => { h.appState = cb; return { remove() {} }; } },
}));

import { markSeek } from '@/lib/playerSeek';
import {
  BUFFER_HELP_STORE_KEY, LONG_STALL_MS, MAX_PER_DAY, SNOOZE_MS, START_GRACE_MS, STALL_MIN_MS,
  __resetBufferHelpMemoryForTests, bufferHelpSteps, readBufferHelpStore, useBufferingHelp,
} from './useBufferingHelp';

const DREAM: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p', output: 'ts', serverLabel: 'Dreamstreams' };
const OUTSIDE: XtreamCreds = { host: 'http://elsewhere.test', username: 'o', password: 'p', output: 'ts', serverLabel: 'My Other TV', outside: true };

interface P { buffering: boolean; error: boolean; busy: boolean; key: string | null; line: XtreamCreds; url: string | null; enabled: boolean }
const base: P = { buffering: false, error: false, busy: false, key: 'dream|101', line: DREAM, url: 'http://x/101.ts', enabled: true };

function setup(start: Partial<P> = {}) {
  let props: P = { ...base, ...start };
  const gone = vi.fn();
  const r = renderHook((p: P) => useBufferingHelp({
    enabled: p.enabled,
    watching: p.key ? { key: p.key, line: p.line } : null,
    loadKey: p.url,
    buffering: p.buffering,
    error: p.error,
    busy: p.busy,
    onGone: gone,
  }), { initialProps: props });
  const set = (patch: Partial<P>) => { props = { ...props, ...patch }; act(() => { r.rerender(props); }); };
  return { r, set, gone, open: () => r.result.current.open };
}
/** The app goes to the background (or comes back), as Android tells it. */
const background = (on: boolean) => act(() => {
  h.hidden = on;
  document.dispatchEvent(new Event('visibilitychange'));
  h.appState?.({ isActive: !on });
});
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** A stall of `ms`, then playing again. */
const stall = (s: ReturnType<typeof setup>, ms: number) => { s.set({ buffering: true }); wait(ms); s.set({ buffering: false }); };
const helpEvents = () => h.trackEvent.mock.calls.filter((c) => c[0] === 'buffering_help');

Object.defineProperty(document, 'hidden', { configurable: true, get: () => h.hidden });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 20, 0, 0));
  localStorage.clear();
  __resetBufferHelpMemoryForTests();
  markSeek(0);
  h.hidden = false;
  h.trackEvent.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('buffering without a break', () => {
  it('asks after 20 s, not before', () => {
    const s = setup();
    wait(START_GRACE_MS + 5000);
    s.set({ buffering: true });
    wait(LONG_STALL_MS - 1000);
    expect(s.open()).toBe(false);
    wait(1000);
    expect(s.open()).toBe(true);
    expect(s.r.result.current.steps).toEqual(['restart', 'vpn', 'guide']);
    expect(helpEvents()).toEqual([['buffering_help', 'player', { step: 'restart', action: 'shown', trigger: 'long', server: 'Dreamstreams' }]]);
  });

  it('a channel that takes 20 s to load counts too', () => {
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
  });

  it('quick start-up buffering asks nothing, and is not a stall', () => {
    const s = setup({ buffering: true });
    wait(4000);
    s.set({ buffering: false });
    wait(60_000);
    // Two real stalls after it: still under three.
    stall(s, 3000); wait(10_000);
    stall(s, 3000); wait(10_000);
    expect(s.open()).toBe(false);
    expect(helpEvents()).toEqual([]);
  });

  it('the picture coming back resets the 20 s', () => {
    const s = setup();
    wait(START_GRACE_MS);
    s.set({ buffering: true }); wait(15_000); s.set({ buffering: false });
    wait(500);
    s.set({ buffering: true }); wait(15_000);
    expect(s.open()).toBe(false);
  });

  it('a Kids profile or the demo (not enabled) never asks', () => {
    const s = setup({ enabled: false, buffering: true });
    wait(LONG_STALL_MS * 2);
    expect(s.open()).toBe(false);
  });
});

describe('stalls', () => {
  it('three within two minutes ask at the third, once it has lasted 2 s', () => {
    const s = setup();
    wait(START_GRACE_MS);
    stall(s, 3000); wait(20_000);
    stall(s, 3000); wait(20_000);
    s.set({ buffering: true });
    wait(STALL_MIN_MS - 100);
    expect(s.open()).toBe(false);
    wait(100);
    expect(s.open()).toBe(true);
    expect(helpEvents()[0][2]).toMatchObject({ action: 'shown', trigger: 'stalls' });
  });

  it('blips under 2 s do not count', () => {
    const s = setup();
    wait(START_GRACE_MS);
    for (let i = 0; i < 5; i++) { stall(s, 1500); wait(5000); }
    expect(s.open()).toBe(false);
  });

  it('three spread over more than two minutes do not ask', () => {
    const s = setup();
    wait(START_GRACE_MS);
    stall(s, 3000); wait(65_000);
    stall(s, 3000); wait(65_000);
    stall(s, 3000);
    expect(s.open()).toBe(false);
  });

  it('are counted per channel: a new one starts from none (and its start-up again)', () => {
    const s = setup();
    wait(START_GRACE_MS);
    stall(s, 3000); wait(10_000);
    stall(s, 3000); wait(10_000);
    s.set({ key: 'dream|102', url: 'http://x/102.ts' });
    wait(START_GRACE_MS);
    stall(s, 3000);
    expect(s.open()).toBe(false);
  });
});

describe('never', () => {
  it('with the error card up, and the card closes it', () => {
    const s = setup();
    wait(START_GRACE_MS);
    s.set({ buffering: true, error: true });
    wait(LONG_STALL_MS * 2);
    expect(s.open()).toBe(false);

    s.set({ error: false });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
    expect(readBufferHelpStore().shown).toBe(1);
    s.set({ error: true });
    expect(s.open()).toBe(false);
    expect(s.gone).toHaveBeenCalledWith('error');
    // Not the viewer's close: no rest, and not one of the day's.
    expect(readBufferHelpStore()).toMatchObject({ shown: 0, closedAt: 0 });
    s.set({ error: false });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
  });

  it('behind another layer: it waits, and shows once that closes if still buffering', () => {
    const s = setup({ busy: true });
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    wait(LONG_STALL_MS + 5000);
    expect(s.open()).toBe(false);
    s.set({ busy: false });
    expect(s.open()).toBe(true);
  });

  it('behind another layer, playing again before it closed: nothing', () => {
    const s = setup({ busy: true });
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    wait(LONG_STALL_MS + 5000);
    s.set({ buffering: false });
    s.set({ busy: false });
    expect(s.open()).toBe(false);
  });
});

describe('once open', () => {
  it('stays when the channel starts playing; closing starts the rest', () => {
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
    s.set({ buffering: false });
    wait(60_000);
    expect(s.open()).toBe(true);
    act(() => { s.r.result.current.close(); });
    expect(s.open()).toBe(false);
    expect(readBufferHelpStore().closedAt).toBe(Date.now());
  });

  it('goes when nothing is watched any more', () => {
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    s.set({ key: null });
    expect(s.open()).toBe(false);
    expect(s.gone).toHaveBeenCalledWith('channel');
  });

  it('goes when another channel plays under it (a voice "put on…"): no rest, not counted', () => {
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
    s.set({ key: 'dream|102', url: 'http://x/102.ts' });
    expect(s.open()).toBe(false);
    expect(s.gone).toHaveBeenCalledWith('channel');
    expect(readBufferHelpStore()).toMatchObject({ shown: 0, closedAt: 0 });
    // The new channel asks on its own, once it has buffered 20 s itself.
    wait(LONG_STALL_MS - 1000);
    expect(s.open()).toBe(false);
    wait(1000);
    expect(s.open()).toBe(true);
  });

  it('the viewer\'s close counts and rests; the error card\'s does not', () => {
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    act(() => { s.r.result.current.close(); });
    expect(s.gone).not.toHaveBeenCalled();
    expect(readBufferHelpStore()).toMatchObject({ shown: 1, closedAt: Date.now() });
  });
});

describe('not nagging', () => {
  const showAndClose = (s: ReturnType<typeof setup>) => {
    s.set({ buffering: true });
    wait(LONG_STALL_MS);
    const was = s.open();
    act(() => { s.r.result.current.close(); });
    s.set({ buffering: false });
    return was;
  };

  it('not again for 15 minutes after it closed', () => {
    const s = setup();
    wait(START_GRACE_MS);
    expect(showAndClose(s)).toBe(true);
    wait(SNOOZE_MS - LONG_STALL_MS - 1000);
    expect(showAndClose(s)).toBe(false);
    wait(LONG_STALL_MS + 2000);
    expect(showAndClose(s)).toBe(true);
  });

  it('three times a day at most; the next day again', () => {
    const s = setup();
    wait(START_GRACE_MS);
    for (let i = 0; i < MAX_PER_DAY; i++) {
      expect(showAndClose(s)).toBe(true);
      wait(SNOOZE_MS);
    }
    expect(showAndClose(s)).toBe(false);
    expect(readBufferHelpStore().shown).toBe(MAX_PER_DAY);
    vi.setSystemTime(new Date(2026, 9, 21, 9, 0, 0));
    expect(showAndClose(s)).toBe(true);
    expect(readBufferHelpStore().shown).toBe(1);
  });

  it('a restart confirmed today is not asked again today', () => {
    const s = setup();
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    wait(LONG_STALL_MS);
    act(() => { s.r.result.current.noteRestart(); s.r.result.current.close(); });
    s.set({ buffering: false });
    wait(SNOOZE_MS);
    s.set({ buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
    expect(s.r.result.current.steps).toEqual(['vpn', 'guide']);
    expect(helpEvents().at(-1)![2]).toMatchObject({ step: 'vpn', action: 'shown' });
    // Tomorrow it asks again.
    expect(bufferHelpSteps(readBufferHelpStore(new Date(2026, 9, 21, 9).getTime()))).toEqual(['restart', 'vpn', 'guide']);
  });

  it('a box with storage off keeps the rest and the day\'s count in memory', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('off'); });
    const put = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('off'); });
    try {
      const s = setup();
      wait(START_GRACE_MS);
      const showAndClose = () => {
        s.set({ buffering: true });
        wait(LONG_STALL_MS);
        const was = s.open();
        act(() => { s.r.result.current.close(); });
        s.set({ buffering: false });
        return was;
      };
      expect(showAndClose()).toBe(true);
      // Rested, as with storage.
      expect(showAndClose()).toBe(false);
      wait(SNOOZE_MS);
      expect(showAndClose()).toBe(true);
      wait(SNOOZE_MS);
      expect(showAndClose()).toBe(true);
      wait(SNOOZE_MS);
      // Three today: no fourth.
      expect(showAndClose()).toBe(false);
      expect(readBufferHelpStore().shown).toBe(MAX_PER_DAY);
    } finally { get.mockRestore(); put.mockRestore(); }
  });

  it('a broken stored value is ignored', () => {
    localStorage.setItem(BUFFER_HELP_STORE_KEY, '{nope');
    const s = setup({ buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
  });
});

describe('steps and analytics per line', () => {
  it('every service gets the VPN step, Vibez included; what was confirmed today is left out', () => {
    expect(bufferHelpSteps({ restart: false, vpn: false })).toEqual(['restart', 'vpn', 'guide']);
    expect(bufferHelpSteps({ restart: true, vpn: false })).toEqual(['vpn', 'guide']);
    expect(bufferHelpSteps({ restart: true, vpn: true })).toEqual(['guide']);
  });

  it('an outside service is only "outside" in analytics', () => {
    const s = setup({ line: OUTSIDE, buffering: true });
    wait(LONG_STALL_MS);
    expect(s.open()).toBe(true);
    const [, , props] = helpEvents()[0];
    expect(props).toEqual({ step: 'restart', action: 'shown', trigger: 'long', server: 'outside' });
    expect(JSON.stringify(props)).not.toMatch(/elsewhere|My Other TV/);
  });
});

describe('the review\'s cases', () => {
  it('a trigger kept for one channel never shows on the next one\'s start-up', () => {
    // Frozen 20 s with the list over the picture open (busy): it waits…
    const s = setup({ busy: true });
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    wait(LONG_STALL_MS + 2000);
    expect(s.open()).toBe(false);
    // …then OK on another channel closes the list and plays it, in one render.
    s.set({ busy: false, key: 'dream|102', url: 'http://x/102.ts', buffering: true });
    expect(s.open()).toBe(false);
    wait(5000);
    expect(s.open()).toBe(false);
    expect(helpEvents()).toEqual([]);
  });

  it('the buffering after a jump (rewind, catch-up, Go live) is not a stall', () => {
    const s = setup();
    wait(START_GRACE_MS);
    for (let i = 0; i < 3; i++) {
      markSeek();
      stall(s, 3000);
      wait(15_000);
    }
    expect(s.open()).toBe(false);
    // Long after a jump, stalls count again.
    wait(30_000);
    for (let i = 0; i < 3; i++) { stall(s, 3000); wait(10_000); }
    expect(s.open()).toBe(true);
  });

  it('a stall that begins just before a jump lands is not counted either', () => {
    const s = setup();
    wait(START_GRACE_MS);
    for (let i = 0; i < 3; i++) {
      s.set({ buffering: true });
      wait(500);
      markSeek();
      wait(2500);
      s.set({ buffering: false });
      wait(15_000);
    }
    expect(s.open()).toBe(false);
  });

  it('in the background: never shows, the clocks wait, and coming back is a start-up', () => {
    const s = setup();
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    wait(15_000);
    background(true);
    wait(LONG_STALL_MS * 3);
    expect(s.open()).toBe(false);
    expect(helpEvents()).toEqual([]);
    expect(readBufferHelpStore().shown).toBe(0);
    // Back: the player loads again (a new load), still buffering — the 20 s
    // starts over.
    background(false);
    s.set({ url: 'http://x/101.ts#1' });
    wait(LONG_STALL_MS - 1000);
    expect(s.open()).toBe(false);
    wait(1000);
    expect(s.open()).toBe(true);
  });

  it('a reload of the same address (retry, resume) is a start-up: its buffering is not a stall', () => {
    const s = setup();
    wait(START_GRACE_MS);
    stall(s, 3000); wait(10_000);
    stall(s, 3000); wait(10_000);
    // The player reloads (its load count goes up) and starts up again.
    s.set({ url: 'http://x/101.ts#1', buffering: true });
    wait(4000);
    s.set({ buffering: false });
    expect(s.open()).toBe(false);
  });

  it('a stream its provider keeps dropping (buffering through reloads) still asks after 20 s', () => {
    const s = setup();
    wait(START_GRACE_MS);
    s.set({ buffering: true });
    for (let n = 1; n <= 4; n++) { wait(5000); s.set({ url: `http://x/101.ts#${n}` }); }
    expect(s.open()).toBe(true);
  });
});
