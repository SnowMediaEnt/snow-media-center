// Hold OK on a Plex poster (plexRecommendHold) and the menu it opens
// (PlexRecommendMenu): a short OK opens the title when let go, a hold opens
// the menu once, the hold's repeats do nothing, the menu takes OK only after
// the hold is let go, and Recommend / Remove reach the account.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem } from '@/lib/plex';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; row?: Record<string, unknown>; eq?: Array<[string, unknown]> }>,
  mine: [] as Array<{ rating_key: string }>,
  toast: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* test */ } } } }) },
    from: (table: string) => {
      const eq: Array<[string, unknown]> = [];
      return {
        insert: async (row: Record<string, unknown>) => { h.ops.push({ op: `insert:${table}`, row }); return { error: null }; },
        delete: () => {
          const d = {
            eq: (c: string, v: unknown) => { eq.push([c, v]); return d; },
            then: (r: (v: unknown) => void) => { h.ops.push({ op: `delete:${table}`, eq }); r({ error: null }); },
          };
          return d;
        },
        select: () => {
          const q = { eq: () => q, limit: async () => ({ data: h.mine, error: null }) };
          return q;
        },
      };
    },
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast }));

import PlexRecommendMenu from './PlexRecommendMenu';
import { createPlexHoldOk, onPlexHoldMenu, releasePlexHoldMenu, tileHoldProps, PLEX_HOLD_MS, __resetPlexHoldForTests } from './plexRecommendHold';
import { getPlexKeyOwner, setPlexKeyOwner } from './plexKeyOwner';
import { __resetPlexRecommendForTests, setPlexRecommendContext } from '@/lib/plexRecommend';
import { __setViewerForTests } from '@/lib/viewer';
import { setKidsLevel } from '@/lib/kidsFilter';

const film: PlexItem = { ratingKey: '101', title: 'Harbor Lights', type: 'movie', year: 2021, contentRating: 'PG-13', librarySectionID: '1' };
const keyEvent = (type: 'keydown' | 'keyup', key = 'Enter', repeat = false) => new KeyboardEvent(type, { key, repeat, bubbles: true, cancelable: true });
const down = (repeat = false) => act(() => { window.dispatchEvent(keyEvent('keydown', 'Enter', repeat)); });
const up = () => act(() => { window.dispatchEvent(keyEvent('keyup')); });
const press = (key: string) => act(() => { window.dispatchEvent(keyEvent('keydown', key)); });
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  h.ops.length = 0; h.mine = []; h.toast.mockReset();
  __resetPlexHoldForTests();
  __resetPlexRecommendForTests();
  setPlexRecommendContext('srv-1', new Set());
  __setViewerForTests('user-1');
  setKidsLevel(null);
  setPlexKeyOwner('browse');
});
afterEach(() => { vi.useRealTimers(); });

