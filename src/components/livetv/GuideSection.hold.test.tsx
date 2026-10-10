/**
 * The Guide: holding OK on a channel saves it to Favorites (owner,
 * 2026-10-09: "holding the ok button on a channel saves the channel to your
 * favorites"). Live TV's detection: keydown starts a 600 ms hold, a release
 * before it is a press (it watches the channel), a release after it is
 * consumed. Held again, it comes out. The line's own list (Live TV's
 * Favorites reads it; another service's line keeps its own); a toast says
 * which; the row's star at once; nothing plays and the highlight stays on
 * the row. A finger held on a row (or a right click) does the same.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });
// Each test loads a fresh Guide module and holds OK in real time.
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const LONG = 'EVENT 03: Rivertown Hawks vs Lakeside Owls 7:30 PM ET';

const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  streamCalls: [] as string[],
  toasts: [] as Array<{ title?: unknown; description?: unknown }>,
}));

vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  const now = () => Math.floor(Date.now() / 1000);
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    getLiveStreams: async (_c: unknown, categoryId?: string) => {
      api.streamCalls.push(String(categoryId));
      return api.streams[String(categoryId)] ?? [];
    },
    // The event channel (500) has no listings; the others one programme.
    getShortEpg: async (_c: unknown, streamId: number) => (streamId === 500
      ? { epg_listings: [] }
      : { epg_listings: [{ title: btoa(`Show ${streamId}`), start: '', end: '', start_timestamp: String(now() - 600), stop_timestamp: String(now() + 3000) }] }),
  };
});
vi.mock('@/hooks/use-toast', () => ({
  toast: (t: { title?: unknown; description?: unknown }) => { api.toasts.push(t); return { id: '1', dismiss() {}, update() {} }; },
  useToast: () => ({ toasts: [], toast: () => ({}), dismiss: () => {} }),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => false }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: ({ src }: { src: string | null }) => <div data-testid="video" data-src={src ?? ''} /> }));
// jsdom has no layout: every row is "on screen".
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

const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const down = (k = 'Enter', repeat = false) => act(() => { fireEvent.keyDown(document.body, { key: k, repeat }); });
const up = (k = 'Enter') => act(() => { fireEvent.keyUp(document.body, { key: k }); });
const press = async (k: string) => { down(k); up(k); };
/** OK held like a remote: down, its repeats, up after `ms`. */
const holdOk = async (ms = 750) => {
  down();
  await wait(300); down('Enter', true);
  await wait(ms - 300);
  up();
};
const rowEls = () => [...document.querySelectorAll<HTMLElement>('[data-guide-grid] [data-focused]')];
const nameOf = (row: Element) => row.querySelector('[data-guide-name]')?.textContent ?? null;
const focusedName = () => { const r = rowEls().find((el) => el.getAttribute('data-focused') === 'true'); return r ? nameOf(r) : null; };
const starOn = (name: string) => !!rowEls().find((r) => nameOf(r) === name)?.querySelector('[data-guide-fav]');
const savedIds = () => (JSON.parse(localStorage.getItem('snow-livetv-favs-v2') || '[]') as Array<{ stream_id: number }>).map((f) => f.stream_id);
const seeRow = (name: string) => waitFor(() => expect(rowEls().map(nameOf)).toContain(name));

async function freshGuide() {
  vi.resetModules();
  const { default: Guide } = await import('./GuideSection');
  const sync = await import('@/lib/favoritesSync');
  return { Guide, sync };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.categories = [{ category_id: '1', category_name: 'Events' }, { category_id: '2', category_name: 'News' }];
  api.streams = {
    1: [
      { stream_id: 500, name: LONG, category_id: '1', num: 3 },
      { stream_id: 501, name: 'News One', category_id: '1', num: 4 },
    ],
  };
  api.streamCalls = [];
  api.toasts = [];
});
afterEach(() => { sessionStorage.clear(); });

