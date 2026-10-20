// "Still buffering?" — when it shows: 20 s of buffering without a break, or
// three stalls within two minutes after the channel's start-up; never with
// the error card or behind another layer; 15 minutes' rest after it closes,
// three a day, the restart step left out once confirmed today; the VPN step
// left out on a Vibez line. Analytics carry no channel, host or address.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds } from '@/lib/xtream';

const h = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.trackEvent }));

import {
  BUFFER_HELP_STORE_KEY, LONG_STALL_MS, MAX_PER_DAY, SNOOZE_MS, START_GRACE_MS, STALL_MIN_MS,
  bufferHelpSteps, readBufferHelpStore, useBufferingHelp,
} from './useBufferingHelp';

const DREAM: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p', output: 'ts', serverLabel: 'Dreamstreams' };
const VIBEZ: XtreamCreds = { host: 'https://strmz.xyz', username: 'v', password: 'p', output: 'ts', serverLabel: 'Vibez' };
const OUTSIDE: XtreamCreds = { host: 'http://elsewhere.test', username: 'o', password: 'p', output: 'ts', serverLabel: 'My Other TV', outside: true };

interface P { buffering: boolean; error: boolean; busy: boolean; key: string | null; line: XtreamCreds; url: string | null; enabled: boolean }
const base: P = { buffering: false, error: false, busy: false, key: 'dream|101', line: DREAM, url: 'http://x/101.ts', enabled: true };

function setup(start: Partial<P> = {}) {
  let props: P = { ...base, ...start };
  const r = renderHook((p: P) => useBufferingHelp({
    enabled: p.enabled,
    watching: p.key ? { key: p.key, line: p.line } : null,
    loadKey: p.url,
    buffering: p.buffering,
    error: p.error,
    busy: p.busy,
  }), { initialProps: props });
  const set = (patch: Partial<P>) => { props = { ...props, ...patch }; act(() => { r.rerender(props); }); };
  return { r, set, open: () => r.result.current.open };
}
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
/** A stall of `ms`, then playing again. */
const stall = (s: ReturnType<typeof setup>, ms: number) => { s.set({ buffering: true }); wait(ms); s.set({ buffering: false }); };
const helpEvents = () => h.trackEvent.mock.calls.filter((c) => c[0] === 'buffering_help');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 20, 0, 0));
  localStorage.clear();
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
    s.set({ error: true });
    expect(s.open()).toBe(false);
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
    expect(bufferHelpSteps(readBufferHelpStore(new Date(2026, 9, 21, 9).getTime()), DREAM)).toEqual(['restart', 'vpn', 'guide']);
  });

  it('a box with storage off still works (and asks every time)', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('off'); });
    const put = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('off'); });
    try {
      const s = setup({ buffering: true });
      wait(LONG_STALL_MS);
      expect(s.open()).toBe(true);
      act(() => { s.r.result.current.close(); });
      expect(s.open()).toBe(false);
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
  it('a Vibez line skips the VPN step (the guide says it does not work there)', () => {
    expect(bufferHelpSteps({ restart: false, vpn: false }, VIBEZ)).toEqual(['restart', 'guide']);
    expect(bufferHelpSteps({ restart: false, vpn: false }, { ...VIBEZ, serverLabel: undefined })).toEqual(['restart', 'guide']);
    expect(bufferHelpSteps({ restart: true, vpn: true }, DREAM)).toEqual(['guide']);
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
