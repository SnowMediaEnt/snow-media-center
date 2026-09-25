// Continue Watching in a library tab is on screen from this box's own saved
// progress at once. The server's half — its On Deck on the viewer's own Plex
// account, the next episodes in a TV library — is folded in when it lands,
// which on a slow box can be a long time or never; and when the row is asked
// again before a slow answer lands, that answer must not put back the older
// list over the newer one.
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlexItem } from '@/lib/plex';

const h = vi.hoisted(() => ({
  upNext: vi.fn(),
  onDeck: vi.fn(),
  row: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));
vi.mock('@/lib/plexReveal', () => ({ revealPlexRail: () => undefined, revealPlexTile: () => undefined }));
vi.mock('@/lib/plexUpNext', () => ({ upNextEpisodes: h.upNext }));
vi.mock('@/lib/plexBackdrop', () => ({ focusBackdrop: () => undefined }));
vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plex', async (orig) => ({
  ...(await orig<typeof import('@/lib/plex')>()),
  getPlexSectionRow: h.row,
  getPlexSectionOnDeck: h.onDeck,
  getPlexSectionMeta: async () => ({ sorts: [], filters: [] }),
}));

const tile = (ratingKey: string, title: string, extra: Partial<PlexItem> = {}): PlexItem => ({ ratingKey, title, type: 'movie', thumb: `/${ratingKey}`, ...extra });
const flush = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const never = () => new Promise<PlexItem[]>(() => undefined);
const deferred = () => {
  let resolve!: (v: PlexItem[]) => void;
  const promise = new Promise<PlexItem[]>((r) => { resolve = r; });
  return { promise, resolve };
};
const continueRow = () => document.querySelector('[data-plex-row="continue"]')?.textContent ?? '';

beforeEach(async () => {
  localStorage.clear();
  h.upNext.mockReset();
  h.upNext.mockImplementation(never);
  h.onDeck.mockReset();
  h.onDeck.mockImplementation(never);
  h.row.mockReset();
  h.row.mockImplementation(async () => [tile('a1', 'Added One')]);
  (await import('@/lib/plex')).clearPlexCaches();
  (await import('@/lib/plexProgress')).__resetPlexProgressForTests('device');
});

async function renderRows(sectionType: 'movie' | 'show', libKey: string, serverResume: boolean) {
  const { default: PlexLibraryRows } = await import('./PlexLibraryRows');
  const el = (nonce: number) => (
    <PlexLibraryRows isActive isCurrent base="http://pms" token="t" libKey={libKey} libTitle="Library"
      sectionType={sectionType} onOpen={() => undefined} onExitToTabs={() => undefined}
      serverResume={serverResume} watchNonce={nonce} />
  );
  const r = render(el(0));
  await flush(20);
  // The player closing: the row is asked for again.
  const playerClosed = async (nonce: number) => { r.rerender(el(nonce)); await flush(20); };
  return { ...r, playerClosed };
}

async function savePartWay(p: Parameters<typeof import('@/lib/plexProgress').saveProgress>[0]) {
  const { saveProgress } = await import('@/lib/plexProgress');
  saveProgress(p);
  await flush(20);
}

describe('PlexLibraryRows — Continue Watching does not wait for the server', () => {
  it('a film stopped part-way shows while the server\'s On Deck has not answered', async () => {
    await savePartWay({ ratingKey: 'm9', kind: 'movie', title: 'Harbor Lights', at: 1500, dur: 6000, librarySectionID: '1' });
    await renderRows('movie', '1', true);
    expect(h.onDeck).toHaveBeenCalled();
    expect(continueRow()).toContain('Harbor Lights');
  });

  it('an episode stopped part-way shows while the next episodes are still being looked up', async () => {
    await savePartWay({ ratingKey: 'e5', kind: 'episode', title: 'Crossing', at: 900, dur: 2940, librarySectionID: '2', showKey: 's1', showTitle: 'Frontier', season: 1, index: 5 });
    await renderRows('show', '2', false);
    expect(h.upNext).toHaveBeenCalled();
    expect(continueRow()).toContain('Frontier');
  });
});

describe('PlexLibraryRows — Continue Watching asked again', () => {
  it('a slower earlier On Deck answer does not replace the newer one', async () => {
    await savePartWay({ ratingKey: 'm9', kind: 'movie', title: 'Harbor Lights', at: 1500, dur: 6000, librarySectionID: '1' });
    const first = deferred();
    const second = deferred();
    h.onDeck.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { playerClosed } = await renderRows('movie', '1', true);
    await playerClosed(1);
    expect(h.onDeck).toHaveBeenCalledTimes(2);

    second.resolve([tile('s2', 'Newer From Server')]);
    await flush(20);
    expect(continueRow()).toContain('Newer From Server');

    first.resolve([tile('s1', 'Older From Server')]);
    await flush(20);
    expect(continueRow()).toContain('Newer From Server');
    expect(continueRow()).not.toContain('Older From Server');
    expect(continueRow()).toContain('Harbor Lights');
    // The cache the next visit paints from holds the newer list too.
    const { getCachedHubStale } = await import('@/lib/plex');
    expect((getCachedHubStale('http://pms', '/library/sections/1/onDeck') ?? []).map((i) => i.ratingKey)).toEqual(['m9', 's2']);
  });

  it('a slower earlier next-episode answer does not replace the newer one', async () => {
    await savePartWay({ ratingKey: 'e5', kind: 'episode', title: 'Crossing', at: 900, dur: 2940, librarySectionID: '2', showKey: 's1', showTitle: 'Frontier', season: 1, index: 5 });
    const first = deferred();
    const second = deferred();
    h.upNext.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const { playerClosed } = await renderRows('show', '2', false);
    await playerClosed(1);
    expect(h.upNext).toHaveBeenCalledTimes(2);

    second.resolve([tile('n2', 'Next', { type: 'episode', grandparentTitle: 'Harvest', parentIndex: 2, index: 1, librarySectionID: '2' })]);
    await flush(20);
    expect(continueRow()).toContain('Harvest');

    first.resolve([tile('n1', 'Old Next', { type: 'episode', grandparentTitle: 'Old Mill', parentIndex: 1, index: 3, librarySectionID: '2' })]);
    await flush(20);
    expect(continueRow()).toContain('Harvest');
    expect(continueRow()).not.toContain('Old Mill');
    expect(continueRow()).toContain('Frontier');
  });

  it('the server\'s titles stay on screen while the row is asked again', async () => {
    h.onDeck.mockImplementationOnce(async () => [tile('s2', 'From Server')]);
    const { playerClosed } = await renderRows('movie', '1', true);
    expect(continueRow()).toContain('From Server');
    // Asked again, and this time the server does not answer: the row it had
    // is kept rather than blanked until it does.
    await playerClosed(1);
    expect(h.onDeck).toHaveBeenCalledTimes(2);
    expect(continueRow()).toContain('From Server');
  });
});
