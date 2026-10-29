// The library's Studios row (owner, 2026-10-29): text tiles of studio groups
// after Recently Added, Angel Studios first; OK on one opens the library
// filtered to that studio, with a "Studio: X" chip, and Back undoes it.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  meta: vi.fn(),
  values: vi.fn(),
  query: vi.fn(),
  demo: false,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));
vi.mock('@/lib/demoMode', async (orig) => ({ ...(await orig<typeof import('@/lib/demoMode')>()), isDemo: () => h.demo }));
vi.mock('@/lib/plexReveal', () => ({ revealPlexRail: () => undefined, revealPlexTile: () => undefined }));
vi.mock('@/lib/plexUpNext', () => ({ upNextEpisodes: async () => [] }));
vi.mock('@/lib/plexBackdrop', () => ({ focusBackdrop: () => undefined, previewPlex: () => undefined }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexSectionRow: async (_b: string, _t: string, _k: string, q: string) =>
    (q.includes('originallyAvailableAt') ? [{ ratingKey: 'r1', title: 'Released One', type: 'movie', thumb: '/r1' }]
      : q.includes('addedAt:desc') && !q.includes('unwatched') ? [{ ratingKey: 'a1', title: 'Added One', type: 'movie', thumb: '/a1' }]
        : []),
  getPlexSectionOnDeck: async () => [],
  getPlexSectionMeta: h.meta,
  getPlexFilterValues: h.values,
  getPlexLibraryQuery: h.query,
}));
vi.mock('@/lib/plexDemo', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexDemo')>()),
  demoGetSectionRow: async (_b: string, _t: string, _k: string, q: string) =>
    (q.includes('addedAt:desc') ? [{ ratingKey: 'a1', title: 'Added One', type: 'movie', thumb: '/a1' }] : []),
  demoGetSectionOnDeck: async () => [],
}));

const key = (k: string) => { fireEvent.keyDown(window, { key: k }); fireEvent.keyUp(window, { key: k }); };
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const focusedStudio = () => document.querySelector('.plex-studio[data-focused="true"]')?.textContent ?? null;

beforeEach(async () => {
  localStorage.clear();
  h.demo = false;
  h.meta.mockReset();
  h.meta.mockImplementation(async () => ({ totalSize: 10, sorts: [], filters: [{ filter: 'studio', key: '/library/sections/3/studio?listed=1', title: 'Studio' }] }));
  h.values.mockReset();
  h.values.mockImplementation(async (_b: string, _t: string, path: string) => (path.includes('/studio')
    ? [{ key: 'Walt Disney Pictures', title: 'Walt Disney Pictures' }, { key: 'Indie Co', title: 'Indie Co' },
      { key: 'Angel Studios', title: 'Angel Studios' }, { key: 'Disney+', title: 'Disney+' }, { key: 'A24', title: 'A24' }]
    : []));
  h.query.mockReset();
  h.query.mockImplementation(async () => ({ items: [{ ratingKey: 'd1', title: 'A Disney Film', type: 'movie', thumb: '/d1' }], totalSize: 1 }));
  (await import('@/lib/plex')).clearPlexCaches();
});

async function renderRows(libKey: string, sectionType: 'movie' | 'show' = 'movie') {
  const { default: PlexLibraryRows } = await import('./PlexLibraryRows');
  render(
    <div data-plex-scroller="">
      <PlexLibraryRows isActive isCurrent base="http://pms" token="t" libKey={libKey} libTitle="Movies"
        sectionType={sectionType} onOpen={() => undefined} onExitToTabs={() => undefined} />
    </div>,
  );
  await flush(30);
  key('ArrowDown'); // Released → Recently Added: the last row, so wave 2 starts
  await flush(50);
}

describe('PlexLibraryRows — the Studios row', () => {
  it('shows matched studio groups after Recently Added, Angel Studios first, and nothing unmatched', async () => {
    await renderRows('3');
    expect(screen.queryByText('Studios')).not.toBeNull();
    const tiles = Array.from(document.querySelectorAll('.plex-studio')).map((e) => e.textContent);
    expect(tiles).toEqual(['Angel Studios', 'Disney', 'A24']);
    const order = Array.from(document.querySelectorAll('[data-plex-row]')).map((e) => e.getAttribute('data-plex-row'));
    expect(order.indexOf('studios')).toBe(order.indexOf('added') + 1);
    // The list came from the key the server's facts named.
    expect(h.values).toHaveBeenCalledWith('http://pms', 't', '/library/sections/3/studio?listed=1');
  });

  it('Down into it, Right along it, OK filters the library to that studio; Back undoes it', async () => {
    await renderRows('5');
    key('ArrowDown');
    await flush(10);
    expect(focusedStudio()).toBe('Angel Studios');
    key('ArrowRight');
    await flush(10);
    expect(focusedStudio()).toBe('Disney');
    key('Enter');
    await flush(50);
    // The filtered grid: both of Disney's raw values, OR'd.
    expect(h.query).toHaveBeenCalled();
    const q = h.query.mock.calls[0][3] as string;
    expect(q).toContain('studio=Walt%20Disney%20Pictures,Disney%2B');
    expect(document.body.textContent).toMatch(/Studio: Disney/);
    expect(document.querySelector('.plex-studio')).toBeNull();
    key('Escape');
    await flush(30);
    expect(document.body.textContent).not.toMatch(/Studio: Disney/);
    expect(focusedStudio()).toBe('Disney'); // back where it was
  });

  it('a TV library asks for its shows\' studios when the facts name none', async () => {
    h.meta.mockImplementation(async () => ({ totalSize: 10, sorts: [], filters: [] }));
    await renderRows('6', 'show');
    expect(h.values).toHaveBeenCalledWith('http://pms', 't', '/library/sections/6/studio?type=2');
  });

  it('no studio the table knows: no row', async () => {
    h.values.mockImplementation(async () => [{ key: 'Indie Co', title: 'Indie Co' }]);
    await renderRows('7');
    expect(screen.queryByText('Studios')).toBeNull();
  });

  it('the demo: no row, nothing asked, no crash', async () => {
    h.demo = true;
    await renderRows('8');
    expect(document.querySelector('.plex-studio')).toBeNull();
    expect(h.values).not.toHaveBeenCalled();
  });
});
