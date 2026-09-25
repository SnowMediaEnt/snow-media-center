/**
 * The Guide's Favorites chip: first in the category bar, as in Live TV's
 * list, listing the line's saved favourites with their programmes. The
 * Guide opens where the list opens (the first real category), plays a
 * favourite on OK, keeps a Kids profile to its own channels, and picks up a
 * changed list when it gets the remote back.
 */
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavChannel, XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://h', username: 'u', password: 'p' };

/** What the provider answers, and what it was asked. */
const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  streamCalls: [] as string[],
  epgCalls: [] as number[],
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
    // One programme on now, named for the stream it was asked for.
    getShortEpg: async (_c: unknown, streamId: number) => {
      api.epgCalls.push(streamId);
      return { epg_listings: [{ title: btoa(`Show ${streamId}`), start: '', end: '', start_timestamp: String(now() - 600), stop_timestamp: String(now() + 3000) }] };
    },
  };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
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

const fav = (stream_id: number, name: string, category_id?: string, num?: number): FavChannel => ({ stream_id, name, category_id, num });
/** Favourites as Live TV saves them for the line (no sync yet: the local store). */
const saveFavs = (list: FavChannel[]) => {
  localStorage.setItem('snow-livetv-favs-v2', JSON.stringify(list));
  localStorage.setItem('snow-livetv-favs-v1', JSON.stringify(list.map((f) => f.stream_id)));
};

const key = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); });
const chips = () => [...document.querySelectorAll('[data-cat-i]')].map((el) => el.textContent);
/** The channel names down the grid (not the programmes, not the preview). */
const rowNames = () => [...document.querySelectorAll('.min-w-0 > .font-quicksand.font-semibold')].map((el) => el.textContent);
const seeRow = (name: string) => waitFor(() => expect(rowNames()).toContain(name));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

/** A fresh Guide module: the demo latch and the Kids level are read per module. */
async function freshGuide() {
  vi.resetModules();
  const { default: Guide } = await import('./GuideSection');
  const kids = await import('@/lib/kidsFilter');
  return { Guide, kids };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.categories = [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }];
  api.streams = { 1: [{ stream_id: 301, name: 'News Channel', category_id: '1' }] };
  api.streamCalls = [];
  api.epgCalls = [];
});
afterEach(() => { sessionStorage.clear(); });

