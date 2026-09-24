import { beforeEach, describe, expect, it, vi } from 'vitest';

let invokes = 0;
let feed: unknown = null;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn(async () => { invokes++; return { data: feed, error: null }; }) } },
}));

const M = 'machine-1';
// As media-bar-feed sends them: the week's most-played carry the mark.
const FEED = {
  items: [
    { ratingKey: '500', kind: 'movie', title: 'Recently added film', subtitle: '2024', machineIdentifier: M, librarySectionID: 1 },
    { ratingKey: '10', kind: 'show', title: 'Frontier', subtitle: 'Popular this week · Series', machineIdentifier: M, librarySectionID: 2 },
    { ratingKey: '20', kind: 'movie', title: 'Harbor Lights', subtitle: 'Popular this week · 2023', machineIdentifier: M, librarySectionID: 1 },
    { ratingKey: '10', kind: 'show', title: 'Frontier', subtitle: 'Popular this week · Series', machineIdentifier: M, librarySectionID: 2 },
    { ratingKey: '30', kind: 'movie', title: 'Hidden library film', subtitle: 'Popular this week · 2020', machineIdentifier: M, librarySectionID: 9 },
    { ratingKey: '40', kind: 'movie', title: 'Other server', subtitle: 'Popular this week', machineIdentifier: 'other', librarySectionID: 1 },
  ],
};

beforeEach(async () => {
  invokes = 0;
  feed = FEED;
  (await import('./plexOthersWatching')).__resetOthersWatchingForTests();
});

describe('What others are watching', () => {
  it("keeps this week's titles on this server and in a library the viewer sees, in the feed's order", async () => {
    const { othersWatchingKeys, fetchFeedItems } = await import('./plexOthersWatching');
    const items = await fetchFeedItems();
    expect(othersWatchingKeys(items, M, new Set(['1', '2']))).toEqual(['10', '20']);
    // Another server's ratingKeys are other titles: nothing.
    expect(othersWatchingKeys(items, 'mine', new Set(['1', '2']))).toEqual([]);
    expect(othersWatchingKeys(items, undefined, new Set(['1', '2']))).toEqual([]);
  });

  it('asks once and keeps the answer half an hour; a failure is not kept', async () => {
    const { fetchFeedItems } = await import('./plexOthersWatching');
    await Promise.all([fetchFeedItems(), fetchFeedItems()]);
    await fetchFeedItems();
    expect(invokes).toBe(1);
    await fetchFeedItems(Date.now() + 31 * 60 * 1000);
    expect(invokes).toBe(2);

    (await import('./plexOthersWatching')).__resetOthersWatchingForTests();
    feed = { items: [], error: 'plex down' };
    expect(await fetchFeedItems()).toBeNull();
    feed = FEED;
    expect((await fetchFeedItems())?.length).toBe(5);
    expect(invokes).toBe(4);
  });
});
