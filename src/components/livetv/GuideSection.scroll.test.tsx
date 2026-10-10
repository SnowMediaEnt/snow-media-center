/**
 * Where the Guide's grid sits:
 *  - Another category opens at its first channel. Scrolled by a finger the
 *    row was 0 already, so with the same number of channels nothing reset the
 *    grid and the new category opened at the old offset (its 17th row).
 *  - Back from a channel puts the grid back where the viewer left it. The
 *    played row came back on the grid's bottom edge: Live TV's player
 *    (onWatch, the place handed back with resumeAt) and the Guide's own
 *    full-screen player (the demo, the web).
 * And programme info is asked for only where the grid rests.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });
// A busy machine: the Guide's first render can take seconds.
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const api = vi.hoisted(() => ({ categories: [] as XtreamCategory[], streams: {} as Record<string, XtreamLiveStream[]>, epgCalls: [] as number[] }));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    getLiveStreams: async (_c: unknown, categoryId?: string) => api.streams[String(categoryId)] ?? [],
    getShortEpg: async (_c: unknown, streamId: number) => { api.epgCalls.push(streamId); return { epg_listings: [] }; },
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => false }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: ({ src }: { src: string | null }) => <div data-testid="video" data-src={src ?? ''} /> }));
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

// jsdom lays nothing out: the grid is 300px tall here.
const GRID_H = 300;
let clientHeight: PropertyDescriptor | undefined;
beforeAll(() => {
  clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.hasAttribute('data-guide-grid') ? GRID_H : 0; },
  });
});
afterAll(() => { if (clientHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight); });

const grid = () => document.querySelector<HTMLElement>('[data-guide-grid]');
const rowNames = () => [...document.querySelectorAll('[data-guide-name]')].map((el) => el.textContent);
const seeRow = (name: string) => waitFor(() => expect(rowNames()).toContain(name));
// A press: down and up (OK acts on release; held, it saves a favourite).
const key = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); fireEvent.keyUp(document.body, { key: k }); });
const settle = (ms = 300) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
/** The viewer's finger (or the remote) moved the grid. */
const scrollGrid = (top: number) => act(() => { const g = grid()!; g.scrollTop = top; fireEvent.scroll(g); });
const channels = (cat: string, name: string, n: number): XtreamLiveStream[] =>
  Array.from({ length: n }, (_, i) => ({ stream_id: Number(cat) * 100 + i, name: `${name} ${i + 1}`, category_id: cat }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Two categories of the same size (every category in the QA's mock had 40).
  api.categories = [{ category_id: '1', category_name: 'General' }, { category_id: '2', category_name: 'Local' }];
  api.streams = { 1: channels('1', 'General', 20), 2: channels('2', 'Local', 20) };
  api.epgCalls = [];
});

describe('Guide: another category opens at its first channel', () => {
  it('scrolled by a finger, two categories of the same size: the grid goes back to its top', async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('General 1');
    await settle(); // the Guide done opening
    await scrollGrid(500);
    expect(grid()!.scrollTop).toBe(500);
    await act(async () => { fireEvent.click(document.querySelector('[data-cat-i="2"]')!); });
    await seeRow('Local 1');
    await settle();
    expect(grid()!.scrollTop).toBe(0);
  });
});

describe('Guide: Back from a channel keeps the grid where it was', () => {
  it("Live TV's player: the place handed over carries the grid's offset, and Back puts it back", async () => {
    const onWatch = vi.fn();
    const { unmount } = render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('General 1');
    await settle();
    for (let i = 0; i < 5; i++) await key('ArrowDown'); // row 5: the grid follows it
    await scrollGrid(200); // the row (360-432) still in view, higher up
    await key('Enter');
    expect(onWatch).toHaveBeenCalledTimes(1);
    const place = onWatch.mock.calls[0][0];
    expect(place).toMatchObject({ cat: '1', channel: 105, scroll: 200 });
    unmount();

    // Back from the picture: the Guide opens again with that place.
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} resumeAt={place} />);
    await seeRow('General 6');
    await settle();
    // Not 132 (the row on the grid's bottom edge): where it was.
    expect(grid()!.scrollTop).toBe(200);
  });

  it("the Guide's own full-screen player (no onWatch): the rebuilt grid is back at the viewer's offset", async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('General 1');
    await settle();
    for (let i = 0; i < 5; i++) await key('ArrowDown');
    await scrollGrid(200);
    await key('Enter');
    await waitFor(() => expect(document.querySelector('[data-testid="video"]')).toBeTruthy());
    expect(grid()).toBeNull();
    await settle(400);
    await key('Escape');
    await waitFor(() => expect(grid()).toBeTruthy());
    await settle();
    expect(grid()!.scrollTop).toBe(200);
  });
});

describe('Guide: programme info only where the grid rests', () => {
  // (The wait itself: hooks/useWhenSettled.test.tsx.)
  it("another category's rows ask once the grid rests on them, once each", async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('General 1');
    await waitFor(() => expect(api.epgCalls.length).toBe(20)); // jsdom: every row is "on screen"
    api.epgCalls = [];
    await act(async () => { fireEvent.click(document.querySelector('[data-cat-i="2"]')!); });
    await seeRow('Local 1');
    await waitFor(() => expect(api.epgCalls.length).toBe(20));
    expect([...api.epgCalls].sort((a, b) => a - b)).toEqual(channels('2', 'Local', 20).map((c) => c.stream_id));
    await settle(600);
    expect(api.epgCalls).toHaveLength(20);
  });
});
