// TV Shows marks what the viewer has watched (owner, 2026-10-10: "Can we
// double check that all movies and episodes watched gets a check mark and
// then entire seasons as well please"): a gold check on the show's poster
// with the episode watched last; on its page a check by each episode watched
// to the end, a bar under one begun, and a check by a season watched to the
// end. Playing an episode marks it. Ported from Tronix 416bb91c.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const h = vi.hoisted(() => ({
  cats: [{ category_id: '1', category_name: 'Drama' }],
  series: [
    { series_id: 100, name: 'Harbor Lights', category_id: '1', releaseDate: '2023', rating: '8' },
    { series_id: 101, name: 'Night Shift', category_id: '1', releaseDate: '2022', rating: '7' },
  ],
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getSeriesCategories: async () => h.cats,
  getSeries: async (_c: unknown, cat?: string) => (cat ? h.series.filter((s) => s.category_id === cat) : h.series),
  getSeriesInfo: async () => ({
    seasons: [{ season_number: 1, name: 'Season 1' }, { season_number: 2, name: 'Season 2' }],
    episodes: {
      1: [
        { id: '10', episode_num: 1, title: 'Pilot', container_extension: 'mp4' },
        { id: '11', episode_num: 2, title: 'The Letter', container_extension: 'mp4' },
      ],
      2: [{ id: '21', episode_num: 1, title: 'Return', container_extension: 'mp4' }],
    },
    info: { name: 'Harbor Lights', plot: 'A show.' },
  }),
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
// The player: reports progress and ends when the test says so.
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

import SeriesSection from './SeriesSection';
import { episodeMark, noteEpisodeFinished, noteEpisodeProgress, readWatchedMarks, showKey } from '@/lib/watchedMarks';
import { __setViewerForTests } from '@/lib/viewer';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await settle(20); return ok(); };
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : undefined }); });
const tile = (name: string) => [...document.querySelectorAll('[data-vod-grid] *')].find((e) => e.getAttribute('data-focused') != null && (e.textContent || '').includes(name)) as HTMLElement | undefined;
const badge = (name: string) => tile(name)?.querySelector('[data-watched]') ?? null;
const row = (i: number) => document.querySelector(`[data-episode-i="${i}"]`);
const seasonRow = (i: number) => document.querySelector(`[data-season-i="${i}"]`);

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); __setViewerForTests('device'); });
afterEach(() => { cleanup(); });

/** TV Shows on a TV, its grid open on Drama. */
const toGrid = async () => {
  render(<SeriesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => [...document.querySelectorAll('[data-cat-i]')].some((e) => (e.textContent ?? '').includes('Drama')));
  // The first real category is highlighted by itself (All Series comes first).
  const onDrama = () => (document.querySelector('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Drama');
  await until(onDrama);
  expect(onDrama()).toBe(true);
  key('ArrowRight'); // the grid
  await until(() => !!tile('Harbor Lights'));
};

describe('TV Shows: watched shows and episodes', () => {
  it("a watched show's poster: a gold check with the episode watched last; an unwatched one: none", async () => {
    noteEpisodeFinished(creds, 100, { id: '10', season: 1, num: '1' });
    noteEpisodeProgress(creds, 100, { id: '11', season: 1, num: '2' }, 600, 2400);
    await toGrid();
    // A round check in the corner, the episode after the year.
    expect(badge('Harbor Lights')?.getAttribute('aria-label')).toBe('Watched up to S1E2');
    expect(tile('Harbor Lights')?.querySelector('[data-watched-code]')?.textContent).toBe('S1E2');
    expect(badge('Night Shift')).toBeNull();
  });

  it('its page: a check by an episode watched to the end, a bar under one begun, a check by a season watched to the end', async () => {
    noteEpisodeFinished(creds, 100, { id: '10', season: 1, num: '1' });
    noteEpisodeProgress(creds, 100, { id: '11', season: 1, num: '2' }, 600, 2400);
    noteEpisodeFinished(creds, 100, { id: '21', season: 2, num: '1' });
    await toGrid();
    key('Enter'); // Harbor Lights' page
    await until(() => !!row(1));
    expect(row(0)?.getAttribute('data-watched')).toBe('done');
    expect(row(0)?.querySelector('[aria-label="Watched"]')).toBeTruthy();
    expect(row(1)?.getAttribute('data-watched')).toBe('begun');
    const bar = row(1)?.querySelector<HTMLElement>('[aria-label="Started"]');
    expect(bar?.style.width).toBe('20%');
    // Season 1 has a begun episode; season 2 was watched to the end.
    expect(seasonRow(0)?.querySelector('[data-season-watched]')).toBeNull();
    expect(seasonRow(1)?.querySelector('[data-season-watched]')?.getAttribute('aria-label')).toBe('Watched');
  });

  it('playing an episode marks it: the show after a minute, the episode at its end, its season once all are watched', async () => {
    localStorage.setItem('snow-livetv-autoplay-next', 'false'); // the episode ends: back to its page
    await toGrid();
    expect(badge('Night Shift')).toBeNull();
    key('ArrowRight'); // Night Shift
    key('Enter'); // its page, on its first episode
    await until(() => !!row(0));
    key('Enter'); // play
    await until(() => !!document.querySelector('[data-testid="vod-player"]'));
    act(() => { player.progress!(30, 2400); });
    const show = () => readWatchedMarks()[showKey(creds, 101)];
    expect(show()).toBeUndefined(); // half a minute: not yet
    act(() => { player.progress!(90, 2400); });
    expect(episodeMark(show(), '10')).toBe(1);
    act(() => { player.end!(); });
    expect(episodeMark(show(), '10')).toBe(2);
    await until(() => !document.querySelector('[data-testid="vod-player"]'));
    await until(() => !!row(0));
    expect(row(0)?.getAttribute('data-watched')).toBe('done');
    expect(seasonRow(0)?.querySelector('[data-season-watched]')).toBeNull(); // The Letter is left
    // The Letter, played to 96%.
    key('ArrowDown');
    key('Enter');
    await until(() => !!document.querySelector('[data-testid="vod-player"]'));
    act(() => { player.progress!(2310, 2400); });
    act(() => { player.close!(); });
    await until(() => !!row(1));
    expect(row(1)?.getAttribute('data-watched')).toBe('done');
    expect(seasonRow(0)?.querySelector('[data-season-watched]')).toBeTruthy();
    key('Escape'); // the grid
    await until(() => !!badge('Night Shift'));
    expect(badge('Night Shift')?.getAttribute('aria-label')).toBe('Watched up to S1E2');
  });
});
