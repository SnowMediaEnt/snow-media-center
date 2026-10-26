// TV Shows › hold OK (owner, 1.9.8): a press opens the show / plays the
// episode when OK is let go; a hold opens the show's options (Report a
// problem) and never plays anything, its repeats included (some WebViews send
// them with e.repeat false). Held on an episode, the report names it.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  if (!('ResizeObserver' in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
});

const h = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, _opts: { body: { subject: string; message: string } }) => ({ error: null })),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  getSeriesCategories: async () => [{ category_id: '1', category_name: 'Drama' }],
  getSeries: async () => [{ series_id: 100, name: 'Harbor Lights', category_id: '1', releaseDate: '2023', rating: '8' }],
  getSeriesInfo: async () => ({
    seasons: [{ season_number: 1, name: 'Season 1' }],
    episodes: { 1: [{ id: '10', episode_num: 1, title: 'Pilot', container_extension: 'mp4' }, { id: '11', episode_num: 2, title: 'The Letter', container_extension: 'mp4' }] },
    info: { name: 'Harbor Lights', plot: 'A show.' },
  }),
  loadPlayerAccount: async () => null,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn() }));
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
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, i) => ({ index: i, key: i, start: i * estimateSize(), size: estimateSize() })),
    getTotalSize: () => count * estimateSize(),
    measure: () => undefined, scrollToOffset: () => undefined, scrollToIndex: () => undefined,
  }),
}));
vi.mock('./VodPlayer', () => ({ default: () => <div data-testid="vod-player" /> }));

import SeriesSection from './SeriesSection';
import { __resetOkLatchForTests } from '@/lib/okLatch';

const creds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' } as never;
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await settle(20); return ok(); };
const down = (repeat = false) => act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13, repeat }); });
const up = () => act(() => { fireEvent.keyUp(window, { key: 'Enter', keyCode: 13 }); });
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });
const hold = async () => { down(); await settle(350); down(); down(); await settle(350); down(); };
const playerShown = () => !!screen.queryByTestId('vod-player');
const onPage = () => !!document.querySelector('[data-episode-i="0"]');

beforeEach(() => { localStorage.clear(); h.invoke.mockClear(); __resetOkLatchForTests(); });
afterEach(() => { cleanup(); });

const toGrid = async () => {
  render(<SeriesSection creds={creds} isActive onExitLeft={vi.fn()} />);
  await until(() => (document.querySelector('[data-cat-i][data-focused="true"]')?.textContent ?? '').includes('Drama'));
  key('ArrowRight');
  await until(() => (document.querySelector('[data-vod-grid]')?.textContent ?? '').includes('Harbor Lights'));
};

describe('TV Shows: hold OK', () => {
  it('a hold on a poster: the show\'s options; let go, nothing opens', async () => {
    await toGrid();
    await hold();
    expect(screen.getByText(/Title options/)).toBeTruthy();
    up();
    await settle(20);
    expect(onPage()).toBe(false);
  });

  it('held on an episode: its options name the episode; the report goes as Series, and nothing played', async () => {
    await toGrid();
    key('Enter');
    await until(onPage);
    await hold();
    expect(screen.getByText('Report a problem')).toBeTruthy();
    up();
    expect(playerShown()).toBe(false);
    key('Enter'); // Report a problem
    key('Enter'); // Won't play
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    const [, opts] = h.invoke.mock.calls[0];
    expect(opts.body.subject).toBe('[Channel Report] Series issue: Harbor Lights · S1E1 · Pilot');
    expect(opts.body.message).toContain('Type: Series');
    expect(opts.body.message).toContain('Series ID: 100');
    expect(playerShown()).toBe(false);
  });

  it('a press on an episode still plays it (when let go)', async () => {
    await toGrid();
    key('Enter');
    await until(onPage);
    down();
    await settle();
    expect(playerShown()).toBe(false);
    up();
    await until(playerShown);
    expect(playerShown()).toBe(true);
  });
});
