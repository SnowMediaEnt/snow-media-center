/**
 * Recommend on the Plex title page: a film's or a show's page has Recommend
 * beside My List (once the server it plays from is known). OK recommends it
 * to the other viewers of that server, and on "Recommended" OK takes it back.
 * It sits in the button row: ◀ ▶ reach it, ▼ goes to Trailer and ▲ comes
 * back to it. No Recommend on an episode's page, a Kids profile or an adult
 * title. The actor's titles take the same held OK as every other poster.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  ops: [] as Array<{ op: string; row?: Record<string, unknown> }>,
  mine: [] as Array<{ rating_key: string }>,
  toast: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { /* test */ } } } }) },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => { h.ops.push({ op: `insert:${table}`, row }); return { error: null }; },
      delete: () => {
        const d = { eq: () => d, then: (r: (v: unknown) => void) => { h.ops.push({ op: `delete:${table}` }); r({ error: null }); } };
        return d;
      },
      select: () => { const q = { eq: () => q, limit: async () => ({ data: h.mine, error: null }) }; return q; },
      upsert: async () => ({ error: null }),
    }),
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk,
      title: rk === '201' ? 'The Show' : rk === '401' ? 'Pilot' : rk === '501' ? 'Late Night' : rk === '601' ? 'Other Film' : 'The Film',
      type: rk === '201' ? 'show' : rk === '401' ? 'episode' : 'movie',
      year: 2020,
      contentRating: rk === '501' ? 'X' : 'PG',
      librarySectionID: '1',
      genres: [], cast: [{ id: '7', tag: 'Ana Actor' }], directors: [],
      partKey: '/library/parts/1/file.mkv',
      primaryExtraKey: '/library/metadata/901',
    })),
    getPlexActorItems: vi.fn(async () => [
      { ratingKey: '601', title: 'Other Film', type: 'movie', librarySectionID: '1', contentRating: 'PG' },
    ]),
    getPlexTrailer: vi.fn(async () => ({ ratingKey: '901', title: 'Trailer', partKey: '/library/parts/901/t.mp4', online: false })),
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexDetail from './PlexDetail';
import { getPlexKeyOwner, setPlexKeyOwner } from './plexKeyOwner';
import { onPlexHoldMenu, releasePlexHoldMenu, __resetPlexHoldForTests } from './plexRecommendHold';
import { __resetPlexRecommendForTests, setPlexRecommendContext } from '@/lib/plexRecommend';
import { __setViewerForTests } from '@/lib/viewer';
import { setKidsLevel } from '@/lib/kidsFilter';
import type { PlexItem } from '@/lib/plex';

const press = (key: string, repeat = false) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true })); });
const release = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); });
const focusedText = () => Array.from(document.querySelectorAll('[data-focused="true"]')).map((el) => el.textContent?.trim());
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => {
  h.ops.length = 0; h.mine = []; h.toast.mockReset();
  localStorage.clear();
  setPlexKeyOwner('detail');
  setKidsLevel(null);
  __resetPlexHoldForTests();
  __resetPlexRecommendForTests();
  setPlexRecommendContext('srv-1', new Set(['9']));
  __setViewerForTests('user-1');
});
afterEach(() => { setKidsLevel(null); });

function renderDetail(item: PlexItem) {
  render(<PlexDetail isActive base="http://srv:32400" token="tok" item={item} onPlay={vi.fn()} onPlayEpisode={vi.fn()} onBack={vi.fn()} onPlayTrailer={vi.fn()} />);
}
const buttons = () => Array.from(document.querySelectorAll('[data-plex-detail-top] button')).map((b) => b.textContent?.trim()).filter(Boolean);

