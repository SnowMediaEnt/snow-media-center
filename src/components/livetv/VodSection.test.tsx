/**
 * Live TV › VOD: Movies or Series first, then that browser. OK opens one;
 * Back walks out one screen at a time (player → series page → posters →
 * categories → the chooser → Live TV's menu). A series plays season by
 * season, episode by episode, on the same player as the films, and the next
 * episode follows on its own (into the next season too). Every list keeps
 * the highlight on screen (keepInView on the focused row).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  vod: null as null | { src: string; onEnded?: () => void; onClose?: () => void; onNext?: () => void; hasNext?: boolean },
  keepInView: [] as Array<{ container: HTMLElement; el: HTMLElement }>,
}));

vi.mock('@/lib/analytics', () => ({ trackEvent: () => {}, startTimer: () => {}, stopTimer: () => {} }));
vi.mock('@/utils/keepInView', () => ({
  keepInView: (container: HTMLElement, el: HTMLElement) => { h.keepInView.push({ container, el }); },
}));
// The player itself (native on a box, HTML5 in a browser) has its own tests.
vi.mock('./VodPlayer', () => ({
  default: (p: NonNullable<typeof h.vod>) => { h.vod = p; return <div data-vod-player="" />; },
}));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  const ep = (id: string, n: number, title: string) => ({ id, episode_num: n, title, container_extension: 'mkv' });
  return {
    ...real,
    getVodCategories: async () => [{ category_id: '5', category_name: 'Action', parent_id: 0 }],
    getVodStreams: async () => [{ stream_id: 77, name: 'Big Film', container_extension: 'mp4', stream_type: 'movie' }],
    getVodInfo: async () => ({ info: { plot: 'A film.' } }),
    getSeriesCategories: async () => [
      { category_id: '9', category_name: 'Drama', parent_id: 0 },
      ...Array.from({ length: 30 }, (_, i) => ({ category_id: String(100 + i), category_name: `Shows ${i}`, parent_id: 0 })),
    ],
    getSeries: async () => [{ series_id: 31, name: 'Long Show', cover: '' }],
    // As many panels send it: no `seasons`, only the episodes by season.
    getSeriesInfo: async () => ({
      info: { name: 'Long Show', plot: 'A show.' },
      episodes: {
        '1': [ep('1001', 1, 'Pilot'), ep('1002', 2, 'Second'), ep('1003', 3, 'Third')],
        '2': [ep('2001', 1, 'Back Again')],
      },
    }),
  };
});

import VodSection, { VOD_LAST_KIND_KEY } from './VodSection';
// Loaded up front, so the chooser's lazy imports resolve within a test's few ticks.
import './MoviesSection';
import './SeriesSection';
import { setKidsLevel } from '@/lib/kidsFilter';
import { recordCounts } from '@/lib/catalogCounts';

// jsdom has no ResizeObserver (the grids measure their rows with one).
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' };
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const key = async (k: string) => { await act(async () => { fireEvent.keyDown(window, { key: k }); }); await settle(); };
const focused = () => Array.from(document.querySelectorAll<HTMLElement>('[data-focused="true"]'));
const card = (kind: string) => document.querySelector<HTMLElement>(`[data-vod-kind="${kind}"]`);
/** keepInView was last asked to keep this element on screen, inside a list. */
const keptInView = (el: Element | null) => {
  const last = [...h.keepInView].reverse().find((c) => c.el === el);
  return !!last && last.container.contains(el!);
};

async function mount(props: Partial<{ onExitLeft: () => void; onExitUp: () => void }> = {}) {
  const onExitLeft = props.onExitLeft ?? vi.fn();
  const onExitUp = props.onExitUp ?? vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = render(<VodSection creds={creds as any} isActive onExitLeft={onExitLeft} onExitUp={onExitUp} />);
  await settle();
  return { ...r, onExitLeft, onExitUp };
}