describe('Guide: hold OK saves the channel to Favorites', () => {
  it('held 600 ms: added to the line\'s list, a toast with its name, the star at once; nothing plays, the same row', async () => {
    const { Guide, sync } = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    await seeRow(LONG);
    expect(focusedName()).toBe(LONG);
    expect(starOn(LONG)).toBe(false);

    await holdOk();
    expect(api.toasts).toEqual([{ title: 'Added to Favorites', description: LONG }]);
    expect(starOn(LONG)).toBe(true);
    // Live TV's store: what its list (and its Favorites) reads.
    expect(savedIds()).toEqual([500]);
    expect([...sync.loadFavoritesForLine(line as never).keys()]).toEqual([500]);
    expect(onWatch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
    expect(focusedName()).toBe(LONG);
  });

  it('held again: taken out ("Removed from Favorites"), the star goes', async () => {
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await seeRow(LONG);
    await holdOk();
    await holdOk();
    expect(api.toasts.map((t) => t.title)).toEqual(['Added to Favorites', 'Removed from Favorites']);
    expect(starOn(LONG)).toBe(false);
    expect(savedIds()).toEqual([]);
  });

  it('the Favorites chip lists it at once, with no line-up downloaded; held out there, the highlight stays on the list', async () => {
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await seeRow(LONG);
    await holdOk();
    await press('ArrowDown');
    await holdOk();
    expect(api.toasts[1]).toEqual({ title: 'Added to Favorites', description: 'News One' });
    const calls = api.streamCalls.length;
    await press('ArrowUp'); await press('ArrowUp'); // to the bar
    await press('ArrowLeft'); // Favorites
    await waitFor(() => expect(rowEls().map(nameOf)).toEqual([LONG, 'News One']));
    expect(starOn('News One')).toBe(true);
    expect(api.streamCalls.length).toBe(calls);
    // The last favourite held out: the row above it has the highlight.
    await press('ArrowDown'); await press('ArrowDown');
    expect(focusedName()).toBe('News One');
    await holdOk();
    await waitFor(() => expect(rowEls().map(nameOf)).toEqual([LONG]));
    expect(focusedName()).toBe(LONG);
  });

  it('a short press still watches it (as before) and saves nothing', async () => {
    const { Guide } = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    await seeRow(LONG);
    down();
    await wait(120);
    up();
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(onWatch.mock.calls[0][0]).toMatchObject({ channel: 500, cat: '1' });
    expect(api.toasts).toEqual([]);
    expect(savedIds()).toEqual([]);
  });

  it("a held OK's repeats save once and play nothing; its release is consumed; the next press plays", async () => {
    const { Guide } = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    await seeRow(LONG);
    down();
    for (let i = 0; i < 8; i++) { await wait(120); down('Enter', true); }
    up();
    expect(api.toasts).toHaveLength(1);
    expect(onWatch).not.toHaveBeenCalled();
    await press('Enter');
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(api.toasts).toHaveLength(1);
  });

  it('the Guide without onWatch (its own player): the hold still only saves; a press plays full screen', async () => {
    const { Guide } = await freshGuide();
    const { findByTestId, queryByTestId } = render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow(LONG);
    await holdOk();
    expect(queryByTestId('video')).toBeNull();
    expect(savedIds()).toEqual([500]);
    await press('Enter');
    expect((await findByTestId('video')).getAttribute('data-src')).toBe('http://h/live/u/p/500.m3u8');
  });

  it('a finger held on a row, then lifted, saves it too (not a tap: nothing plays); a right click as well', async () => {
    const { Guide } = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    await seeRow('News One');
    const row = rowEls().find((r) => nameOf(r) === 'News One')!;
    act(() => { fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 50, identifier: 1 }], changedTouches: [{ clientX: 50, clientY: 50, identifier: 1 }] }); });
    await wait(700);
    act(() => { fireEvent.touchEnd(row, { changedTouches: [{ clientX: 50, clientY: 50, identifier: 1 }], cancelable: true }); });
    act(() => { fireEvent.click(row); }); // the lift's click, if one comes
    expect(api.toasts).toEqual([{ title: 'Added to Favorites', description: 'News One' }]);
    expect(onWatch).not.toHaveBeenCalled();
    expect(savedIds()).toEqual([501]);
    // A mouse's right click (an air mouse): at once.
    act(() => { fireEvent.contextMenu(rowEls().find((r) => nameOf(r) === LONG)!); });
    expect(savedIds()).toEqual([501, 500]);
  });

  it('a finger that moves is scrolling: nothing is saved', async () => {
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await seeRow('News One');
    const row = rowEls().find((r) => nameOf(r) === 'News One')!;
    act(() => { fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 50, identifier: 1 }] }); });
    await wait(200);
    act(() => { fireEvent.touchMove(row, { touches: [{ clientX: 50, clientY: 20, identifier: 1 }] }); });
    await wait(600);
    expect(api.toasts).toEqual([]);
    expect(savedIds()).toEqual([]);
  });

  it('inactive (the side menu has the remote): a held OK does nothing', async () => {
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive={false} onExitLeft={() => {}} onWatch={() => {}} />);
    await seeRow(LONG);
    await holdOk();
    expect(api.toasts).toEqual([]);
    expect(savedIds()).toEqual([]);
  });

  it("another service's line: the favourite goes to that line's own list, not the active one's", async () => {
    const { Guide, sync } = await freshGuide();
    const active = { host: 'http://other.test', username: 'v', password: 'q' };
    // Live TV last saved the other service's line: the box's own list is that line's.
    sync.commitFavoritesForLine(active as never, new Map([[9, { stream_id: 9, name: 'Other Sports' }]]), () => {});
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await seeRow(LONG);
    await holdOk();
    expect(starOn(LONG)).toBe(true);
    expect([...sync.loadFavoritesForLine(line as never).keys()]).toEqual([500]);
    expect([...sync.loadFavoritesForLine(active as never).keys()]).toEqual([9]);
    expect(savedIds()).toEqual([9]); // the box's own list is still the active line's
  });
});
