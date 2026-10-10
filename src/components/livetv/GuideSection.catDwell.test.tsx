/**
 * The Guide's category bar loads the category its highlight rests on, as Live
 * TV's list does (owner, 2026-10-09: "they should auto load after 1 sec (so
 * they don't bother to load on a fast click past)").
 *
 * - Resting CATEGORY_DWELL_MS (1 s) on a chip shows its channels, while the
 *   Guide re-renders all the time (the Player above it handing it a fresh
 *   copy of the line and fresh callbacks every 100 ms).
 * - Moving ◀ ▶ through the bar faster downloads nothing; OK, ▼ into the grid
 *   or a click loads at once; a kept list shows after the short settle.
 * - The grid's highlighted row goes back to the top only when the category
 *   changes, not on a re-render or on Update Channels.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';

const h = vi.hoisted(() => ({ streams: vi.fn(), kept: new Set<string>() }));
const chans = (cat: string): XtreamLiveStream[] => Array.from({ length: 4 }, (_, i) => (
  { stream_id: Number(cat) * 100 + i + 1, name: `Testchan ${cat}-${i + 1}`, num: i + 1, category_id: cat }
));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getLiveCategories: async () => Array.from({ length: 8 }, (_, i) => ({ category_id: String(i + 1), category_name: `Group ${i + 1}` })),
  getLiveStreams: h.streams,
  hasLiveStreams: (_l: unknown, cat?: string) => h.kept.has(cat ?? 'ALL'),
  getShortEpg: () => new Promise(() => { /* never answers */ }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
// The native preview as a box runs it: its state changes re-render the Guide.
vi.mock('@/hooks/useNativePlayer', async () => {
  const { useEffect: useEff, useState: useSt } = await import('react');
  return {
    useNativePlayer: (args: { active: boolean }) => {
      const [buffering, setBuffering] = useSt(false);
      useEff(() => {
        if (!args.active) return;
        const t = setInterval(() => setBuffering((b) => !b), 100);
        return () => clearInterval(t);
      }, [args.active]);
      return { buffering, error: null, retry: () => {} };
    },
  };
});
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {} };
    },
  };
});

import Guide from './GuideSection';
import { CATEGORY_DWELL_MS, KEPT_CATEGORY_SETTLE_MS } from '@/lib/categoryDwell';
import { XTREAM_REFRESH_EVENT } from '@/lib/xtream';

const creds: XtreamCreds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts' };
const flush = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); }); };
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await flush(); };
const rest = async (ms: number) => { for (let left = ms; left > 0; left -= 100) await advance(Math.min(100, left)); };
const key = async (k: string, init: Partial<KeyboardEventInit> = {}) => { await act(async () => { fireEvent.keyDown(window, { key: k, ...init }); }); await flush(); };
const calls = (cat: string) => h.streams.mock.calls.filter((c) => c[1] === cat).length;
const allCalls = () => h.streams.mock.calls.length;
const grid = () => document.querySelector('[data-guide-grid]')?.textContent ?? '';
const chip = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-cat-i]')].find((el) => el.textContent === name);
const focusedRow = () => document.querySelector('[data-guide-grid] [data-focused="true"]')?.textContent ?? '';

let parentRenders = 0;
/** The Player above the Guide, re-rendering it every 100 ms with a fresh copy
 *  of the same line and fresh callbacks. */
const BusyPlayer = () => {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => { parentRenders += 1; setTick((n) => n + 1); }, 100); return () => clearInterval(t); }, []);
  return <Guide creds={{ ...creds }} isActive onExitLeft={() => undefined} />;
};

