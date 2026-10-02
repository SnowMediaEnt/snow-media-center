// The "progress changed" event re-draws the screens behind the player
// (Continue Watching on Home, the library rows, the detail page). Every 15 s
// beat of a film used to send it, and each re-draw could ask the server for
// On Deck: now only a final save, or a beat that changes what Continue
// Watching shows, sends it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}));

import { PLEX_PROGRESS_EVENT, __resetPlexProgressForTests, continueWatching, saveProgress } from './plexProgress';

const settle = () => new Promise((r) => setTimeout(r, 5));
let events = 0;
const count = () => { events += 1; };
const beat = async (p: Parameters<typeof saveProgress>[0], final = false) => { saveProgress(p, final); await settle(); };
const film = (at: number) => ({ ratingKey: 'm1', kind: 'movie' as const, title: 'Film', at, dur: 6000 });

beforeEach(async () => {
  localStorage.clear();
  __resetPlexProgressForTests('device');
  await settle();
  events = 0;
  window.addEventListener(PLEX_PROGRESS_EVENT, count);
});
afterEach(() => { window.removeEventListener(PLEX_PROGRESS_EVENT, count); });

describe('PLEX_PROGRESS_EVENT', () => {
  it('says nothing for beats that change nothing Continue Watching shows', async () => {
    // The first minute: not a place to resume, so not in the row.
    await beat(film(15));
    await beat(film(30));
    expect(events).toBe(0);
    // Past it: the film joins the row — once.
    await beat(film(75));
    expect(events).toBe(1);
    expect(continueWatching().map((i) => i.ratingKey)).toEqual(['m1']);
    // Further beats only move its progress bar.
    await beat(film(90));
    await beat(film(105));
    await beat(film(120));
    expect(events).toBe(1);
  });

  it('a final save always says so (the bar and the account copy are current)', async () => {
    await beat(film(600));
    expect(events).toBe(1);
    await beat(film(615), true);
    expect(events).toBe(2);
  });

  it('a title watched to the end leaves the row: that is a change', async () => {
    await beat(film(3000));
    events = 0;
    await beat(film(5700));
    expect(events).toBe(1);
    expect(continueWatching()).toEqual([]);
  });

  it('the next episode taking its show\'s place, and a finished show\'s "next episode", are changes', async () => {
    const ep = (ratingKey: string, index: number, at: number) =>
      ({ ratingKey, kind: 'episode' as const, title: `Ep ${index}`, at, dur: 1800, showKey: 's1', showTitle: 'Show', season: 1, index });
    await beat(ep('e1', 1, 600));
    expect(events).toBe(1);
    // Watched to the end: it leaves the row and its show is now "finished".
    await beat(ep('e1', 1, 1790));
    expect(events).toBe(2);
    // Autoplay's next episode, inside its first minute: nothing to show yet.
    await beat(ep('e2', 2, 20));
    expect(events).toBe(2);
    // Past it, the show's place moves to it.
    await beat(ep('e2', 2, 70));
    expect(events).toBe(3);
  });
});
