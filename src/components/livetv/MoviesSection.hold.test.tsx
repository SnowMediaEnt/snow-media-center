/**
 * Live TV › VOD › hold OK on a film (owner, 1.9.8: "when you select and hold
 * on a movie in the menu it opens the movie and flops back and forth
 * pause/play. A press and hold should bring up the menu to report it.").
 *
 * A press (OK let go quickly) opens the film's page and plays it, as before.
 * A hold opens the film's options (Report a problem, Cancel) and nothing
 * else: the held OK's repeats, which some WebViews send with e.repeat false,
 * neither open the film nor pick a row. The report reaches report-channel
 * tagged as a film. And the player never toggles pause/play on a held OK.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  args: [] as Array<{ active: boolean; url: string | null }>,
  toggles: 0,
  invoke: vi.fn(async (_fn: string, _opts: { body: { subject: string; message: string } }) => ({ error: null })),
}));

// The report dialog's 30-second check (Device Health) is not what these test: it can't run here.
vi.mock('@/lib/deviceCheck', () => ({ CHECK_SECONDS: 30, runDeviceCheck: async () => null }));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: { active: boolean; url: string | null }) => {
    h.args.push(a);
    return {
      controller: {
        getAudioTracks: () => [], setAudioTrack: () => {}, getSubtitleTracks: () => [], setSubtitleTrack: () => {},
        togglePlay: () => { h.toggles += 1; }, play: () => {}, pause: () => {}, seek: () => {}, isPaused: () => false, isSeekable: () => true,
      },
      buffering: false, paused: false, error: null, audioWarning: null, engineNotice: null,
      retry: () => {}, seekTo: async () => {}, getPosition: async () => ({ position: 100, duration: 3600, playing: true }),
    };
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: () => {}, startTimer: () => {}, stopTimer: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: h.invoke },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));
vi.mock('@/lib/xtream', async (orig) => {
  const real = await orig<typeof import('@/lib/xtream')>();
  return {
    ...real,
    getVodCategories: async () => [{ category_id: '5', category_name: 'Action', parent_id: 0 }],
    getVodStreams: async () => [{ stream_id: 77, name: 'Big Film', container_extension: 'mp4', stream_type: 'movie', category_id: '5' }],
    getVodInfo: async () => ({ info: { plot: 'A film.' }, movie_data: { stream_id: 77, container_extension: 'mkv' } }),
    loadPlayerAccount: async () => null,
  };
});

import MoviesSection from './MoviesSection';
import VodPlayer from './VodPlayer';
import { __resetOkLatchForTests } from '@/lib/okLatch';

if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const creds = { host: 'http://panel.example:8080', username: 'user1', password: 'pass1', serverLabel: 'Test' };
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const down = (repeat = false) => act(() => { fireEvent.keyDown(window, { key: 'Enter', repeat }); });
const up = () => act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
const press = async (k: string) => {
  await act(async () => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });
  await settle();
};
/** OK held past the hold time; the key repeats (e.repeat false, as some WebViews send them). */
const hold = async () => {
  down();
  await wait(350);
  down(); down();
  await wait(350);
  down(); down(true);
};
const filmPage = () => document.querySelector('[data-movie-detail]');
const player = () => document.querySelector('[data-vod-player]');

async function toGrid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render(<MoviesSection creds={creds as any} isActive onExitLeft={() => {}} />);
  await settle();
  await press('Enter'); // the first real category → its posters
}

beforeEach(() => {
  h.args = []; h.toggles = 0; h.invoke.mockClear();
  localStorage.clear();
  __resetOkLatchForTests();
});

describe('hold OK on a film', () => {
  it('a press (let go in time) opens the film page when let go, not before', async () => {
    await toGrid();
    down();
    await settle();
    expect(filmPage()).toBeNull();
    up();
    await settle();
    expect(filmPage()).not.toBeNull();
  });

  it('a hold on a poster: the film\'s options, and the held OK opens nothing and picks nothing', async () => {
    await toGrid();
    await hold();
    expect(screen.getByText(/Title options/)).toBeTruthy();
    expect(screen.getByText('Report a problem')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    // Still the hold: its repeats move nothing on.
    expect(screen.queryByText("Won't play")).toBeNull();
    up();
    await settle();
    expect(filmPage()).toBeNull();
    expect(screen.queryByText("Won't play")).toBeNull();
    expect(player()).toBeNull();
  });

  it('Report a problem → Won\'t play: report-channel gets the film, tagged as a film', async () => {
    await toGrid();
    await hold();
    up();
    await press('Enter'); // Report a problem
    expect(screen.getByText("Won't play")).toBeTruthy();
    expect(screen.getByText('Wrong title or no subtitles')).toBeTruthy();
    await press('Enter'); // Won't play
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const [fn, opts] = h.invoke.mock.calls[0];
    expect(fn).toBe('report-channel');
    expect(opts.body.subject).toBe('[Channel Report] Movie issue: Big Film');
    expect(opts.body.message).toContain('Type: Movie');
    expect(opts.body.message).toContain('Title: Big Film');
    expect(opts.body.message).toContain('Category: Action');
    expect(opts.body.message).toContain("Issue: Won't play");
    expect(opts.body.message).toContain('Movie ID: 77');
    expect(opts.body.message).not.toContain('pass1');
  });

  it('Cancel closes the menu; the posters have the remote again', async () => {
    await toGrid();
    await hold();
    up();
    await press('ArrowDown');
    await press('Enter');
    expect(screen.queryByText('Report a problem')).toBeNull();
    await press('Enter');
    expect(filmPage()).not.toBeNull();
  });

  it('on the film page: a press on Play plays it; a hold opens the options and never starts it', async () => {
    await toGrid();
    await press('Enter');
    expect(filmPage()).not.toBeNull();
    await hold();
    expect(screen.getByText('Report a problem')).toBeTruthy();
    up();
    await settle();
    expect(player()).toBeNull();
    // Cancel, then a press plays.
    await press('ArrowDown');
    await press('Enter');
    await press('Enter');
    expect(player()).not.toBeNull();
  });
});

describe('the player and a held OK', () => {
  it('a held OK running on into the player never toggles pause/play; a new press after it is let go does', async () => {
    await toGrid();
    await press('Enter'); // the film page
    // OK down on Play and let go: the film starts. Then held again with the
    // bar down: the first OK shows the bar, the repeats never toggle.
    await press('Enter');
    expect(player()).not.toBeNull();
    down();
    await settle();
    down(); down(); down(true); down();
    await settle();
    expect(h.toggles).toBe(0);
    up();
    down(); up();
    await settle();
    expect(h.toggles).toBe(1);
  });
});

describe('a player opened while OK is still held', () => {
  it('ignores that OK, repeats and all, until it is let go; then OK shows the bar and the next one pauses', async () => {
    down(); // the OK that started it, still down
    render(<VodPlayer src="http://panel.example:8080/movie/u/p/1.mp4" title="Big Film" volume={1} onVolumeChange={() => {}} onClose={() => {}} />);
    await settle();
    down(); down(); down(true); down();
    await settle();
    expect(document.querySelector('[data-vod-bar]')).toBeNull();
    expect(h.toggles).toBe(0);
    up();
    down(); up(); // the bar
    await settle();
    expect(document.querySelector('[data-vod-bar]')).not.toBeNull();
    expect(h.toggles).toBe(0);
    down(); up(); // Play/Pause
    await settle();
    expect(h.toggles).toBe(1);
  });
});
