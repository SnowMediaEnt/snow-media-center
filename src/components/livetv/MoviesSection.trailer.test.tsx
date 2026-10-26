/**
 * Trailer on a film's page (owner, 2026-10-11: "did we add the trailer option
 * to VOD ... with the fix to play in SMC instead of going out and the pause
 * fix as well"; Tronix 78d8b7d, 13015b8, 1039497):
 *  - once the page's info is in, on its own line under Play: "Watch trailer"
 *    with the panel's video, "Find the trailer" (a search for "<title> <year>
 *    trailer") without one;
 *  - the remote: ▼ from Play reaches it, ▲ goes back, ◀ ▶ there do nothing,
 *    OK opens it;
 *  - the panel's video plays inside the app (TrailerOverlay) and the film's
 *    player is never touched; Back closes it, one step, the highlight still
 *    on Trailer; a search opens outside;
 *  - a tap opens it on a phone;
 *  - none on a Kids profile.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const ID = 'Ab3_dE-9xYz';
const h = vi.hoisted(() => ({
  vodInfo: {} as Record<number, unknown>,
  /** A page whose info is held back until released. */
  hold: null as null | { id: number; release: () => void },
}));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getVodCategories: async () => [{ category_id: '5', category_name: 'Action', parent_id: 0 }],
  getVodStreams: async () => [
    { stream_id: 11, name: 'EN - Harbor Lights', year: '2005', container_extension: 'mp4', stream_type: 'movie' },
    { stream_id: 12, name: 'Night Ferry [4K]', container_extension: 'mp4', stream_type: 'movie' },
  ],
  getVodInfo: async (_c: unknown, id: number) => {
    if (h.hold?.id === id) await new Promise<void>((r) => { h.hold!.release = r; });
    return h.vodInfo[id] ?? { info: {} };
  },
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
// The film's player (its own tests): here only whether it opened.
vi.mock('./VodPlayer', () => ({ default: ({ src }: { src: string }) => <div data-testid="vod-player" data-src={src} /> }));

import MoviesSection from './MoviesSection';
import { __resetTrailerForTests } from '@/lib/trailer';
import { setKidsLevel } from '@/lib/kidsFilter';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
// Generous: a busy machine runs these pages slowly.
const until = async (ok: () => boolean) => { for (let i = 0; i < 300 && !ok(); i++) await settle(20); return ok(); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
// OK is pressed and let go, as a remote does (a press runs on its release).
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); if (key === 'Enter' || key === ' ') fireEvent.keyUp(window, { key }); });
const tap = (el: Element | null | undefined) => act(() => { fireEvent.click(el!); });
const trailer = () => q('[data-movie-detail] [data-trailer]');
const play = () => q('[data-movie-detail] [data-detail-btn="play"]');
const lit = (el: HTMLElement | null) => el?.getAttribute('data-focused') === 'true';
const overlay = () => q('[data-trailer-overlay]');
const player = () => q('[data-testid="vod-player"]');
const tile = (name: string) => [...document.querySelectorAll<HTMLElement>('[data-vod-grid] [data-focused]')].find((e) => (e.textContent || '').includes(name));
const open = vi.fn();

/** The embed in the layer: it answers, plays, and OK pauses it under the Paused card. */
const pauseInLayer = () => {
  const f = q('[data-trailer-frame]') as HTMLIFrameElement;
  const say = (data: unknown) => act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), origin: 'https://www.youtube-nocookie.com', source: f.contentWindow }));
  });
  say({ event: 'initialDelivery', info: { duration: 90 } });
  say({ event: 'infoDelivery', info: { playerState: 1, currentTime: 12 } });
  press('Enter');
};

/** A TV: the category, then the film at `i` in the grid, its page. */
const openFilm = async (i: number) => {
  render(<MoviesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => (q('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Action'));
  press('Enter');
  await until(() => !!tile('Night Ferry'));
  for (let k = 0; k < i; k++) press('ArrowRight');
  press('Enter');
  await until(() => !!q('[data-movie-detail]'));
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); __resetTrailerForTests();
  h.vodInfo = {
    11: { info: { plot: 'A film.', youtube_trailer: `https://youtu.be/${ID}`, releasedate: '2005-04-01' } },
    12: { info: { plot: 'Another film.', youtube_trailer: '', releasedate: '2011-03-02' } },
  };
  h.hold = null;
  open.mockReset();
  vi.stubGlobal('open', open);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setKidsLevel(null); __setPhoneModeForTests({ touch: false, phone: false }); });

