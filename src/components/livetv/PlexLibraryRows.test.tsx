// A library tab in rows mode: the rail the remote moves to is shown whole
// (heading, posters, the focused poster's lift and ring), and Continue
// Watching is filled from this viewer's own progress — in a TV library with
// the next episode of a show whose last episode was finished, too.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem } from '@/lib/plex';

const h = vi.hoisted(() => ({
  reveal: vi.fn(),
  upNext: vi.fn(),
  row: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));
vi.mock('@/lib/plexReveal', () => ({ revealPlexRail: h.reveal }));
vi.mock('@/lib/plexUpNext', () => ({ upNextEpisodes: h.upNext }));
vi.mock('@/lib/plexBackdrop', () => ({ focusBackdrop: () => undefined }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexSectionRow: h.row,
  getPlexSectionOnDeck: async () => [],
  getPlexSectionMeta: async () => ({ sorts: [], filters: [] }),
}));

const tile = (ratingKey: string, title: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey, title, type: 'movie', thumb: `/${ratingKey}`, ...extra });
const key = (k: string) => { fireEvent.keyDown(window, { key: k }); };
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(async () => {
  localStorage.clear();
  h.reveal.mockReset();
  h.upNext.mockReset();
  h.upNext.mockImplementation(async () => []);
  h.row.mockReset();
  h.row.mockImplementation(async (_b: string, _t: string, _k: string, query: string) => {
    if (query.includes('originallyAvailableAt')) return [tile('r1', 'Released One'), tile('r2', 'Released Two')];
    if (query.includes('addedAt:desc') && !query.includes('unwatched')) return [tile('a1', 'Added One')];
    if (query.includes('audienceRating')) return [tile('t1', 'Top One')];
    return [];
  });
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
});

async function renderRows(sectionType: 'movie' | 'show' = 'movie', libKey = '1') {
  const { default: PlexLibraryRows } = await import('./PlexLibraryRows');
  const r = render(
    <div data-plex-scroller="">
      <PlexLibraryRows isActive isCurrent base="http://pms" token="t" libKey={libKey} libTitle="Movies"
        sectionType={sectionType} onOpen={() => undefined} onExitToTabs={() => undefined} />
    </div>,
  );
  await flush(20);
  return r;
}

const lastRevealed = () => {
  const el = h.reveal.mock.calls[h.reveal.mock.calls.length - 1]?.[0] as HTMLElement | null | undefined;
  return el ? (el.getAttribute('data-plex-row') ?? el.className) : null;
};

describe('PlexLibraryRows — moving between rails', () => {
  it('Down and Up show the whole rail the highlight lands on, not just its tile', async () => {
    await renderRows();
    expect(screen.getByText('Recently Released')).toBeTruthy();
    key('ArrowDown');
    await flush();
    expect(lastRevealed()).toBe('added');
    key('ArrowUp');
    await flush();
    // The rail box: its heading and the room above the posters come with it.
    expect(lastRevealed()).toBe('released');
    const box = h.reveal.mock.calls[h.reveal.mock.calls.length - 1][0] as HTMLElement;
    expect(box.querySelector('.plex-rail-head')?.textContent).toBe('Recently Released');
    // Up off the first rail: the chip bar, shown the same way.
    key('ArrowUp');
    await flush();
    expect(lastRevealed()).toContain('plex-bar');
  });
});

describe('PlexLibraryRows — Continue Watching', () => {
  it('a film stopped part-way in this library leads the rows', async () => {
    const { saveProgress } = await import('@/lib/plexProgress');
    saveProgress({ ratingKey: 'm9', kind: 'movie', title: 'Harbor Lights', at: 1500, dur: 6000, librarySectionID: '1' });
    saveProgress({ ratingKey: 'm8', kind: 'movie', title: 'Elsewhere', at: 1500, dur: 6000, librarySectionID: '3' });
    await flush(20);
    await renderRows('movie', '1');
    const row = document.querySelector('[data-plex-row="continue"]');
    expect(row?.textContent).toContain('Harbor Lights');
    expect(row?.textContent).not.toContain('Elsewhere');
    expect(document.querySelectorAll('[data-plex-row]')[0].getAttribute('data-plex-row')).toBe('continue');
  });

  it('fills in when progress is saved while the tab is open (the player closing over it)', async () => {
    await renderRows('movie', '1');
    expect(document.querySelector('[data-plex-row="continue"]')).toBeNull();
    const { saveProgress } = await import('@/lib/plexProgress');
    saveProgress({ ratingKey: 'm9', kind: 'movie', title: 'Harbor Lights', at: 1500, dur: 6000, librarySectionID: '1' }, true);
    await flush(20);
    expect(document.querySelector('[data-plex-row="continue"]')?.textContent).toContain('Harbor Lights');
  });

  it('a TV library shows the next episode of a show whose last episode was finished', async () => {
    const { saveProgress } = await import('@/lib/plexProgress');
    saveProgress({ ratingKey: 'e1', kind: 'episode', title: 'Pilot', at: 2900, dur: 2940, librarySectionID: '2', showKey: 's1', showTitle: 'Frontier', season: 1, index: 1 });
    await flush(20);
    h.upNext.mockImplementation(async () => [
      tile('e2', 'Second', { type: 'episode', grandparentTitle: 'Frontier', parentIndex: 1, index: 2, librarySectionID: '2', lastViewedAt: Date.now() }),
      tile('x2', 'Other Library', { type: 'episode', grandparentTitle: 'Kids Show', librarySectionID: '5', lastViewedAt: Date.now() }),
    ]);
    await renderRows('show', '2');
    const row = document.querySelector('[data-plex-row="continue"]');
    expect(row?.textContent).toContain('Frontier');
    expect(row?.textContent).toContain('S1 E2');
    expect(row?.textContent).not.toContain('Kids Show');
  });
});
