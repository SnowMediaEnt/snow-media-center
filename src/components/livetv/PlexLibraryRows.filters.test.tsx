// The library's Genre / Year / Rated chips (owner, 2026-10-12: "when you
// select the genre or year or rated nothing pops up, it says 'nothing to
// choose here for this library'"). A chip opened before the library's facts
// came, or on a server whose facts leave the filter out, now waits for them
// and then asks the section's own list for that filter.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  meta: vi.fn(async () => ({ totalSize: 10, sorts: [], filters: [] as Array<{ filter: string; key: string; title: string }> })),
  values: vi.fn(async (_b: string, _t: string, path: string) => (path.includes('/genre') ? [{ key: '7', title: 'Comedy' }, { key: '8', title: 'Drama' }] : [])),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));
vi.mock('@/lib/plexReveal', () => ({ revealPlexRail: () => undefined, revealPlexTile: () => undefined }));
vi.mock('@/lib/plexUpNext', () => ({ upNextEpisodes: async () => [] }));
vi.mock('@/lib/plexBackdrop', () => ({ focusBackdrop: () => undefined }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexSectionRow: async () => [{ ratingKey: 'r1', title: 'Released One', type: 'movie', thumb: '/r1' }],
  getPlexSectionOnDeck: async () => [],
  getPlexSectionMeta: h.meta,
  getPlexFilterValues: h.values,
}));

const key = (k: string) => { fireEvent.keyDown(window, { key: k }); };
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(async () => {
  localStorage.clear();
  // Each test starts from a server whose facts list no filters, and whose
  // sections have genres only.
  h.meta.mockReset();
  h.meta.mockImplementation(async () => ({ totalSize: 10, sorts: [], filters: [] }));
  h.values.mockReset();
  h.values.mockImplementation(async (_b: string, _t: string, path: string) => (path.includes('/genre') ? [{ key: '7', title: 'Comedy' }, { key: '8', title: 'Drama' }] : []));
  (await import('@/lib/plex')).clearPlexCaches();
});

async function openGenre(sectionType: 'movie' | 'show' = 'movie', libKey = '3') {
  const { default: PlexLibraryRows } = await import('./PlexLibraryRows');
  render(
    <div data-plex-scroller="">
      <PlexLibraryRows isActive isCurrent base="http://pms" token="t" libKey={libKey} libTitle="Movies"
        sectionType={sectionType} onOpen={() => undefined} onExitToTabs={() => undefined} />
    </div>,
  );
  await flush(30);
  key('ArrowUp'); // the chip bar (Sort first)
  await flush(10);
  key('ArrowRight'); // Genre
  await flush(10);
  key('Enter');
  await flush(50);
}

describe('PlexLibraryRows — the Genre / Year / Rated choices', () => {
  it('a server whose library facts list no filters: the genres come from the section itself', async () => {
    await openGenre();
    expect(h.values).toHaveBeenCalledWith('http://pms', 't', '/library/sections/3/genre');
    expect(screen.queryByText('Comedy')).not.toBeNull();
    expect(screen.queryByText(/Nothing to choose/)).toBeNull();
  });

  it('entering the bar loads the library facts once and keeps them (they were thrown away by the effect itself)', async () => {
    h.meta.mockImplementation(async () => ({ totalSize: 10, sorts: [], filters: [{ filter: 'genre', key: '/library/sections/6/genre?listed=1', title: 'Genre' }] }));
    await openGenre('movie', '6');
    // One facts request (the bar's), and the chip used the key it listed.
    expect(h.meta).toHaveBeenCalledTimes(1);
    expect(h.values.mock.calls.map((c) => c[2])).toEqual(['/library/sections/6/genre?listed=1']);
    expect(screen.queryByText('Comedy')).not.toBeNull();
  });

  it('a server whose facts leave the filters out: Genre, Year and Rated stay in the bar after a genre is picked', async () => {
    await openGenre('movie', '7');
    key('ArrowDown'); // All → Comedy
    await flush(10);
    key('Enter');
    await flush(50);
    const bar = document.body.textContent ?? '';
    expect(bar).toMatch(/Genre/);
    expect(bar).toMatch(/Comedy/);
    expect(bar).toMatch(/Year/);
    expect(bar).toMatch(/Rated/);
  });

  it('a list that arrives after the viewer moved on opens nothing', async () => {
    let answer: (v: unknown) => void = () => undefined;
    h.values.mockImplementation(() => new Promise((r) => { answer = r as (v: unknown) => void; }));
    await openGenre('movie', '8');
    expect(screen.queryByText(/Loading…/)).not.toBeNull(); // open at once, filling in
    key('Escape'); // closes the chip's menu
    await flush(10);
    key('ArrowDown'); // into the rows
    await flush(10);
    await act(async () => { answer([{ key: '7', title: 'Comedy' }]); });
    await flush(30);
    expect(screen.queryByText('Comedy')).toBeNull();
  });

  it("a TV library asks for its shows' genres (type 2)", async () => {
    // Another library: the facts a test before kept for library 3 (they are
    // kept 20 minutes) do not apply.
    await openGenre('show', '4');
    expect(h.values).toHaveBeenCalledWith('http://pms', 't', '/library/sections/4/genre?type=2');
  });

  it('nothing anywhere: then it says so', async () => {
    h.values.mockImplementation(async () => []);
    await openGenre('movie', '5');
    expect(screen.queryByText(/Nothing to choose/)).not.toBeNull();
  });
});
