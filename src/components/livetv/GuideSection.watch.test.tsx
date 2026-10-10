/**
 * A channel picked in the Guide plays in Live TV's own player: its bar and
 * options, and a name and volume that go away (the Guide's own full-screen
 * player kept both on screen, with none of Live TV's options). OK hands it
 * over (the deeplink Live TV plays, onWatch with the Guide's place); opened
 * again with that place (resumeAt: Back from the picture) the Guide is on the
 * same category and channel. Without onWatch it plays the channel itself.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCategory, XtreamLiveStream } from '@/lib/xtream';

configure({ asyncUtilTimeout: 4000 });
// Each test loads a fresh Guide module: slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h', username: 'u', password: 'p' };
const api = vi.hoisted(() => ({
  categories: [] as XtreamCategory[],
  streams: {} as Record<string, XtreamLiveStream[]>,
  /** A category's list held back until the test lets it go. */
  gate: null as Promise<void> | null,
}));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  const now = () => Math.floor(Date.now() / 1000);
  return {
    ...real,
    getLiveCategories: async () => api.categories,
    getLiveStreams: async (_c: unknown, categoryId?: string) => {
      if (api.gate) await api.gate;
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

// A press: down and up (OK acts on release; held, it saves a favourite).
const key = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); fireEvent.keyUp(document.body, { key: k }); });
const rowNames = () => [...document.querySelectorAll('[data-guide-name]')].map((el) => el.textContent);
/** The grid row with the highlight (a row's own div, not a category chip). */
const highlighted = () => [...document.querySelectorAll('div[data-focused="true"]')].map((el) => el.textContent ?? '').join(' | ');
const seeRow = (name: string) => waitFor(() => expect(rowNames()).toContain(name));
const deeplink = () => JSON.parse(sessionStorage.getItem('smc-live-deeplink') || 'null');

async function freshGuide() {
  vi.resetModules();
  return (await import('./GuideSection')).default;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // These cover the Large Guide (the chips, 72 px rows); GuideSection.compact covers Compact.
  localStorage.setItem('snow-view-size', 'large');
  api.categories = [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'PPV / EVENTS' }];
  api.streams = {
    1: [{ stream_id: 301, name: 'News Channel', category_id: '1' }],
    2: [
      { stream_id: 401, name: 'LIVE EVENT 01 - 4pm Prelims Fight Night 332', category_id: '2', num: 1 },
      { stream_id: 402, name: 'LIVE EVENT 02 - 8pm Fight Night 332 Stone v Rivers', category_id: '2', num: 2 },
    ],
  };
});
afterEach(() => { sessionStorage.clear(); api.gate = null; });

describe("Guide: a channel plays in Live TV's player", () => {
  it('OK hands it to Live TV (the deeplink, onWatch) and plays nothing here', async () => {
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    await key('ArrowUp'); await key('ArrowRight'); await key('ArrowDown'); // PPV / EVENTS, its grid
    await seeRow('LIVE EVENT 02 - 8pm Fight Night 332 Stone v Rivers');
    await key('ArrowDown'); // the second event
    await key('Enter');
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(onWatch.mock.calls[0][0]).toMatchObject({ line: 'h|u', cat: '2', channel: 402 });
    expect(deeplink()).toMatchObject({ host: 'http://h', username: 'u', streamId: 402, categoryId: '2', num: 2 });
    // Nothing else kept on the box: only Back from that picture hands the place back.
    expect(sessionStorage.length).toBe(1);
    // Its own full-screen player (the name and "Vol 80% · Back to exit" that stayed) is not used.
    expect(document.querySelector('[data-testid="video"]')).toBeNull();
  });

  it('a click on a row hands it over too', async () => {
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await seeRow('News Channel');
    const row = [...document.querySelectorAll('[data-guide-name]')].find((el) => el.textContent === 'News Channel')!;
    act(() => { fireEvent.click(row); });
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(deeplink()).toMatchObject({ streamId: 301, categoryId: '1' });
  });

  it('opened again with its place (Back from the picture): the same category and channel', async () => {
    const Guide = await freshGuide();
    const onResumeTaken = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()}
      resumeAt={{ line: 'h|u', cat: '2', channel: 402, window: 0 }} onResumeTaken={onResumeTaken} />);
    // PPV / EVENTS' channels (not News, the first category), the highlight on the one played.
    await seeRow('LIVE EVENT 02 - 8pm Fight Night 332 Stone v Rivers');
    expect(rowNames()).not.toContain('News Channel');
    await waitFor(() => expect(highlighted()).toContain('LIVE EVENT 02'));
    expect(onResumeTaken).toHaveBeenCalled();
  });

  it('a place on Favorites opens Favorites again', async () => {
    localStorage.setItem('snow-livetv-favs-v2', JSON.stringify([{ stream_id: 9, name: 'Fav One' }, { stream_id: 402, name: 'Fav Event' }]));
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} resumeAt={{ line: 'h|u', cat: 'fav', channel: 402, window: 0 }} />);
    await seeRow('Fav Event');
    await waitFor(() => expect(highlighted()).toContain('Fav Event'));
  });

  it("another line's place is not this one's: the Guide opens at its start", async () => {
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} resumeAt={{ line: 'other|x', cat: '2', channel: 402, window: 0 }} />);
    await seeRow('News Channel');
  });

  it("the viewer's first key ends the wait for the restored channel (it never takes the remote later)", async () => {
    // The restored category's list is slow; the viewer moves on meanwhile.
    let release: () => void = () => {};
    api.gate = new Promise<void>((r) => { release = r; });
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={vi.fn()} resumeAt={{ line: 'h|u', cat: '2', channel: 402, window: 0 }} />);
    await waitFor(() => expect(document.querySelector('[data-cat-i="2"]')).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    await key('ArrowUp'); // to the bar
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 300)); });
    await seeRow('LIVE EVENT 02 - 8pm Fight Night 332 Stone v Rivers');
    expect(highlighted()).not.toContain('LIVE EVENT 02');
  });

  it('without onWatch the Guide plays the channel itself, as before', async () => {
    const Guide = await freshGuide();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} />);
    await seeRow('News Channel');
    await key('Enter');
    // (The player may take a moment to load on a busy machine.)
    await waitFor(() => expect(document.querySelector('[data-testid="video"]')).toBeTruthy());
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
  });

  it('the demo Guide plays nothing and hands nothing over', async () => {
    sessionStorage.setItem('smc-demo', '1');
    const Guide = await freshGuide();
    const onWatch = vi.fn();
    render(<Guide creds={line as never} isActive onExitLeft={vi.fn()} onWatch={onWatch} />);
    await waitFor(() => expect(rowNames().length).toBeGreaterThan(0));
    await key('Enter');
    expect(onWatch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
  });
});
