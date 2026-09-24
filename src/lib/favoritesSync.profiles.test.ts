import { beforeEach, describe, expect, it, vi } from 'vitest';

// The player-favorites function, one row per line and profile.
type Fav = { stream_id: number; name: string; category_id?: string };
const { rows, sets } = vi.hoisted(() => ({
  rows: new Map<string, { favorites: unknown[]; version: number }>(),
  sets: [] as Array<{ profile: string; favorites: Array<{ name: string }> }>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: async (_fn: string, { body }: { body: Record<string, unknown> }) => {
        const profile = String(body.profile ?? 'main');
        const row = rows.get(profile);
        if (body.op === 'get') return { data: { ok: true, favorites: row?.favorites ?? null, version: row?.version ?? null }, error: null };
        const favorites = body.favorites as Array<{ name: string }>;
        sets.push({ profile, favorites });
        const version = (row?.version ?? 0) + 1;
        rows.set(profile, { favorites, version });
        return { data: { ok: true, applied: true, favorites, version }, error: null };
      },
    },
  },
}));

import { loadFavoritesForLine, prepareLocalForLine, reconcileFavoritesForLine, saveFavoritesForLine } from './favoritesSync';
import { loadFavoritesData, saveFavoritesData, type XtreamCreds } from './xtream';
import { setViewerProfile } from './viewer';

const creds = { host: 'http://h.com', username: 'u', password: 'p', serverLabel: 'Dreamstreams' } as unknown as XtreamCreds;
const GROWN_UP: Fav[] = [
  { stream_id: 1, name: 'HBO', category_id: '10' },
  { stream_id: 2, name: 'XXX Adult 1', category_id: '99' },
];
const names = (m: Map<number, Fav>) => [...m.values()].map((f) => f.name);
const toMap = (list: Fav[]) => new Map(list.map((f) => [f.stream_id, f]));

/** What LiveSection does when Live TV opens with these credentials. */
async function openLiveTv() {
  const switched = prepareLocalForLine(creds, loadFavoritesData());
  const shown = switched ?? loadFavoritesData();
  const next = await reconcileFavoritesForLine(creds, () => loadFavoritesForLine(creds));
  if (next) saveFavoritesForLine(creds, next); // adoptFavoritesFor
  return next ?? shown;
}

beforeEach(() => {
  localStorage.clear();
  rows.clear();
  sets.length = 0;
  setViewerProfile('main');
});

describe('favourites on a new profile', () => {
  it('a Kids profile starts empty — the grown-up list is neither shown nor seeded as its own', async () => {
    rows.set('main', { favorites: GROWN_UP, version: 3 });
    expect(names(await openLiveTv())).toEqual(['HBO', 'XXX Adult 1']);

    setViewerProfile('kid1');
    // Multi-Screen reads this before Live TV has run for the profile.
    expect(names(loadFavoritesForLine(creds))).toEqual([]);
    expect(names(await openLiveTv())).toEqual([]);
    expect(names(loadFavoritesData())).toEqual([]);
    expect(sets.filter((s) => s.profile === 'kid1')).toEqual([]);
    // The next visit reads the local store: still the kid's (empty) list.
    expect(names(await openLiveTv())).toEqual([]);

    // Back on the grown-up profile, the list is all there.
    setViewerProfile('main');
    expect(names(await openLiveTv())).toEqual(['HBO', 'XXX Adult 1']);
    expect(names(loadFavoritesData())).toEqual(['HBO', 'XXX Adult 1']);
  });

  it("a profile's own list comes back when it returns", async () => {
    rows.set('main', { favorites: GROWN_UP, version: 3 });
    rows.set('kid1', { favorites: [{ stream_id: 7, name: 'Cartoon Network', category_id: '5' }], version: 1 });
    await openLiveTv();
    setViewerProfile('kid1');
    expect(names(await openLiveTv())).toEqual(['Cartoon Network']);
    setViewerProfile('main');
    await openLiveTv();
    setViewerProfile('kid1');
    // Restored from its stash straight away, before any network call.
    expect(names(prepareLocalForLine(creds, loadFavoritesData())!)).toEqual(['Cartoon Network']);
  });

  it('an install from before sync keeps its list for the grown-up, not the child', async () => {
    saveFavoritesData(toMap(GROWN_UP)); // no sync meta yet
    setViewerProfile('kid1');
    expect(names(await openLiveTv())).toEqual([]);
    expect(sets.filter((s) => s.profile === 'kid1')).toEqual([]);

    setViewerProfile('main');
    expect(names(await openLiveTv())).toEqual(['HBO', 'XXX Adult 1']);
    // Seeded to the grown-up's own row, as a first sync always did.
    expect(sets.map((s) => s.profile)).toEqual(['main']);
  });
});
