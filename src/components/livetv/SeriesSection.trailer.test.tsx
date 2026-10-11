/**
 * Trailer on a series' page (owner, 2026-10-11; Tronix 78d8b7d, 13015b8,
 * 1039497): on its own line under Play and "Autoplay next episode" once the
 * page's info is in. The remote: ▼ from the switch reaches it, ▲ goes back,
 * ▶ goes on to the lists as from the buttons above, OK opens it. The panel's
 * video plays inside the app (TrailerOverlay), Back closes it with the
 * highlight still on Trailer; a search opens outside; a tap opens it on a
 * phone; none on a Kids profile (▼ from the switch stays put).
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const ID = 'Ab3_dE-9xYz';
const h = vi.hoisted(() => ({ seriesInfo: {} as Record<number, unknown> }));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getSeriesCategories: async () => [{ category_id: '9', category_name: 'Drama', parent_id: 0 }],
  getSeries: async () => [
    { series_id: 31, name: 'Harbor Patrol', cover: '' },
    { series_id: 32, name: 'Quiet Valley', cover: '' },
  ],
  getSeriesInfo: async (_c: unknown, id: number) => ({
    episodes: { 1: [{ id: '1', episode_num: 1, title: 'Pilot', container_extension: 'mp4' }, { id: '2', episode_num: 2, title: 'Second', container_extension: 'mp4' }] },
    ...((h.seriesInfo[id] as object) ?? { info: {} }),
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
vi.mock('./VodPlayer', () => ({ default: ({ src }: { src: string }) => <div data-testid="vod-player" data-src={src} /> }));

import SeriesSection from './SeriesSection';
import { __resetTrailerForTests } from '@/lib/trailer';
import { setKidsLevel } from '@/lib/kidsFilter';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
// Generous: a busy machine runs these pages slowly.
const until = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await settle(20); return ok(); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });
const tap = (el: Element | null | undefined) => act(() => { fireEvent.click(el!); });
const btn = (name: string) => q(`[data-series-detail] [data-detail-btn="${name}"]`);
const trailer = () => q('[data-series-detail] [data-trailer]');
const lit = (el: HTMLElement | null) => el?.getAttribute('data-focused') === 'true';
const overlay = () => q('[data-trailer-overlay]');
const tile = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-vod-grid] [data-focused]')].find((e) => (e.textContent || '').includes(name));
const open = vi.fn();

/** A TV: the category, then the series at `i`, its page with its episodes in. */
const openShow = async (i: number) => {
  render(<SeriesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => (q('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Drama'));
  press('Enter');
  await until(() => !!tile('Quiet Valley'));
  for (let k = 0; k < i; k++) press('ArrowRight');
  press('Enter');
  await until(() => !!q('[data-episode-i="1"]'));
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); __resetTrailerForTests();
  h.seriesInfo = {
    31: { info: { name: 'Harbor Patrol', plot: 'A show.', youtube_trailer: ID } },
    32: { info: { name: 'Quiet Valley', plot: 'Another show.', releaseDate: '2016-01-10' } },
  };
  open.mockReset();
  vi.stubGlobal('open', open);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setKidsLevel(null); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('Trailer on a series\' page (TV)', { timeout: 30000 }, () => {
  it('Play, the autoplay switch, then Trailer: ▼ ▲ walk them, ▶ the episodes, OK plays the video inside the app', async () => {
    await openShow(0);
    expect(await until(() => !!trailer())).toBe(true);
    expect(trailer()!.getAttribute('data-trailer')).toBe('video');
    expect(trailer()!.getAttribute('aria-label')).toBe('Watch trailer');
    expect(trailer()!.textContent).toBe('Trailer');
    // The left column's order on screen: Play, the switch, Trailer.
    const order = Array.from(document.querySelectorAll('[data-series-info] [data-detail-btn]')).map((e) => e.getAttribute('data-detail-btn'));
    expect(order).toEqual(['play', 'autoplay', 'trailer']);
    // From the episodes: ◀ Play (one season), ▼ the switch, ▼ Trailer.
    press('ArrowLeft');
    expect(lit(btn('play'))).toBe(true);
    press('ArrowDown');
    expect(lit(btn('autoplay'))).toBe(true);
    press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    // ◀ and ▼ there do nothing.
    press('ArrowLeft'); press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    press('Enter');
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(await until(() => !!overlay())).toBe(true);
    expect(q('[data-trailer-frame]')!.getAttribute('src')!.startsWith(`https://www.youtube-nocookie.com/embed/${ID}?`)).toBe(true);
    // The page's keys stand aside while it is up.
    press('ArrowUp'); press('ArrowRight');
    press('Escape');
    await settle(20);
    expect(overlay()).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(q('[data-series-detail]')).not.toBeNull();
    expect(lit(trailer())).toBe(true);
    // ▲ back to the switch, ▼ Trailer again, ▶ the episodes.
    press('ArrowUp');
    expect(lit(btn('autoplay'))).toBe(true);
    press('ArrowDown');
    press('ArrowRight');
    expect(lit(q('[data-episode-i="0"]'))).toBe(true);
    expect(q('[data-testid="vod-player"]')).toBeNull();
  });

  it('without one: a search for the series\' name and year, outside the app', async () => {
    await openShow(1);
    expect(await until(() => !!trailer())).toBe(true);
    expect(trailer()!.getAttribute('data-trailer')).toBe('search');
    expect(trailer()!.getAttribute('aria-label')).toBe('Find the trailer');
    press('ArrowLeft'); press('ArrowDown'); press('ArrowDown'); press('Enter');
    await settle(20);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Quiet%20Valley%202016%20trailer', '_blank', 'noopener,noreferrer');
    expect(overlay()).toBeNull();
  });
});

describe('Trailer by touch (phone)', { timeout: 30000 }, () => {
  beforeEach(() => { __setPhoneModeForTests({ touch: true, phone: true, portrait: true }); });

  it('a tap on Trailer plays it inside the app; its Close button closes it', async () => {
    render(<SeriesSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    await until(() => (q('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Drama'));
    tap(q('[data-cat-i][data-focused="true"]'));
    await until(() => !!tile('Harbor Patrol'));
    tap(tile('Harbor Patrol'));
    expect(await until(() => !!trailer())).toBe(true);
    tap(trailer());
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(await until(() => !!q('[data-trailer-frame]'))).toBe(true);
    tap(q('[data-trailer-close]'));
    await settle(20);
    expect(overlay()).toBeNull();
    expect(q('[data-series-detail]')).not.toBeNull();
  });
});

describe('Kids profile: no Trailer', { timeout: 30000 }, () => {
  it('a series\' page, even with the panel\'s video: Play and the switch, ▼ from the switch stays put', async () => {
    setKidsLevel('kids');
    await openShow(0);
    await settle(20);
    expect(trailer()).toBeNull();
    press('ArrowLeft');
    expect(lit(btn('play'))).toBe(true);
    press('ArrowDown');
    expect(lit(btn('autoplay'))).toBe(true);
    press('ArrowDown');
    expect(lit(btn('autoplay'))).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
