/**
 * Live TV's categories load by themselves once the highlight rests on one
 * for 1 s, so the viewer no longer has to press OK to see a category's
 * channels, and passing over categories on the way to another downloads
 * nothing.
 *
 * - Resting CATEGORY_DWELL_MS (1 s) on a category downloads and shows its
 *   channels, while the section re-renders all the time (the Player above it
 *   handing it fresh callbacks every 100 ms).
 * - Passing over categories faster than that, or holding ▼, downloads nothing.
 * - OK, ▶ or a click loads at once; a kept list (no download) shows after
 *   the short settle, without a spinner; "All channels" is never fetched by
 *   resting on it; Favorites needs no download; Update Channels asks again.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';

const h = vi.hoisted(() => ({
  kept: new Set<string>(),
  streams: vi.fn(),
}));

const GROUPS = 8;
const chans = (cat: string): XtreamLiveStream[] => [
  { stream_id: Number(cat) * 100 + 1, name: `Testchan ${cat}-1`, num: 1, category_id: cat },
  { stream_id: Number(cat) * 100 + 2, name: `Testchan ${cat}-2`, num: 2, category_id: cat },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => Array.from({ length: GROUPS }, (_, i) => ({ category_id: String(i + 1), category_name: `Group ${i + 1}` })),
  getLiveStreams: h.streams,
  getShortEpg: () => new Promise(() => { /* never answers */ }),
  countLiveStreams: async () => ({ total: 0, byCat: {} }),
  hasLiveStreams: (_l: unknown, cat?: string) => h.kept.has(cat ?? 'ALL'),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => new Set<string>(),
  signalChannel: vi.fn(),
}));
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => 'classic',
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', async (orig) => ({ ...(await orig<typeof import('@/lib/watchHistory')>()), recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
vi.mock('./ReportChannelDialog', () => ({ default: () => <div data-testid="report" /> }));
// jsdom has no layout: every row is "on screen".
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {}, scrollToOffset: () => {}, scrollToIndex: () => {} };
    },
  };
});

import LiveSection from './LiveSection';
import { CATEGORY_DWELL_MS, KEPT_CATEGORY_SETTLE_MS } from '@/lib/categoryDwell';
import { XTREAM_REFRESH_EVENT } from '@/lib/xtream';

const creds: XtreamCreds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' };
const flush = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); }); };
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await flush(); };
/** The highlight stays put for `ms`, in 100 ms steps (the re-renders run between them). */
const rest = async (ms: number) => { for (let left = ms; left > 0; left -= 100) await advance(Math.min(100, left)); };
const key = async (k: string, init: Partial<KeyboardEventInit> = {}) => { await act(async () => { fireEvent.keyDown(window, { key: k, ...init }); }); await flush(); };
const keyUp = async (k: string) => { await act(async () => { fireEvent.keyUp(window, { key: k }); }); await flush(); };
const calls = (cat: string | undefined) => h.streams.mock.calls.filter((c) => c[1] === cat).length;
const allCalls = () => h.streams.mock.calls.length;
const text = () => document.body.textContent ?? '';
const catRow = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-cat-idx]')].find((el) => el.textContent?.includes(name));
const spinnerOn = (name: string) => !!catRow(name)?.querySelector('.animate-spin');

let parentRenders = 0;
/** The Player above the section, re-rendering it every 100 ms with fresh
 *  callbacks (the memo never holds). */
const BusyPlayer = () => {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => { parentRenders += 1; setTick((n) => n + 1); }, 100); return () => clearInterval(t); }, []);
  return <LiveSection creds={creds} isActive onExitLeft={() => undefined} onBack={() => undefined} />;
};

