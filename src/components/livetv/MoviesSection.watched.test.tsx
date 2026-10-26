// Movies marks a film watched to the end (owner, 2026-10-10: "Can we double
// check that all movies and episodes watched gets a check mark"): a gold
// check on its poster and on its page, for this line only. Playing it to 95%
// or to its end marks it; a film only begun is not marked.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getVodCategories: async () => [{ category_id: '5', category_name: 'Action', parent_id: 0 }],
  getVodStreams: async () => [
    { stream_id: 77, name: 'Big Film', container_extension: 'mp4', stream_type: 'movie', rating: '7.5' },
    { stream_id: 78, name: 'Other Film', container_extension: 'mp4', stream_type: 'movie' },
  ],
  getVodInfo: async () => ({ info: { plot: 'A film.' }, movie_data: { stream_id: 77, container_extension: 'mkv' } }),
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
const player = vi.hoisted(() => ({
  progress: null as null | ((pos: number, dur: number) => void),
  end: null as null | (() => void),
  close: null as null | (() => void),
}));
vi.mock('./VodPlayer', () => ({
  default: ({ onProgress, onEnded, onClose }: { onProgress: (p: number, d: number) => void; onEnded: () => void; onClose: () => void }) => {
    player.progress = onProgress; player.end = onEnded; player.close = onClose;
    return <div data-testid="vod-player" />;
  },
}));

import MoviesSection from './MoviesSection';
import { __resetWatchedMarksForTests, filmKey, noteFilmFinished, noteFilmProgress, readWatchedFilms } from '@/lib/watchedMarks';
import { __setViewerForTests } from '@/lib/viewer';

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' } as never;
const otherLine = { host: 'http://vibez.example', username: 'user1' };
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await settle(20); return ok(); };
// OK is pressed and let go, as a remote does (a press runs on its release).
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter' || k === ' ') fireEvent.keyUp(window, { key: k }); });
const tile = (name: string) => [...document.querySelectorAll('[data-vod-grid] *')].find((e) => e.getAttribute('data-focused') != null && (e.textContent || '').includes(name)) as HTMLElement | undefined;
const badge = (name: string) => tile(name)?.querySelector('[data-watched]') ?? null;
const pageBadge = () => document.querySelector('[data-movie-detail] [data-watched]');

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); __resetWatchedMarksForTests(); __setViewerForTests('device'); });
afterEach(() => { cleanup(); });

const toGrid = async () => {
  render(<MoviesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => (document.querySelector('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Action'));
  key('ArrowRight'); // the grid
  await until(() => !!tile('Big Film'));
};

describe('Movies: watched films', () => {
  it("a watched film: a gold check on its poster, clear of the rating, and on its page; others: none", async () => {
    noteFilmFinished(creds, 77);
    noteFilmProgress(creds, 78, 600, 6000); // begun only
    noteFilmFinished(otherLine, 78); // watched on the customer's other line
    await toGrid();
    const b = badge('Big Film');
    expect(b?.getAttribute('aria-label')).toBe('Watched');
    expect(b?.className).toContain('left-2');
    expect(b?.className).toContain('bg-brand-gold');
    expect(b?.querySelector('svg')?.getAttribute('class')).toContain('text-brand-navy');
    // The rating keeps its corner.
    expect(tile('Big Film')?.textContent).toContain('7.5');
    expect(badge('Other Film')).toBeNull();
    key('Enter'); // Big Film's page
    await until(() => !!document.querySelector('[data-movie-detail]'));
    expect(pageBadge()?.textContent).toBe('Watched');
  });

  it('playing a film marks it at 92%: the poster and the page show it once back', async () => {
    await toGrid();
    expect(badge('Big Film')).toBeNull();
    key('Enter'); // its page
    await until(() => !!document.querySelector('[data-movie-detail]'));
    expect(pageBadge()).toBeNull();
    key('Enter'); // play
    await until(() => !!document.querySelector('[data-testid="vod-player"]'));
    act(() => { player.progress!(90, 6000); }); // begun: not marked
    act(() => { player.progress!(5400, 6000); }); // 90%: not yet
    expect(readWatchedFilms()[filmKey(creds, 77)]).toBeUndefined();
    act(() => { player.progress!(5560, 6000); }); // the credits (93%)
    act(() => { player.close!(); });
    await until(() => !!document.querySelector('[data-movie-detail]'));
    expect(pageBadge()?.textContent).toBe('Watched');
    key('Escape'); // the grid
    await until(() => !!badge('Big Film'));
    expect(badge('Other Film')).toBeNull();
  });

  it('a film played to its end is marked', async () => {
    await toGrid();
    key('Enter');
    await until(() => !!document.querySelector('[data-movie-detail]'));
    key('Enter');
    await until(() => !!document.querySelector('[data-testid="vod-player"]'));
    act(() => { player.end!(); });
    act(() => { player.close!(); });
    await until(() => !!pageBadge());
    expect(pageBadge()).toBeTruthy();
  });
});
