/**
 * A film's page lists its series and more like it (owner, 2026-10-27: open a
 * film, go straight to its sequel instead of backing out to hunt for it):
 *  - the cast and director on one line, names only;
 *  - "More in this series" (from the whole catalogue, downloaded once, other
 *    categories too, in 1, 2, 3 order, no adult title), then "More like this"
 *    (its own category);
 *  - the remote: ▼ from the buttons into the rows, ▲ ▼ between them, ◀ ▶
 *    along a row, OK opens that film's page; Back returns to the film before
 *    (its highlight on the film left), then to the list;
 *  - never a per-film call for the other films; no catalogue: rows from the
 *    lists already held.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const h = vi.hoisted(() => {
  const film = (stream_id: number, name: string, category_id: string, year?: string) =>
    ({ stream_id, name, category_id, year, container_extension: 'mp4', stream_type: 'movie' });
  const horror = [
    film(1, 'EN - Doll Night (1988)', '5', '1988'),
    film(3, 'Fog Bank', '5'),
    film(5, 'Doll Night 3 [4K]', '5', '1991'),
    film(4, 'Sea Glass', '5'),
  ];
  const all = [
    ...horror,
    film(2, '|EN| Doll Night 2', '6', '1990'),
    film(6, 'EN - Doll Night 2 (1990)', '6', '1990'), // a copy
    film(7, 'Doll Night 4', '9'), // an adult category: never shown
    film(8, 'Dry Comedy', '6'),
  ];
  return {
    all,
    horror,
    failAll: false,
    streams: vi.fn(async (_c: unknown, cat?: string) => {
      if (cat === '5') return horror;
      if (cat) return [];
      if (h.failAll) throw new Error('network');
      return all;
    }),
    info: vi.fn(async (_c: unknown, id: number) => ({
      info: { plot: `Plot ${id}.`, cast: 'Ann Lee, Bo Park, Cy Dorn', director: 'Di Rector', genre: 'Horror', youtube_trailer: '' },
    })),
  };
});

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getVodCategories: async () => [
    { category_id: '5', category_name: 'Horror', parent_id: 0 },
    { category_id: '6', category_name: 'Comedy', parent_id: 0 },
    { category_id: '9', category_name: 'Adults 18+', parent_id: 0 },
  ],
  getVodStreams: h.streams,
  getVodInfo: h.info,
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
vi.mock('./VodPlayer', () => ({ default: () => <div data-testid="vod-player" /> }));

import MoviesSection from './MoviesSection';
import { __resetTrailerForTests } from '@/lib/trailer';
import { __resetVodCatalogueForTests } from '@/lib/vodCatalogue';

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await settle(20); return ok(); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
// OK is pressed and let go, as a remote does (a poster's OK runs on its release).
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); if (key === 'Enter' || key === ' ') fireEvent.keyUp(window, { key }); });
const lit = (el: HTMLElement | null) => el?.getAttribute('data-focused') === 'true';
const title = () => q('[data-movie-detail] h2')?.textContent ?? '';
const row = (kind: 'series' | 'like') => [...document.querySelectorAll<HTMLElement>(`[data-related-row="${kind}"] [data-related-id]`)]
  .map((e) => e.textContent?.replace(/\d{4}$/, '').trim());
const card = (id: number) => q(`[data-related-id="${id}"] [data-focused]`);
const litCard = () => q('[data-related] [data-related-id] [data-focused="true"]')?.closest('[data-related-id]')?.getAttribute('data-related-id') ?? null;
const play = () => q('[data-movie-detail] [data-detail-btn="play"]');
const trailer = () => q('[data-movie-detail] [data-trailer]');
const tile = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-vod-grid] [data-focused]')].find((e) => (e.textContent || '').includes(name));
const allCalls = () => h.streams.mock.calls.filter((c) => !c[1]).length;

/** A TV: Horror, then its first film (Doll Night), its page with the rows in. */
const openDollNight = async () => {
  render(<MoviesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => (q('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Horror'));
  press('Enter');
  await until(() => !!tile('Doll Night'));
  press('Enter');
  await until(() => title().includes('Doll Night'));
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  __resetTrailerForTests(); __resetVodCatalogueForTests();
  h.failAll = false;
  h.streams.mockClear(); h.info.mockClear();
});
afterEach(() => { cleanup(); });

