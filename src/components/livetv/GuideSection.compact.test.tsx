/**
 * The Guide drawn Compact (lib/viewSize, the default; ported from Tronix
 * build 43): no category chips, the rows gapless and slim (36 px on a TV, 44
 * on a touch screen), the current category at the left of the time bar, and
 * the categories in a drawer over the left edge: ◀ at the first time opens
 * it, ▲ ▼ move through it (the grid follows after the 1 s rest), OK / ▶ open
 * one at once, Back closes it, ◀ goes on to the side menu, ▲ from Favorites
 * reaches Settings and Update Channels at its top. Large is the older Guide.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';
import { CATEGORY_DWELL_MS } from '@/lib/categoryDwell';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  asked: [] as string[],
}));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  const now = () => Math.floor(Date.now() / 1000);
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    hasLiveStreams: () => false,
    getLiveStreams: async (_c: unknown, categoryId?: string) => {
      api.asked.push(String(categoryId));
      return api.streams[String(categoryId)] ?? [];
    },
    getShortEpg: async (_c: unknown, streamId: number) => ({
      epg_listings: [{ title: btoa(`Show ${streamId}`), start: '', end: '', start_timestamp: String(now() - 600), stop_timestamp: String(now() + 3000) }],
    }),
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => false }));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => null }));
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const size = estimateSize(0);
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * size, size })),
        [count, size, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * size, measure: () => {} };
    },
  };
});

import Guide from './GuideSection';

const key = (k: string, extra: Record<string, unknown> = {}) => act(() => {
  fireEvent.keyDown(document.body, { key: k, ...extra });
  fireEvent.keyUp(document.body, { key: k });
});
const rowNames = () => [...document.querySelectorAll('[data-guide-name]')].map((el) => el.textContent);
const seeRow = (name: string) => waitFor(() => expect(rowNames()).toContain(name));
const drawer = () => document.querySelector('[data-guide-drawer]');
const drawerFocus = () => document.querySelector('[data-guide-drawer] [data-focused="true"]')?.textContent ?? '';
const catLabel = () => document.querySelector('[data-guide-cat-label]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.asked = [];
  api.categories = [
    { category_id: '1', category_name: 'News' },
    { category_id: '2', category_name: 'Sports' },
    { category_id: '3', category_name: 'Movies' },
  ];
  api.streams = {
    1: [{ stream_id: 101, name: 'News One', category_id: '1', num: 1 }, { stream_id: 102, name: 'News Two', category_id: '1', num: 2 }],
    2: [{ stream_id: 201, name: 'Sports One', category_id: '2', num: 3 }],
    3: [{ stream_id: 301, name: 'Movie One', category_id: '3', num: 4 }],
  };
});
afterEach(() => { vi.useRealTimers(); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('Guide, Compact (the default)', () => {
  it('no chips, no gaps: 36 px rows on a TV, the category at the left of the time bar', async () => {
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('News One');
    expect(document.querySelector('[data-guide-size="compact"]')).toBeTruthy();
    expect(document.querySelector('[data-cat-i]')).toBeNull();
    const row = document.querySelector<HTMLElement>('[data-guide-row]')!;
    expect(row.style.height).toBe('36px');
    expect(catLabel()).toBe('News');
    expect(document.querySelector('[data-guide-hint]')?.textContent).toContain('◀ categories and settings');
  });

  it('a touch screen: 44 px rows, a categories button, Back and earlier / later in the bottom bar', async () => {
    __setPhoneModeForTests({ touch: true, phone: true, portrait: false });
    const onBackButton = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onBackButton={onBackButton} />);
    await seeRow('News One');
    expect(document.querySelector<HTMLElement>('[data-guide-row]')!.style.height).toBe('44px');
    expect(document.querySelector('[data-guide-hint]')).toBeNull();
    act(() => { fireEvent.click(document.querySelector('[data-guide-back]')!); });
    expect(onBackButton).toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('[data-guide-earlier]')!.disabled).toBe(true);
    act(() => { fireEvent.click(document.querySelector('[data-guide-later]')!); });
    expect(document.querySelector<HTMLButtonElement>('[data-guide-earlier]')!.disabled).toBe(false);
    // The categories button opens the drawer; a tap on one opens it.
    act(() => { fireEvent.click(document.querySelector('[data-guide-cat-button]')!); });
    expect(drawer()).toBeTruthy();
    act(() => { fireEvent.click(document.querySelector('[data-drawer-i="3"]')!); });
    expect(drawer()).toBeNull();
    await seeRow('Movie One');
  });

  it('◀ at the first time opens the drawer on the open category; ▲ ▼ wait the 1 s rest; OK opens at once', async () => {
    const onExitLeft = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={onExitLeft} />);
    await seeRow('News One');
    await key('ArrowLeft');
    expect(onExitLeft).not.toHaveBeenCalled();
    expect(drawer()).toBeTruthy();
    expect(drawerFocus()).toBe('News');
    vi.useFakeTimers();
    await key('ArrowDown');
    expect(drawerFocus()).toBe('Sports');
    await act(async () => { vi.advanceTimersByTime(CATEGORY_DWELL_MS / 2); });
    expect(api.asked).not.toContain('2');
    await key('ArrowDown'); // Movies: passing Sports downloaded nothing
    await key('Enter');
    vi.useRealTimers();
    expect(drawer()).toBeNull();
    await seeRow('Movie One');
    expect(api.asked).not.toContain('2');
    expect(catLabel()).toBe('Movies');
  });

  it('Back closes the drawer, one step; ◀ in it goes on to the side menu', async () => {
    const onExitLeft = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={onExitLeft} />);
    await seeRow('News One');
    await key('ArrowLeft');
    await key('Escape');
    expect(drawer()).toBeNull();
    expect(onExitLeft).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 400)); // a second Back this soon is the same press
    await key('ArrowLeft');
    expect(drawer()).toBeTruthy();
    await key('ArrowLeft');
    expect(drawer()).toBeNull();
    expect(onExitLeft).toHaveBeenCalledTimes(1);
  });

  it('▲ from Favorites reaches Settings and Update Channels at the top; OK on them works', async () => {
    const onOpenSettings = vi.fn();
    const onUpdateChannels = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onOpenSettings={onOpenSettings} onUpdateChannels={onUpdateChannels} serviceName="Snow" />);
    await seeRow('News One');
    await key('ArrowLeft');
    expect(document.querySelector('[data-guide-service]')?.textContent).toBe('Snow');
    await key('ArrowUp'); // Favorites
    expect(drawerFocus()).toBe('Favorites');
    await key('ArrowUp'); // Settings
    expect(document.querySelector('[data-guide-drawer-settings]')?.getAttribute('data-focused')).toBe('true');
    await key('Enter');
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    await key('ArrowRight');
    expect(document.querySelector('[data-guide-drawer-update]')?.getAttribute('data-focused')).toBe('true');
    await key('Enter');
    expect(onUpdateChannels).toHaveBeenCalledTimes(1);
    expect(drawer()).toBeTruthy();
    await key('ArrowDown');
    expect(drawerFocus()).toBe('Favorites');
  });

  it('later in the day ◀ moves time back first; ▲ on the first row stays (no chips above)', async () => {
    const onExitUp = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onExitUp={onExitUp} />);
    await seeRow('News One');
    await key('ArrowRight');
    expect(document.querySelector('[data-guide-hint]')?.textContent).toContain('◀ ▶ shift time');
    await key('ArrowLeft');
    expect(drawer()).toBeNull();
    await key('ArrowUp');
    expect(onExitUp).not.toHaveBeenCalled();
    expect(document.querySelector('[data-guide-row] [data-focused="true"]')?.textContent).toContain('News One');
  });

  it('a long name: a step smaller on two lines in the row, never cut to one', async () => {
    api.streams[1] = [{ stream_id: 101, name: 'LIVE EVENT 01 - 8pm Fight Night Main Card', category_id: '1' }];
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('LIVE EVENT 01 - 8pm Fight Night Main Card');
    const name = document.querySelector('[data-guide-name]')!;
    expect(name.className).toContain('line-clamp-2');
    expect(name.className).toContain('text-[11px]');
    expect(name.className).not.toContain('truncate');
  });

  it('Large: the chips and the 72 px rows, as before', async () => {
    localStorage.setItem('snow-view-size', 'large');
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('News One');
    expect(document.querySelector('[data-guide-size="compact"]')).toBeNull();
    expect(document.querySelector('[data-cat-i="1"]')).toBeTruthy();
  });
});