beforeEach(() => {
  h.vod = null; h.keepInView = [];
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => { setKidsLevel(null); });

describe('VOD chooser', () => {
  it('offers Movies and Series, Movies first; ◀ ▶ move, Up reaches the header', async () => {
    const { onExitLeft, onExitUp } = await mount();
    expect(card('movies')?.getAttribute('data-focused')).toBe('true');
    expect(card('series')?.getAttribute('data-focused')).toBe('false');
    expect(screen.getByText('Movies')).toBeTruthy();
    expect(screen.getByText('Series')).toBeTruthy();

    await key('ArrowRight');
    expect(card('series')?.getAttribute('data-focused')).toBe('true');
    expect(keptInView(card('series'))).toBe(true);
    await key('ArrowLeft');
    expect(card('movies')?.getAttribute('data-focused')).toBe('true');
    expect(onExitLeft).not.toHaveBeenCalled();
    // Left from the first card: the side menu.
    await key('ArrowLeft');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
    await key('ArrowUp');
    expect(onExitUp).toHaveBeenCalledTimes(1);
  });

  it('Back goes to the side menu', async () => {
    const { onExitLeft } = await mount();
    await key('Escape');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
  });

  it('shows how many titles each has when this box already knows, never on a Kids profile', async () => {
    recordCounts(creds, 'vod', { total: 1234 });
    recordCounts(creds, 'series', { total: 56 });
    const { unmount } = await mount();
    expect(card('movies')?.textContent).toContain((1234).toLocaleString());
    expect(card('series')?.textContent).toContain('56');
    unmount();
    setKidsLevel('kids');
    await mount();
    // Both are still offered (each list is filtered for the profile), with no totals.
    expect(card('movies')?.textContent).not.toContain((1234).toLocaleString());
    expect(card('series')).toBeTruthy();
  });
});

describe('VOD › Movies', () => {
  it('OK opens the films; Back from the categories comes back to the chooser, then the menu', async () => {
    const { onExitLeft } = await mount();
    await key('Enter');
    expect(card('movies')).toBeNull();
    expect(screen.getByText('Search movies')).toBeTruthy();
    expect(screen.getByText('Action')).toBeTruthy();

    await key('Enter'); // the category's posters (jsdom draws none: no layout)
    await key('Enter'); // the film's page
    expect(document.querySelector('[data-movie-detail]')).toBeTruthy();
    expect(screen.getByText('A film.')).toBeTruthy();

    await key('Escape'); // → posters
    expect(document.querySelector('[data-movie-detail]')).toBeNull();
    await key('Escape'); // → categories
    await key('Escape'); // → the chooser
    expect(card('movies')?.getAttribute('data-focused')).toBe('true');
    expect(onExitLeft).not.toHaveBeenCalled();
    await key('Escape'); // → Live TV's menu
    expect(onExitLeft).toHaveBeenCalledTimes(1);
  });

  it('Left from the categories still goes to the side menu, not back to the chooser', async () => {
    const { onExitLeft } = await mount();
    await key('Enter');
    await key('ArrowLeft');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Search movies')).toBeTruthy();
  });
});

describe('VOD › Series', () => {
  async function openSeries() {
    const r = await mount();
    await key('ArrowRight');
    await key('Enter'); // Series
    await key('Enter'); // the first category's posters
    await key('Enter'); // the series' page (get_series_info)
    return r;
  }

  it('OK on Series opens the series categories, and the choice is remembered', async () => {
    const { unmount } = await mount();
    await key('ArrowRight');
    await key('Enter');
    expect(screen.getByText('Search series')).toBeTruthy();
    expect(screen.getByText('Drama')).toBeTruthy();
    expect(sessionStorage.getItem(VOD_LAST_KIND_KEY)).toBe('series');
    unmount();
    // VOD opened again this session: the chooser, on Series.
    await mount();
    expect(card('series')?.getAttribute('data-focused')).toBe('true');
  });

  it('a series page lists its seasons and episodes; OK plays the episode on the VOD player', async () => {
    await openSeries();
    expect(document.querySelector('[data-series-detail]')).toBeTruthy();
    // Seasons from the episodes, even with no `seasons` in the answer.
    expect(screen.getByText('Season 1')).toBeTruthy();
    expect(screen.getByText('Season 2')).toBeTruthy();
    expect(screen.getByText('Pilot')).toBeTruthy();
    // The highlight starts on the first episode.
    expect(focused().some((el) => el.getAttribute('data-episode-i') === '0')).toBe(true);

    await key('ArrowDown');
    const second = document.querySelector('[data-episode-i="1"]');
    expect(second?.getAttribute('data-focused')).toBe('true');
    expect(keptInView(second)).toBe(true);

    await key('Enter');
    expect(h.vod?.src).toMatch(/\/series\/user1\/pass1\/1002\.mkv$/);
    expect(document.querySelector('[data-vod-player]')).toBeTruthy();

    // The player owns the remote while it is up; its Back closes it, onto
    // the episode just played.
    await act(async () => { h.vod?.onClose?.(); });
    await settle();
    expect(document.querySelector('[data-vod-player]')).toBeNull();
    expect(document.querySelector('[data-episode-i="1"]')?.getAttribute('data-focused')).toBe('true');
  });

  it('Left reaches the seasons; Down picks season 2 and its episodes', async () => {
    await openSeries();
    await key('ArrowLeft');
    expect(document.querySelector('[data-season-i="0"]')?.getAttribute('data-focused')).toBe('true');
    await key('ArrowDown');
    const s2 = document.querySelector('[data-season-i="1"]');
    expect(s2?.getAttribute('data-focused')).toBe('true');
    expect(keptInView(s2)).toBe(true);
    expect(screen.getByText('Back Again')).toBeTruthy();
    expect(screen.queryByText('Pilot')).toBeNull();
    await key('Enter'); // into its episodes
    await key('Enter'); // play
    expect(h.vod?.src).toMatch(/\/2001\.mkv$/);
  });

  it('the next episode plays on its own, into the next season after a season ends', async () => {
    await openSeries();
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter'); // S1E3, the season's last
    expect(h.vod?.src).toMatch(/\/1003\.mkv$/);
    // The bar's Next knows there is one (season 2).
    expect(h.vod?.hasNext).toBe(true);
    await act(async () => { h.vod?.onEnded?.(); });
    await settle();
    expect(h.vod?.src).toMatch(/\/2001\.mkv$/);
    // The last episode of the last season: no Next, and the player closes at the end.
    expect(h.vod?.hasNext).toBe(false);
    await act(async () => { h.vod?.onEnded?.(); });
    await settle();
    expect(document.querySelector('[data-vod-player]')).toBeNull();
    expect(screen.getByText('Back Again')).toBeTruthy();
  });

  it('with autoplay switched off (from the remote), the player closes after the episode', async () => {
    await openSeries();
    await key('ArrowLeft'); // seasons
    await key('ArrowLeft'); // Play S1·E1
    expect(document.querySelector('[data-detail-btn="play"]')?.getAttribute('data-focused')).toBe('true');
    await key('ArrowDown'); // the autoplay switch
    const sw = document.querySelector('[data-detail-btn="autoplay"]');
    expect(sw?.getAttribute('data-focused')).toBe('true');
    expect(sw?.getAttribute('aria-checked')).toBe('true');
    await key('Enter');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    await key('ArrowUp');
    await key('Enter'); // Play S1·E1
    expect(h.vod?.src).toMatch(/\/1001\.mkv$/);
    await act(async () => { h.vod?.onEnded?.(); });
    await settle();
    expect(document.querySelector('[data-vod-player]')).toBeNull();
  });

  it("the player bar's Next plays the next episode, across seasons", async () => {
    await openSeries();
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter'); // S1E3
    await act(async () => { h.vod?.onNext?.(); });
    await settle();
    expect(h.vod?.src).toMatch(/\/2001\.mkv$/);
  });

  it('Back walks out one screen at a time: page, posters, categories, chooser, menu', async () => {
    const { onExitLeft } = await openSeries();
    await key('Escape');
    expect(document.querySelector('[data-series-detail]')).toBeNull();
    expect(document.querySelector('[data-series-grid]')).toBeTruthy(); // the posters
    await key('Escape'); // categories
    expect(card('series')).toBeNull();
    await key('Escape'); // the chooser
    expect(card('series')?.getAttribute('data-focused')).toBe('true');
    expect(onExitLeft).not.toHaveBeenCalled();
    await key('Escape');
    expect(onExitLeft).toHaveBeenCalledTimes(1);
  });

  it('a long category list follows the highlight', async () => {
    await mount();
    await key('ArrowRight');
    await key('Enter');
    for (let i = 0; i < 20; i++) await key('ArrowDown');
    const row = focused().find((el) => el.hasAttribute('data-cat-i'));
    expect(row?.textContent).toContain('Shows');
    expect(keptInView(row ?? null)).toBe(true);
  });
});