/** The Guide open on Group 1, its channels in. */
const open = async (busy = false) => {
  render(busy ? <BusyPlayer /> : <Guide creds={creds} isActive onExitLeft={vi.fn()} />);
  await flush();
  await advance(0);
  expect(grid()).toContain('Testchan 1-1');
};
/** ▲ from the grid's first row: the category bar. */
const toBar = async () => { await key('ArrowUp'); expect(chip('Group 1')?.getAttribute('data-focused')).toBe('true'); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  localStorage.clear(); sessionStorage.clear();
  h.kept.clear(); parentRenders = 0;
  h.streams.mockReset();
  h.streams.mockImplementation(async (_l: unknown, cat?: string) => chans(cat ?? '0'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Guide: a chip loads once the highlight rests on it for 1 s', () => {
  it('resting on a chip shows its channels, while the Guide re-renders every 100 ms (a fresh copy of the line each time)', async () => {
    await open(true);
    await rest(1500); // the first channel previews (the native player's events too)
    expect(calls('1')).toBe(1);
    await toBar();
    await key('ArrowRight');
    const before = parentRenders;
    await rest(CATEGORY_DWELL_MS - 100);
    expect(calls('2')).toBe(0);
    // Not the last category's rows under the new chip meanwhile.
    expect(grid()).not.toContain('Testchan 1-1');
    await rest(100);
    expect(calls('2')).toBe(1);
    expect(grid()).toContain('Testchan 2-1');
    expect(parentRenders - before).toBeGreaterThanOrEqual(9);
    await rest(2000);
    expect(calls('2')).toBe(1);
    expect(calls('1')).toBe(1);
  });

  it('moving through 5 chips at 300 ms each downloads nothing; the one it stops on loads after 1 s', async () => {
    await open(true);
    await toBar();
    for (let i = 0; i < 5; i++) {
      await key('ArrowRight');
      await rest(300);
    }
    expect(allCalls()).toBe(1);
    await rest(CATEGORY_DWELL_MS - 300);
    expect(calls('6')).toBe(1);
    expect(allCalls()).toBe(2);
    expect(grid()).toContain('Testchan 6-1');
  });

  it('holding ▶ through the bar downloads nothing', async () => {
    await open();
    await toBar();
    for (let i = 0; i < 6; i++) {
      await key('ArrowRight', { repeat: i > 0 });
      await advance(60);
    }
    expect(allCalls()).toBe(1);
    await rest(CATEGORY_DWELL_MS);
    expect(calls('7')).toBe(1);
  });

  it('OK on a chip loads at once; so does ▼ into the grid', async () => {
    await open();
    await toBar();
    await key('ArrowRight');
    await key('Enter');
    await advance(0);
    expect(calls('2')).toBe(1);
    expect(grid()).toContain('Testchan 2-1');
    await toBarFrom('Group 2');
    await key('ArrowRight');
    await key('ArrowDown');
    await advance(0);
    expect(calls('3')).toBe(1);
    expect(grid()).toContain('Testchan 3-1');
  });

  it('a click on a chip loads it at once', async () => {
    await open();
    await act(async () => { fireEvent.click(chip('Group 5')!); });
    await flush();
    await advance(0);
    expect(calls('5')).toBe(1);
    expect(grid()).toContain('Testchan 5-1');
  });

  it('a kept list (no download) shows after the short settle, never the 1 s rest', async () => {
    h.kept.add('2');
    await open();
    await toBar();
    await key('ArrowRight');
    await advance(KEPT_CATEGORY_SETTLE_MS - 10);
    expect(calls('2')).toBe(0);
    await advance(10);
    expect(calls('2')).toBe(1);
    expect(grid()).toContain('Testchan 2-1');
  });

  it('Favorites needs no download', async () => {
    await open();
    await toBar();
    await key('ArrowLeft'); // Favorites
    await rest(3000);
    expect(allCalls()).toBe(1);
  });

  it('the highlighted row stays through re-renders and Update Channels; a new category starts at the top', async () => {
    await open(true);
    await key('ArrowDown');
    await key('ArrowDown');
    expect(focusedRow()).toContain('Testchan 1-3');
    await rest(2000);
    expect(focusedRow()).toContain('Testchan 1-3');
    await act(async () => { window.dispatchEvent(new CustomEvent(XTREAM_REFRESH_EVENT, { detail: { nonce: 1, reason: 'update' } })); });
    await flush();
    await advance(0);
    expect(calls('1')).toBe(2); // asked again, at once
    expect(focusedRow()).toContain('Testchan 1-3');
    await act(async () => { fireEvent.click(chip('Group 2')!); });
    await flush();
    await advance(0);
    expect(focusedRow()).toContain('Testchan 2-1');
  });
});

/** ▲ back to the bar from the grid's first row, the chip still on `name`. */
async function toBarFrom(name: string) {
  await key('ArrowUp');
  expect(chip(name)?.getAttribute('data-focused')).toBe('true');
}
