// The favourite toggle the Guide's held OK uses: saved on the box at once,
// where Live TV's list reads it, then pushed to the account once, debounced;
// a line that is not the active one (another service) keeps its own list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sets } = vi.hoisted(() => ({ sets: [] as Array<{ host: unknown; op: unknown; favorites: Array<{ stream_id: number }> }> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
        if (body.op === 'get') return { data: { ok: true, favorites: null, version: null }, error: null };
        sets.push({ host: body.host, op: body.op, favorites: body.favorites as Array<{ stream_id: number }> });
        return { data: { ok: true, applied: true, favorites: body.favorites, version: sets.length }, error: null };
      },
    },
  },
}));

import { commitFavoritesForLine, loadFavoritesForLine, prepareLocalForLine, toggledFavorites } from './favoritesSync';
import { loadFavoritesData, type FavChannel, type XtreamCreds } from './xtream';

const creds = { host: 'http://h.test', username: 'u', password: 'p' } as unknown as XtreamCreds;
const other = { host: 'http://other.test', username: 'v', password: 'q' } as unknown as XtreamCreds;
const event = { stream_id: 7, name: 'EVENT 03: Rivertown Hawks vs Lakeside Owls 7:30 PM ET', num: 3, category_id: '1', stream_icon: '', epg_channel_id: 'e3' };

beforeEach(() => { localStorage.clear(); sets.length = 0; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('favourite toggle (the Guide)', () => {
  it('adds a channel (the fields the lists read), takes it out again; a new map each time', () => {
    const empty = new Map<number, FavChannel>();
    const one = toggledFavorites(empty, event);
    expect(empty.size).toBe(0);
    expect([...one.values()]).toEqual([{ stream_id: 7, name: event.name, num: 3, category_id: '1', stream_icon: '', epg_channel_id: 'e3' }]);
    const none = toggledFavorites(one, event);
    expect(one.size).toBe(1);
    expect(none.size).toBe(0);
  });

  it('saved on the box at once (what Live TV reads), pushed to the account once after the burst', async () => {
    prepareLocalForLine(creds, loadFavoritesData());
    const onAdopt = vi.fn();
    const one = toggledFavorites(loadFavoritesForLine(creds), event);
    commitFavoritesForLine(creds, one, onAdopt);
    expect([...loadFavoritesForLine(creds).keys()]).toEqual([7]);
    const two = toggledFavorites(one, { stream_id: 8, name: 'News One' });
    commitFavoritesForLine(creds, two, onAdopt);
    expect([...loadFavoritesForLine(creds).keys()]).toEqual([7, 8]);
    expect(sets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sets).toHaveLength(1);
    expect(sets[0].favorites.map((f) => f.stream_id)).toEqual([7, 8]);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("another service's line: its own list, not the active line's", async () => {
    prepareLocalForLine(creds, loadFavoritesData());
    commitFavoritesForLine(creds, toggledFavorites(loadFavoritesForLine(creds), event), vi.fn());
    commitFavoritesForLine(other, toggledFavorites(loadFavoritesForLine(other), { stream_id: 9, name: 'Other Sports' }), vi.fn());
    expect([...loadFavoritesForLine(creds).keys()]).toEqual([7]);
    expect([...loadFavoritesForLine(other).keys()]).toEqual([9]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sets.map((s) => [s.host, s.favorites.map((f) => f.stream_id)])).toEqual(expect.arrayContaining([
      ['h.test', [7]],
      ['other.test', [9]],
    ]));
  });
});