describe('hold OK on a poster', () => {
  // As a panel wires it: OK down through press, any key up through release.
  const wire = () => {
    const hold = createPlexHoldOk();
    const open = vi.fn();
    const menu = vi.fn();
    const off = onPlexHoldMenu(menu);
    const kd = (e: KeyboardEvent) => { if (e.key === 'Enter') hold.press(e, film, open); };
    const ku = (e: KeyboardEvent) => hold.release(e);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return { open, menu, hold, done: () => { off(); window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); } };
  };

  it('a short OK opens the title when it is let go, not before', () => {
    vi.useFakeTimers();
    const w = wire();
    down();
    expect(w.open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    up();
    expect(w.open).toHaveBeenCalledTimes(1);
    expect(w.open).toHaveBeenCalledWith(film);
    vi.advanceTimersByTime(PLEX_HOLD_MS);
    expect(w.menu).not.toHaveBeenCalled();
    w.done();
  });

  it('held, the menu opens once and takes the remote; the repeats and the release open nothing', () => {
    vi.useFakeTimers();
    const w = wire();
    down();
    // A Fire TV repeats a held key.
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(100); down(true); }
    vi.advanceTimersByTime(PLEX_HOLD_MS);
    for (let i = 0; i < 5; i++) down(true);
    expect(w.menu).toHaveBeenCalledTimes(1);
    expect(w.menu).toHaveBeenCalledWith(film);
    expect(getPlexKeyOwner()).toBe('menu');
    up();
    expect(w.open).not.toHaveBeenCalled();
    // Closing hands the remote back to whoever had it.
    releasePlexHoldMenu();
    expect(getPlexKeyOwner()).toBe('browse');
    w.done();
  });

  it('the title page keeps the remote it had: the menu gives it back to the page', () => {
    vi.useFakeTimers();
    setPlexKeyOwner('detail');
    const w = wire();
    down();
    vi.advanceTimersByTime(PLEX_HOLD_MS);
    expect(getPlexKeyOwner()).toBe('menu');
    up();
    releasePlexHoldMenu();
    expect(getPlexKeyOwner()).toBe('detail');
    w.done();
  });

  it('a Kids profile has no menu: OK opens on the press, as before, and a hold opens nothing more', () => {
    vi.useFakeTimers();
    setKidsLevel('kids');
    const w = wire();
    down();
    expect(w.open).toHaveBeenCalledTimes(1);
    down(true);
    vi.advanceTimersByTime(PLEX_HOLD_MS * 2);
    up();
    expect(w.open).toHaveBeenCalledTimes(1);
    expect(w.menu).not.toHaveBeenCalled();
    expect(getPlexKeyOwner()).toBe('browse');
    w.done();
  });

  it('a finger held on the poster opens the menu; a finger that moves is scrolling', () => {
    vi.useFakeTimers();
    const menu = vi.fn();
    const off = onPlexHoldMenu(menu);
    const p = tileHoldProps(film);
    p.onTouchStart();
    vi.advanceTimersByTime(200);
    p.onTouchMove();
    vi.advanceTimersByTime(PLEX_HOLD_MS);
    expect(menu).not.toHaveBeenCalled();
    p.onTouchStart();
    vi.advanceTimersByTime(PLEX_HOLD_MS);
    expect(menu).toHaveBeenCalledTimes(1);
    releasePlexHoldMenu();
    off();
  });
});

describe('the menu', () => {
  const open = () => {
    const onClose = vi.fn(() => releasePlexHoldMenu());
    setPlexKeyOwner('menu');
    render(<PlexRecommendMenu item={film} server="srv-1" onClose={onClose} />);
    return onClose;
  };

  it('offers "Recommend to others"; OK is taken only after the hold is let go, then it recommends', async () => {
    const onClose = open();
    expect(await screen.findByText('Recommend to others')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Recommend Harbor Lights' })).toBeTruthy();
    // Still the hold that opened it.
    down(true);
    down();
    expect(onClose).not.toHaveBeenCalled();
    up();
    down();
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.ops).toHaveLength(1));
    expect(h.ops[0].op).toBe('insert:plex_recommendations');
    expect(h.ops[0].row).toMatchObject({ user_id: 'user-1', server_id: 'srv-1', rating_key: '101', type: 'movie', title: 'Harbor Lights' });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Recommended to other viewers', description: 'Harbor Lights' }));
  });

  it('already recommended by this viewer: "Recommended ✓ · Remove" takes it back', async () => {
    h.mine = [{ rating_key: '101' }];
    const onClose = open();
    expect(await screen.findByText('Recommended ✓ · Remove')).toBeTruthy();
    up();
    down();
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['delete:plex_recommendations']));
    expect(h.ops[0].eq).toEqual([['user_id', 'user-1'], ['server_id', 'srv-1'], ['rating_key', '101']]);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Removed', description: 'Harbor Lights' }));
  });

  it('▼ to Cancel and OK: closes, nothing sent', async () => {
    const onClose = open();
    await screen.findByText('Recommend to others');
    up();
    press('ArrowDown');
    down();
    expect(onClose).toHaveBeenCalledTimes(1);
    await tick(10);
    expect(h.ops).toEqual([]);
  });

  it('Back closes it, even before the hold is let go; nothing sent', async () => {
    const onClose = open();
    await screen.findByText('Recommend to others');
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getPlexKeyOwner()).toBe('browse');
    await tick(10);
    expect(h.ops).toEqual([]);
  });

  it('signed out: says to sign in, and offers nothing to send', async () => {
    __setViewerForTests('device');
    const onClose = open();
    expect(await screen.findByText(/Sign in to your Snow Media account to recommend titles/)).toBeTruthy();
    expect(screen.queryByText('Recommend to others')).toBeNull();
    up();
    down();
    expect(onClose).toHaveBeenCalledTimes(1);
    await tick(10);
    expect(h.ops).toEqual([]);
  });

  it('a tap on Recommend works too (a phone)', async () => {
    const onClose = open();
    fireEvent.click(await screen.findByText('Recommend to others'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations']));
  });
});