describe('Trailer on a film\'s page (TV)', { timeout: 30000 }, () => {
  it('with the panel\'s video: "Watch trailer" on its own line under Play; ▼ reaches it, OK plays it inside the app; Back, the highlight is still there', async () => {
    await openFilm(0);
    expect(await until(() => !!trailer())).toBe(true);
    expect(trailer()!.textContent).toBe('Trailer');
    expect(trailer()!.getAttribute('aria-label')).toBe('Watch trailer');
    expect(trailer()!.getAttribute('data-trailer')).toBe('video');
    expect(trailer()!.closest('[data-movie-trailer-line]')).not.toBeNull();
    expect(lit(play())).toBe(true);
    expect(lit(trailer())).toBe(false);
    // ◀ ▶ from Play: nothing to walk to.
    press('ArrowRight'); press('ArrowLeft');
    expect(lit(play())).toBe(true);
    press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    expect(lit(play())).toBe(false);
    // ◀ ▶ on the Trailer line do nothing; ▼ stays.
    press('ArrowRight'); press('ArrowLeft'); press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    press('Enter');
    await settle();
    // Inside the app: the embed, not a new tab; the film's player untouched.
    expect(open).not.toHaveBeenCalled();
    expect(await until(() => !!overlay())).toBe(true);
    expect(q('[data-trailer-frame]')!.getAttribute('src')!.startsWith(`https://www.youtube-nocookie.com/embed/${ID}?`)).toBe(true);
    expect(player()).toBeNull();
    // Back closes it, one step: the same page, Trailer highlighted, the frame gone.
    press('Escape');
    await settle(20);
    expect(overlay()).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(q('[data-movie-detail]')).not.toBeNull();
    expect(lit(trailer())).toBe(true);
    // ▲ back to Play, and the film plays as before.
    press('ArrowUp');
    expect(lit(play())).toBe(true);
    press('Enter');
    expect(await until(() => !!player())).toBe(true);
    expect(player()!.getAttribute('data-src')).toMatch(/\/movie\/user1\/pass1\/11\.mp4$/);
  });

  it('OK pauses it under the Paused card, which names the title as the page shows it; Back still closes it in one step', async () => {
    await openFilm(0);
    await until(() => !!trailer());
    press('ArrowDown'); press('Enter');
    expect(await until(() => !!overlay())).toBe(true);
    pauseInLayer();
    expect(q('[data-trailer-paused]')).not.toBeNull();
    expect(q('[data-trailer-title]')!.textContent).toBe('EN - Harbor Lights');
    expect(q('[data-trailer-time]')!.textContent).toBe('0:12 / 1:30');
    press('Escape');
    await settle(20);
    expect(overlay()).toBeNull();
    expect(lit(trailer())).toBe(true);
  });

  it('while it plays, the page\'s keys stand aside: the arrows and OK never move or play anything under it', async () => {
    await openFilm(0);
    await until(() => !!trailer());
    press('ArrowDown'); press('Enter');
    expect(await until(() => !!overlay())).toBe(true);
    press('ArrowUp'); press('ArrowUp'); press('Enter'); press('Enter');
    await settle();
    expect(player()).toBeNull();
    expect(overlay()).not.toBeNull();
    press('Escape');
    await settle(20);
    // Still the film's page (Back took one step), Trailer still highlighted.
    expect(q('[data-movie-detail]')).not.toBeNull();
    expect(lit(trailer())).toBe(true);
    // The next Back leaves the page, as always.
    press('Escape');
    await settle(20);
    expect(q('[data-movie-detail]')).toBeNull();
  });

  it('without one: "Find the trailer", a search for its name and year (outside the app)', async () => {
    await openFilm(1);
    expect(await until(() => !!trailer())).toBe(true);
    expect(trailer()!.getAttribute('data-trailer')).toBe('search');
    expect(trailer()!.getAttribute('aria-label')).toBe('Find the trailer');
    press('ArrowDown'); press('Enter');
    await settle(20);
    expect(open).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=Night%20Ferry%202011%20trailer', '_blank', 'noopener,noreferrer');
    expect(overlay()).toBeNull();
    expect(player()).toBeNull();
  });

  it('not before the page\'s info is in: ▼ from Play reaches nothing until it is', async () => {
    h.hold = { id: 11, release: () => undefined };
    await openFilm(0);
    await settle(40);
    expect(trailer()).toBeNull();
    press('ArrowDown');
    expect(lit(play())).toBe(true);
    act(() => { h.hold!.release(); });
    expect(await until(() => !!trailer())).toBe(true);
    expect(trailer()!.getAttribute('data-trailer')).toBe('video');
    press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    press('ArrowUp');
    expect(lit(play())).toBe(true);
  });

  it('another film\'s page starts on Play again', async () => {
    await openFilm(0);
    await until(() => !!trailer());
    press('ArrowDown');
    expect(lit(trailer())).toBe(true);
    press('Escape'); // the grid
    await until(() => !q('[data-movie-detail]'));
    press('ArrowRight'); press('Enter');
    await until(() => !!q('[data-movie-detail]') && !!trailer());
    expect(lit(play())).toBe(true);
    expect(trailer()!.getAttribute('data-trailer')).toBe('search');
  });
});

describe('Trailer by touch (phone)', { timeout: 30000 }, () => {
  beforeEach(() => { __setPhoneModeForTests({ touch: true, phone: true, portrait: true }); });

  it('a tap on Trailer plays it inside the app; its Close button closes it', async () => {
    render(<MoviesSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    await until(() => (q('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Action'));
    tap(q('[data-cat-i][data-focused="true"]'));
    await until(() => !!tile('Harbor Lights'));
    tap(tile('Harbor Lights'));
    expect(await until(() => !!trailer())).toBe(true);
    tap(trailer());
    await settle();
    expect(open).not.toHaveBeenCalled();
    expect(await until(() => !!q('[data-trailer-frame]'))).toBe(true);
    tap(q('[data-trailer-close]'));
    await settle(20);
    expect(overlay()).toBeNull();
    expect(q('[data-movie-detail]')).not.toBeNull();
  });
});

describe('Kids profile: no Trailer', { timeout: 30000 }, () => {
  it('a film\'s page, even with the panel\'s video: Play and nothing under it', async () => {
    setKidsLevel('kids');
    await openFilm(0);
    expect(await until(() => q('[data-movie-detail]')?.textContent?.includes('A film.') ?? false)).toBe(true);
    await settle(20);
    expect(trailer()).toBeNull();
    expect(q('[data-movie-trailer-line]')).toBeNull();
    press('ArrowDown');
    expect(lit(play())).toBe(true);
    press('Enter');
    expect(await until(() => !!player())).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