describe('Recommend on the title page', () => {
  it('beside My List: OK recommends, OK on "Recommended" takes it back', async () => {
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await waitFor(() => expect(screen.getByText('Recommend')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('Trailer')).toBeTruthy(), { timeout: 5000 });
    expect(buttons().slice(0, 3)).toEqual(['Play', 'My List', 'Recommend']);
    press('ArrowRight');
    press('ArrowRight');
    expect(focusedText()).toEqual(['Recommend']);
    press('Enter');
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations']));
    expect(h.ops[0].row).toMatchObject({ user_id: 'user-1', server_id: 'srv-1', rating_key: '101', type: 'movie', title: 'The Film', year: 2020, content_rating: 'PG' });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Recommended to other viewers', description: 'The Film' }));
    await waitFor(() => expect(focusedText()).toEqual(['Recommended']));
    // A held OK is one press.
    press('Enter', true);
    await wait(20);
    expect(h.ops).toHaveLength(1);
    // Let go, then a new press.
    release('Enter');
    press('Enter');
    await waitFor(() => expect(h.ops.map((o) => o.op)).toEqual(['insert:plex_recommendations', 'delete:plex_recommendations']));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith({ title: 'Removed', description: 'The Film' }));
    await waitFor(() => expect(focusedText()).toEqual(['Recommend']));
  }, 15_000);

  it('▼ from it goes to Trailer and ▲ comes back to it', async () => {
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await waitFor(() => expect(screen.getByText('Trailer')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('Recommend')).toBeTruthy(), { timeout: 5000 });
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    expect(focusedText()).toEqual(['Trailer']);
    press('ArrowUp');
    expect(focusedText()).toEqual(['Recommend']);
  }, 15_000);

  it('already recommended on this account: "Recommended" from the start', async () => {
    h.mine = [{ rating_key: '201' }];
    renderDetail({ ratingKey: '201', title: 'The Show', type: 'show' });
    expect(await screen.findByText('Recommended', undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText('Recommend')).toBeNull();
  }, 15_000);

  it('none on an episode\'s page', async () => {
    renderDetail({ ratingKey: '401', title: 'Pilot', type: 'episode', grandparentTitle: 'The Show', grandparentRatingKey: '201' });
    await screen.findByText('Ana Actor', undefined, { timeout: 5000 });
    expect(screen.queryByText('Recommend')).toBeNull();
  }, 15_000);

  it('none on a Kids profile', async () => {
    setKidsLevel('kids');
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie', contentRating: 'PG' });
    await screen.findByText('Ana Actor', undefined, { timeout: 5000 });
    expect(screen.getByText('My List')).toBeTruthy();
    expect(screen.queryByText('Recommend')).toBeNull();
  }, 15_000);

  it('none for an adult title', async () => {
    renderDetail({ ratingKey: '501', title: 'Late Night', type: 'movie' });
    await screen.findByText('Ana Actor', undefined, { timeout: 5000 });
    await wait(50);
    expect(screen.queryByText('Recommend')).toBeNull();
  }, 15_000);

  it('none with no server known', async () => {
    setPlexRecommendContext(null);
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await screen.findByText('Ana Actor', undefined, { timeout: 5000 });
    expect(screen.queryByText('Recommend')).toBeNull();
  }, 15_000);
});

describe("an actor's titles", () => {
  it('a short OK opens one; held, its menu, and the page has the remote back after', async () => {
    const menu = vi.fn();
    const off = onPlexHoldMenu(menu);
    renderDetail({ ratingKey: '101', title: 'The Film', type: 'movie' });
    await screen.findByText('Ana Actor', undefined, { timeout: 5000 });
    // ▼ Trailer, ▼ the cast, OK: the actor's titles.
    await waitFor(() => expect(screen.getByText('Trailer')).toBeTruthy(), { timeout: 5000 });
    press('ArrowDown');
    press('ArrowDown');
    press('Enter');
    await screen.findByText('Other Film', undefined, { timeout: 5000 });
    // Held: the menu, once.
    press('Enter');
    await wait(700);
    press('Enter', true);
    expect(menu).toHaveBeenCalledTimes(1);
    expect(menu.mock.calls[0][0]).toMatchObject({ ratingKey: '601', title: 'Other Film' });
    expect(getPlexKeyOwner()).toBe('menu');
    release('Enter');
    expect(screen.queryByText('Ana Actor')).toBeNull();
    releasePlexHoldMenu();
    expect(getPlexKeyOwner()).toBe('detail');
    // A short OK opens it (on the release).
    press('Enter');
    release('Enter');
    await waitFor(() => expect(document.querySelector('h1')?.textContent).toBe('Other Film'));
    expect(menu).toHaveBeenCalledTimes(1);
    off();
  }, 20_000);
});
