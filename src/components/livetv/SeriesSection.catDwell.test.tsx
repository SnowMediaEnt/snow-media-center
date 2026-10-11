// TV Shows loads a category's shows once the highlight rests on it for a
// second, as Live TV's channels do (owner, 2026-10-11: "populate the list of
// movies or series ... without having to click it first please the same way
// we do with channels"). A fast pass loads nothing; "All Series" waits for OK.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const h = vi.hoisted(() => ({
  streams: vi.fn(async (_c: unknown, cat?: string) => (cat === '5'
    ? [{ series_id: 77, name: 'Big Show', category_id: '5' }]
    : cat === '6'
      ? [{ series_id: 88, name: 'Funny Show', category_id: '6' }]
      : [])),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getSeriesCategories: async () => [
    { category_id: '5', category_name: 'Action' },
    { category_id: '6', category_name: 'Comedy' },
  ],
  getSeries: h.streams,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn() }));
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * estimateSize(), size: estimateSize() })),
    getTotalSize: () => count * estimateSize(),
    measure: () => undefined,
    scrollToOffset: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import SeriesSection from './SeriesSection';

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await settle(20); return ok(); };
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const grid = () => document.querySelector('[data-vod-grid]')?.textContent ?? '';
const focusedCat = () => document.querySelector('[data-cat-i][data-focused="true"]')?.textContent ?? '';
const asked = () => h.streams.mock.calls.map((c) => c[1]);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); h.streams.mockClear(); });
afterEach(() => { cleanup(); });

const open = async () => {
  render(<SeriesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => focusedCat().includes('Action'));
};

describe('TV Shows: a category loads once the highlight rests on it', () => {
  it('resting a second on a category shows its shows beside the list, no OK needed', async () => {
    await open();
    expect(asked()).toEqual([]);
    await settle(1100);
    await until(() => grid().includes('Big Show'));
    expect(grid()).toContain('Big Show');
    expect(asked()).toEqual(['5']);
    // The highlight stayed on the list.
    expect(focusedCat()).toContain('Action');
    // On to the next one: it loads after its own rest.
    key('ArrowDown');
    await settle(1100);
    await until(() => grid().includes('Funny Show'));
    expect(asked()).toEqual(['5', '6']);
  });

  it('a fast pass over categories loads nothing, and "All Series" waits for OK', async () => {
    await open();
    key('ArrowDown'); // Comedy, at once
    await settle(200);
    key('ArrowDown'); // round to All Series
    await settle(1300);
    expect(asked()).toEqual([]);
  });

  it('OK still loads a category at once', async () => {
    await open();
    key('ArrowRight');
    await until(() => grid().includes('Big Show'));
    expect(asked()).toEqual(['5']);
  });
});