describe('Guide: Favorites', () => {
  it('is the first chip; the Guide still opens on the first category, as the list does', async () => {
    saveFavs([fav(202, 'Zed Sports', '2', 9), fav(101, 'Alpha News', '1', 3)]);
    const { Guide } = await freshGuide();
    const onExitLeft = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={onExitLeft} />);
    await seeRow('News Channel');
    expect(chips()).toEqual(['Favorites', 'News', 'Sports']);
    expect(api.streamCalls).toEqual(['1']);

    // ▲ to the bar, ◀ onto Favorites: the saved list, in its saved order.
    await key('ArrowUp');
    await key('ArrowLeft');
    await seeRow('Zed Sports');
    expect(rowNames()).toEqual(['Zed Sports', 'Alpha News']);
    expect(screen.getByText('#9')).toBeTruthy();
    // Programmes fetched by each favourite's stream id; no list downloaded.
    expect(await screen.findByText('Show 101')).toBeTruthy();
    expect(screen.getAllByText('Show 202').length).toBeGreaterThan(0);
    expect(api.epgCalls).toEqual(expect.arrayContaining([202, 101]));
    await settle();
    expect(api.streamCalls).toEqual(['1']);

    // ◀ at the first chip still leaves the Guide.
    expect(onExitLeft).not.toHaveBeenCalled();
    await key('ArrowLeft');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
  });

  it('OK plays the favourite; ▲▼ full screen moves through the favourites', async () => {
    saveFavs([fav(202, 'Zed Sports', '2'), fav(101, 'Alpha News', '1')]);
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow('News Channel');
    await key('ArrowUp');
    await key('ArrowLeft');
    await seeRow('Zed Sports');
    await key('ArrowDown'); // into the grid
    await key('Enter');
    expect((await screen.findByTestId('video')).getAttribute('data-src')).toBe('http://h/live/u/p/202.m3u8');
    await key('ArrowDown');
    expect(screen.getByTestId('video').getAttribute('data-src')).toBe('http://h/live/u/p/101.m3u8');
    expect(screen.getAllByText('Alpha News').length).toBeGreaterThan(0);
  });

  it('with no favourites the chip is still first, with how to add one (as the list shows it)', async () => {
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow('News Channel');
    expect(chips()[0]).toBe('Favorites');
    await key('ArrowUp');
    await key('ArrowLeft');
    expect(await screen.findByText(/No favorites yet/)).toBeTruthy();
    await key('ArrowDown');
    await key('Enter');
    expect(screen.queryByTestId('video')).toBeNull();
  });

  it('a Kids profile sees only favourites in the categories it may open', async () => {
    // The data layer already gives a Kids profile only its categories.
    api.categories = [{ category_id: '5', category_name: 'Kids' }];
    api.streams = { 5: [{ stream_id: 501, name: 'Toon Time', category_id: '5' }] };
    saveFavs([fav(1, 'Cartoon Fun', '5'), fav(2, 'Late Movies', '9'), fav(3, 'XXX After Dark', '5'), fav(4, 'Old Favourite')]);
    const { Guide, kids } = await freshGuide();
    kids.setKidsLevel('kids');
    try {
      render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
      await seeRow('Toon Time');
      await key('ArrowUp');
      await key('ArrowLeft');
      await seeRow('Cartoon Fun');
      expect(rowNames()).toEqual(['Cartoon Fun']);
      await settle();
      expect(api.epgCalls).not.toContain(2);
      expect(api.epgCalls).not.toContain(3);
      expect(api.epgCalls).not.toContain(4);
      // Full screen cannot zap to a hidden one either.
      await key('ArrowDown');
      await key('Enter');
      expect((await screen.findByTestId('video')).getAttribute('data-src')).toBe('http://h/live/u/p/1.m3u8');
      await key('ArrowDown');
      expect(screen.getByTestId('video').getAttribute('data-src')).toBe('http://h/live/u/p/1.m3u8');
    } finally {
      kids.setKidsLevel(null);
    }
  });

  it('picks up a changed list when it gets the remote back, and on Update Channels', async () => {
    // No categories: the Guide opens on Favorites, as the list stays there.
    api.categories = [];
    saveFavs([fav(101, 'Alpha News', '1')]);
    const { Guide } = await freshGuide();
    const { rerender } = render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow('Alpha News');
    expect(screen.getByText('No categories.')).toBeTruthy();

    // Toggled in Live TV's list while the Guide was not on screen.
    saveFavs([fav(101, 'Alpha News', '1'), fav(202, 'Zed Sports', '2')]);
    rerender(<Guide creds={line as never} isActive={false} onExitLeft={() => {}} />);
    rerender(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow('Zed Sports');
    expect(rowNames()).toEqual(['Alpha News', 'Zed Sports']);

    // A cloud merge landed; "Update Channels" re-reads it.
    saveFavs([fav(202, 'Zed Sports', '2')]);
    const { XTREAM_REFRESH_EVENT } = await import('@/lib/xtream');
    await act(async () => { window.dispatchEvent(new CustomEvent(XTREAM_REFRESH_EVENT)); });
    await settle();
    expect(rowNames()).toEqual(['Zed Sports']);
  });

  it('the demo Guide lists the demo favourites and plays nothing', async () => {
    sessionStorage.setItem('smc-demo', '1');
    const { Guide } = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={() => {}} />);
    await seeRow('Metro News 24');
    expect(chips()[0]).toBe('Favorites');
    await key('ArrowUp');
    await key('ArrowLeft');
    await seeRow('Summit Sports');
    // The seeded demo favourites only, not the News lineup.
    expect(rowNames()).toHaveLength(3);
    expect(rowNames()).toEqual(expect.arrayContaining(['World News Network', 'Summit Sports']));
    expect(rowNames()).not.toContain('Metro News 24');
    await key('ArrowDown');
    await key('Enter');
    expect(await screen.findByText(/Demo mode/)).toBeTruthy();
    expect(screen.queryByTestId('video')).toBeNull();
  });
});