/** Live TV open on Group 1, its channels in (the section's own first list). */
const open = async (busy = false) => {
  render(busy ? <BusyPlayer /> : <LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
  await flush();
  await advance(0);
  expect(text()).toContain('Testchan 1-1');
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  localStorage.clear(); sessionStorage.clear();
  h.kept.clear(); parentRenders = 0;
  h.streams.mockReset();
  h.streams.mockImplementation(async (_l: unknown, cat?: string) => chans(cat ?? '0'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.className = ''; });

describe('Live TV: a category loads once the highlight rests on it for 1 s', () => {
  it('the dwell is 1 s; a kept list settles sooner', () => {
    expect(CATEGORY_DWELL_MS).toBe(1000);
    expect(KEPT_CATEGORY_SETTLE_MS).toBeLessThan(CATEGORY_DWELL_MS);
  });

  it('resting on a category loads its channels by themselves, while the section re-renders every 100 ms', async () => {
    await open(true);
    const before = parentRenders;
    await key('ArrowDown');
    expect(catRow('Group 2')?.getAttribute('data-focused')).toBe('true');
    await rest(CATEGORY_DWELL_MS - 100);
    expect(calls('2')).toBe(0);
    expect(text()).not.toContain('Testchan 2-1');
    await rest(100);
    expect(calls('2')).toBe(1);
    expect(text()).toContain('Testchan 2-1');
    // The re-renders really ran all through the rest (and nothing asked again).
    expect(parentRenders - before).toBeGreaterThanOrEqual(9);
    await rest(2000);
    expect(calls('2')).toBe(1);
  });

  it('passing over 5 categories at 300 ms each downloads nothing; the one it stops on loads after 1 s', async () => {
    await open(true);
    for (let i = 0; i < 5; i++) {
      await key('ArrowDown');
      await rest(300);
    }
    expect(allCalls()).toBe(1); // Group 1, the list Live TV opened on
    expect(catRow('Group 6')?.getAttribute('data-focused')).toBe('true');
    await rest(CATEGORY_DWELL_MS - 300);
    expect(calls('6')).toBe(1);
    expect(allCalls()).toBe(2);
    expect(text()).toContain('Testchan 6-1');
  });

  it('holding ▼ through the categories downloads nothing', async () => {
    await open();
    for (let i = 0; i < 6; i++) {
      await key('ArrowDown', { repeat: i > 0 });
      await advance(60);
    }
    expect(allCalls()).toBe(1);
    await rest(CATEGORY_DWELL_MS);
    expect(allCalls()).toBe(2);
    expect(calls('7')).toBe(1);
  });

  it('OK loads at once, and so does ▶', async () => {
    await open();
    await key('ArrowDown');
    await key('Enter');
    await keyUp('Enter');
    await advance(0);
    expect(calls('2')).toBe(1);
    expect(text()).toContain('Testchan 2-1');
    await key('ArrowLeft'); // back to the categories
    await key('ArrowDown');
    await key('ArrowRight');
    await advance(0);
    expect(calls('3')).toBe(1);
    expect(text()).toContain('Testchan 3-1');
  });

  it('a click on a category loads it at once', async () => {
    await open();
    await act(async () => { fireEvent.click(catRow('Group 4')!); });
    await flush();
    await advance(0);
    expect(calls('4')).toBe(1);
    expect(text()).toContain('Testchan 4-1');
  });

  it('a kept category (no download) draws after the short settle, never the 1 s rest, with no spinner', async () => {
    h.kept.add('2');
    await open();
    await key('ArrowDown');
    expect(spinnerOn('Group 2')).toBe(false);
    await advance(KEPT_CATEGORY_SETTLE_MS - 10);
    expect(calls('2')).toBe(0);
    await advance(10);
    expect(calls('2')).toBe(1);
    expect(text()).toContain('Testchan 2-1');
    expect(spinnerOn('Group 2')).toBe(false);
  });

  it('a category downloaded earlier in the visit shows at once when the highlight comes back to it', async () => {
    await open();
    await key('ArrowDown');
    await rest(CATEGORY_DWELL_MS);
    expect(calls('2')).toBe(1);
    await key('ArrowUp');
    expect(text()).toContain('Testchan 1-1');
    await key('ArrowDown');
    expect(text()).toContain('Testchan 2-1');
    expect(calls('2')).toBe(1);
  });

  it('"All channels" is never fetched by resting on it; OK opens it. Favorites needs no download', async () => {
    await open();
    await key('ArrowUp'); // All channels
    expect(catRow('All channels')?.getAttribute('data-focused')).toBe('true');
    await rest(3000);
    expect(calls(undefined)).toBe(0);
    await key('ArrowUp'); // Favorites
    await rest(3000);
    expect(allCalls()).toBe(1);
    await key('ArrowDown'); // All channels again
    await key('ArrowRight');
    await advance(0);
    expect(calls(undefined)).toBe(1);
  });

  it('the spinner shows only while a list downloads, and never stays on a category passed over', async () => {
    let answer: (v: XtreamLiveStream[]) => void = () => {};
    await open();
    h.streams.mockImplementation((_l: unknown, cat?: string) => (cat === '2' ? new Promise((r) => { answer = r; }) : Promise.resolve(chans(cat ?? '0'))));
    await key('ArrowDown');
    await rest(CATEGORY_DWELL_MS - 100);
    expect(spinnerOn('Group 2')).toBe(false); // resting is not downloading
    await rest(100);
    expect(spinnerOn('Group 2')).toBe(true); // downloading
    await key('ArrowDown'); // passed over before its answer came
    expect(spinnerOn('Group 2')).toBe(false);
    await act(async () => { answer(chans('2')); });
    await flush();
    expect(spinnerOn('Group 2')).toBe(false);
  });

  it('Update Channels asks again at once for the list on screen', async () => {
    await open();
    expect(calls('1')).toBe(1);
    await act(async () => { window.dispatchEvent(new CustomEvent(XTREAM_REFRESH_EVENT)); });
    await flush();
    await advance(0);
    expect(calls('1')).toBe(2);
    expect(text()).toContain('Testchan 1-1');
  });
});