describe('A film\'s page: cast, its series and more like it', { timeout: 30000 }, () => {
  it('shows the cast and both rows: the series across categories in order, one copy each, no adult title', async () => {
    await openDollNight();
    expect(await until(() => row('series').length === 2)).toBe(true);
    expect(q('[data-movie-cast]')!.textContent).toBe('DirectorDi RectorCastAnn Lee, Bo Park, Cy Dorn');
    expect(row('series')).toEqual(['|EN| Doll Night 2', 'Doll Night 3 [4K]']);
    expect(row('like')).toEqual(['Fog Bank', 'Sea Glass']);
    expect(q('[data-related-row="series"]')!.textContent).toContain('More in this series');
    expect(q('[data-related-row="like"]')!.textContent).toContain('More like this');
    // The catalogue once, and the panel asked about this film only.
    expect(allCalls()).toBe(1);
    expect(h.info.mock.calls.map((c) => c[1])).toEqual([1]);
  });

  it('▼ from the buttons into the rows, ◀ ▶ ▲ ▼ around them, OK opens the film; Back goes back one film, then to the list', async () => {
    await openDollNight();
    await until(() => row('like').length === 2 && row('series').length === 2);
    expect(lit(play())).toBe(true);
    press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    press('ArrowDown');
    expect(litCard()).toBe('2');
    expect(lit(play())).toBe(false);
    press('ArrowLeft'); // the row's start: stays
    expect(litCard()).toBe('2');
    press('ArrowRight');
    expect(litCard()).toBe('5');
    press('ArrowRight'); // the row's end: stays
    expect(litCard()).toBe('5');
    press('ArrowDown');
    expect(litCard()).toBe('4'); // col 1 of "More like this"
    press('ArrowDown'); // the last row: stays
    expect(litCard()).toBe('4');
    press('ArrowUp');
    expect(litCard()).toBe('5');
    press('Enter');
    expect(await until(() => title().includes('Doll Night 3'))).toBe(true);
    expect(await until(() => row('series').length === 2)).toBe(true);
    expect(row('series')).toEqual(['EN - Doll Night (1988)', '|EN| Doll Night 2']);
    expect(lit(play())).toBe(true);
    // Still one catalogue download, and one get_vod_info per film opened.
    expect(allCalls()).toBe(1);
    expect(h.info.mock.calls.map((c) => c[1])).toEqual([1, 5]);
    // Back: Doll Night again, the highlight on the film just left.
    press('Escape');
    expect(await until(() => title() === 'EN - Doll Night (1988)')).toBe(true);
    expect(await until(() => litCard() === '5')).toBe(true);
    expect(lit(play())).toBe(false);
    // ▲ from the first row: back to the buttons (Trailer, then Play).
    press('ArrowUp');
    expect(lit(trailer())).toBe(true);
    press('ArrowUp');
    expect(lit(play())).toBe(true);
    // Back again: the list, as before.
    press('Escape');
    await settle(20);
    expect(q('[data-movie-detail]')).toBeNull();
    expect(q('[data-vod-grid]')).not.toBeNull();
  });

  it('a tap on a related card opens it', async () => {
    await openDollNight();
    await until(() => !!card(3));
    act(() => { fireEvent.click(card(3)!); });
    expect(await until(() => title() === 'Fog Bank')).toBe(true);
  });

  it('no catalogue: the series row still comes from the lists already held', async () => {
    h.failAll = true;
    await openDollNight();
    expect(await until(() => row('series').length === 1)).toBe(true);
    expect(row('series')).toEqual(['Doll Night 3 [4K]']);
    expect(row('like')).toEqual(['Fog Bank', 'Sea Glass']);
  });
});
