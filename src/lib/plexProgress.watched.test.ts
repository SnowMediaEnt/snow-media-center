// The watched checks (owner, 2026-10-10: "Can we double check that all
// movies and episodes watched gets a check mark and then entire seasons as
// well please"): a film or an episode watched to the end keeps its check, a
// season is checked when every episode in it is, and none of it goes when the
// resume points' 400-title cap drops old titles.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthCb = (event: string, session: { user: { id: string } } | null) => void;
let authCb: AuthCb | null = null;
// The account's rows: the resume points' read gets `progressRows`, the
// one-time read of every finished title (its JSON-path columns) `markRows`.
const progressRows: Array<{ item_key: string; payload: unknown; watched_at: string }> = [];
const markRows: Array<{ item_key: string; done?: unknown; show?: unknown; season?: unknown }> = [];
const markReads: string[] = [];
let marksFail = false;
vi.mock('@/integrations/supabase/client', () => {
  const read = () => {
    let cols = '';
    const q: Record<string, unknown> = {};
    let span: [number, number] | null = null;
    for (const k of ['eq', 'like', 'not', 'order', 'limit']) q[k] = () => q;
    q.range = (from: number, to: number) => { span = [from, to]; return q; };
    q.select = (c: string) => { cols = c; return q; };
    q.then = (ok: (v: unknown) => unknown) => {
      const marksRead = cols.includes('payload->done');
      if (marksRead) markReads.push(cols);
      if (marksRead && marksFail) return Promise.resolve({ data: null, error: { message: 'offline' } }).then(ok);
      const rows = marksRead ? markRows.slice(span ? span[0] : 0, span ? span[1] + 1 : undefined) : progressRows.slice();
      return Promise.resolve({ data: rows, error: null }).then(ok);
    };
    return q;
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: (cb: AuthCb) => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      },
      from: () => ({ ...read(), upsert: () => Promise.resolve({ error: null }) }),
    },
  };
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const ticks = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const stored = (viewer: string): string[] | null => JSON.parse(localStorage.getItem(`snow-plex-watched:${viewer}`) || 'null');

/** plexProgress and viewer.ts as a fresh start of the app: nobody signed in. */
const fresh = async () => {
  vi.resetModules();
  const m = await import('./plexProgress');
  await (await import('./viewer')).resolveViewer();
  return m;
};

const DUR = 1800;
type M = Awaited<ReturnType<typeof fresh>>;
/** Played to its credits and closed: the final save, as the player closes. */
const finish = async (m: M, ratingKey: string, extra: Record<string, unknown> = {}) => {
  m.saveProgress({ ratingKey, kind: 'movie', title: ratingKey, at: DUR - 30, dur: DUR, ...extra }, true);
  await tick();
};
const finishEpisode = (m: M, show: string, season: number, index: number) =>
  finish(m, `${show}-${season}-${index}`, { kind: 'episode', showKey: show, showTitle: show, season, index });

beforeEach(() => {
  localStorage.clear();
  progressRows.length = 0;
  markRows.length = 0;
  markReads.length = 0;
  marksFail = false;
  authCb = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('watched checks: films and episodes', () => {
  it('a film watched to the end is checked, and stays checked when it is started again', async () => {
    const m = await fresh();
    await finish(m, 'm1');
    expect(m.isTitleWatched('m1')).toBe(true);
    expect(m.plexItemWatched({ ratingKey: 'm1', type: 'movie' })).toBe(true);
    // A second time through: a place to resume from again, and still checked.
    m.saveProgress({ ratingKey: 'm1', kind: 'movie', title: 'm1', at: 600, dur: DUR });
    await tick();
    expect(m.resumeSeconds('m1')).toBe(600);
    expect(m.isTitleWatched('m1')).toBe(true);
    expect(stored('device')).toEqual(['m1']);
  });

  it('two readings at the end mark it; one odd reading does not mark it for good', async () => {
    const m = await fresh();
    // The last title's playhead read under the next one, then the real one.
    m.saveProgress({ ratingKey: 'e2', kind: 'episode', title: 'Next', at: DUR - 20, dur: DUR, showKey: 's1', season: 1, index: 2 });
    await tick();
    m.saveProgress({ ratingKey: 'e2', kind: 'episode', title: 'Next', at: 20, dur: DUR, showKey: 's1', season: 1, index: 2 });
    await tick();
    expect(m.isTitleWatched('e2')).toBe(false);
    // Watched into the credits: two beats there.
    m.saveProgress({ ratingKey: 'e3', kind: 'episode', title: 'Ep 3', at: DUR - 50, dur: DUR, showKey: 's1', season: 1, index: 3 });
    await tick();
    m.saveProgress({ ratingKey: 'e3', kind: 'episode', title: 'Ep 3', at: DUR - 35, dur: DUR, showKey: 's1', season: 1, index: 3 });
    await tick();
    expect(stored('device')).toEqual(['e3|s1|1']);
  });

  it('Up Next taken at the credits: the episode is watched, though its last reading is short of the done line', async () => {
    const m = await fresh();
    // A 24-minute episode whose credits start at 21:30; Up Next went at 21:40.
    m.noteEpisodeFinishing('a1');
    m.saveProgress({ ratingKey: 'a1', kind: 'episode', title: 'A1', at: 1300, dur: 1440, showKey: 'an', season: 1, index: 1 }, true);
    await tick();
    expect(m.isTitleWatched('a1')).toBe(true);
    expect(m.watchedEpisodeCount('an', 1)).toBe(1);
    // Stopped there without Up Next: not watched.
    m.saveProgress({ ratingKey: 'a2', kind: 'episode', title: 'A2', at: 1300, dur: 1440, showKey: 'an', season: 1, index: 2 }, true);
    await tick();
    expect(m.isTitleWatched('a2')).toBe(false);
    // A note with no closing save soon after is stale.
    const now = Date.now();
    m.noteEpisodeFinishing('a3');
    vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
    m.saveProgress({ ratingKey: 'a3', kind: 'episode', title: 'A3', at: 300, dur: 1440, showKey: 'an', season: 1, index: 3 }, true);
    await tick();
    expect(m.isTitleWatched('a3')).toBe(false);
    vi.restoreAllMocks();
  });

  it('more checks than the season has episodes (some no longer on the server): no check', async () => {
    const m = await fresh();
    for (let i = 1; i <= 4; i++) await finishEpisode(m, 'daily', 2026, i);
    expect(m.plexSeasonWatched('daily', { index: 2026, leafCount: 3 })).toBe(false);
    expect(m.plexItemWatched({ ratingKey: 'daily', type: 'show', leafCount: 3 })).toBe(false);
    expect(m.plexSeasonWatched('daily', { index: 2026, leafCount: 4 })).toBe(true);
    expect(m.plexItemWatched({ ratingKey: 'daily', type: 'show', leafCount: 4 })).toBe(true);
  });

  it('the resume points become checks once per viewer, not on every open', async () => {
    const m = await fresh();
    m.plexWatchedVersion(); // the first read: nothing finished, the list stored empty
    expect(stored('device')).toEqual([]);
    // A single odd reading left in a resume point later.
    localStorage.setItem('snow-plex-progress:device', JSON.stringify({
      x1: { ratingKey: 'x1', kind: 'movie', title: 'X', at: 1790, dur: DUR, t: 1, done: true },
    }));
    const again = await fresh();
    again.plexWatchedVersion();
    expect(stored('device')).toEqual([]);
  });

  it('an episode first saved without its show gets it when a later save knows it', async () => {
    const m = await fresh();
    await finish(m, 'e1', { kind: 'episode' });
    expect(m.watchedEpisodeCount('s1')).toBe(0);
    await finish(m, 'e1', { kind: 'episode', showKey: 's1', season: 2, index: 1 });
    expect(m.watchedEpisodeCount('s1')).toBe(1);
    expect(m.watchedEpisodeCount('s1', 2)).toBe(1);
    expect(stored('device')).toEqual(['e1|s1|2']);
  });

  it('tells the lists once per change, and not on the beats in between', async () => {
    const m = await fresh();
    const heard = vi.fn();
    window.addEventListener(m.PLEX_WATCHED_EVENT, heard);
    try {
      const v0 = m.plexWatchedVersion();
      await finish(m, 'm1');
      await tick();
      expect(heard).toHaveBeenCalledTimes(1);
      expect(m.plexWatchedVersion()).toBeGreaterThan(v0);
      const v1 = m.plexWatchedVersion();
      await finish(m, 'm1');
      await tick();
      expect(heard).toHaveBeenCalledTimes(1);
      expect(m.plexWatchedVersion()).toBe(v1);
    } finally { window.removeEventListener(m.PLEX_WATCHED_EVENT, heard); }
  });

  it('a box updated to this version keeps the ticks its resume points had', async () => {
    localStorage.setItem('snow-plex-progress:device', JSON.stringify({
      e1: { ratingKey: 'e1', kind: 'episode', title: 'E', at: 1790, dur: DUR, t: 1, done: true, showKey: 's1', season: 1 },
      m2: { ratingKey: 'm2', kind: 'movie', title: 'F', at: 600, dur: DUR, t: 2, done: false },
    }));
    const m = await fresh();
    expect(m.isTitleWatched('e1')).toBe(true);
    expect(m.isTitleWatched('m2')).toBe(false);
    expect(m.watchedEpisodeCount('s1', 1)).toBe(1);
    expect(stored('device')).toEqual(['e1|s1|1']);
  });
});

describe('watched checks: seasons and shows', () => {
  it('a season is checked when every episode in it is, counted against its episode count', async () => {
    const m = await fresh();
    await finishEpisode(m, 's1', 1, 1);
    await finishEpisode(m, 's1', 1, 2);
    await finishEpisode(m, 's1', 2, 1);
    expect(m.plexSeasonWatched('s1', { index: 1, leafCount: 2 })).toBe(true);
    expect(m.plexSeasonWatched('s1', { index: 2, leafCount: 2 })).toBe(false);
    // A new episode added to the season: no longer all watched.
    expect(m.plexSeasonWatched('s1', { index: 1, leafCount: 3 })).toBe(false);
    // Unknown count, or another show's season of the same number.
    expect(m.plexSeasonWatched('s1', { index: 1 })).toBe(false);
    expect(m.plexSeasonWatched('s2', { index: 1, leafCount: 2 })).toBe(false);
    // Specials are season 0.
    await finishEpisode(m, 's1', 0, 1);
    expect(m.plexSeasonWatched('s1', { index: 0, leafCount: 1 })).toBe(true);
    // The show: every episode (its leafCount, Specials included).
    expect(m.plexItemWatched({ ratingKey: 's1', type: 'show', leafCount: 4 })).toBe(true);
    expect(m.plexItemWatched({ ratingKey: 's1', type: 'show', leafCount: 5 })).toBe(false);
    expect(m.plexItemWatched({ ratingKey: 's1', type: 'show' })).toBe(false);
  });

  it('ten seasons of 22 episodes, then 250 films: the resume points keep 400, every check stays', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let now = Date.UTC(2026, 9, 1);
    const m = await fresh();
    for (let s = 1; s <= 10; s++) {
      for (let e = 1; e <= 22; e++) { vi.setSystemTime(now += 60_000); await finishEpisode(m, 'show', s, e); }
    }
    for (let i = 1; i <= 250; i++) { vi.setSystemTime(now += 60_000); await finish(m, `film${i}`); }
    expect(m.progressCount()).toBe(400);
    // The first season's episodes are no longer resume points …
    expect(m.getProgress('show-1-1')).toBeNull();
    expect(m.isWatched('show-1-1')).toBe(false);
    // … but still checked, and so is their season and the show.
    expect(m.isTitleWatched('show-1-1')).toBe(true);
    for (let s = 1; s <= 10; s++) expect(m.plexSeasonWatched('show', { index: s, leafCount: 22 })).toBe(true);
    expect(m.plexItemWatched({ ratingKey: 'show', type: 'show', leafCount: 220 })).toBe(true);
    expect(stored('device')).toHaveLength(470);
    // And after a restart of the app.
    const again = await fresh();
    expect(again.plexSeasonWatched('show', { index: 1, leafCount: 22 })).toBe(true);
  });

  it('keeps at most 3000 checks: the oldest go first', async () => {
    localStorage.setItem('snow-plex-watched:device', JSON.stringify(Array.from({ length: 3000 }, (_, i) => `m${i}`)));
    const m = await fresh();
    expect(m.isTitleWatched('m0')).toBe(true);
    await finish(m, 'new');
    expect(m.isTitleWatched('new')).toBe(true);
    expect(m.isTitleWatched('m0')).toBe(false);
    expect(m.isTitleWatched('m1')).toBe(true);
    const list = stored('device')!;
    expect(list).toHaveLength(3000);
    expect(list[0]).toBe('m1');
    expect(list[2999]).toBe('new');
  });
});

describe('watched checks: viewers, the account and the server', () => {
  it('belong to the viewer: another viewer has their own, and signing in brings the box\'s over', async () => {
    const m = await fresh();
    await finishEpisode(m, 's1', 1, 1);
    expect(stored('device')).toEqual(['s1-1-1|s1|1']);
    authCb!('SIGNED_IN', { user: { id: 'u1' } });
    await ticks();
    expect(m.isTitleWatched('s1-1-1')).toBe(true);
    expect(m.plexSeasonWatched('s1', { index: 1, leafCount: 1 })).toBe(true);
    expect(stored('u1')).toEqual(['s1-1-1|s1|1']);
    expect(stored('device')).toBeNull();
    // Signed out, the box starts again from nothing.
    authCb!('SIGNED_OUT', null);
    expect(m.isTitleWatched('s1-1-1')).toBe(false);
  });

  it('finished on another box: checked from the account, even where this box\'s own place is newer', async () => {
    const m = await fresh();
    m.__resetPlexProgressForTests('u1');
    m.saveProgress({ ratingKey: 'e1', kind: 'episode', title: 'E', at: 600, dur: DUR, showKey: 's1', season: 1 });
    await tick();
    progressRows.push({
      item_key: 'e1', watched_at: new Date(Date.now() - 3_600_000).toISOString(),
      payload: { ratingKey: 'e1', kind: 'episode', title: 'E', at: 1790, dur: DUR, t: 1, done: true, showKey: 's1', season: 1 },
    });
    expect(await m.pullProgressFromCloud()).toBe(true);
    expect(m.resumeSeconds('e1')).toBe(600);
    expect(m.isTitleWatched('e1')).toBe(true);
    expect(m.watchedEpisodeCount('s1', 1)).toBe(1);
  });

  it('a box new to the account reads every finished title once, not only the newest 400', async () => {
    const m = await fresh();
    m.__resetPlexProgressForTests('u1');
    markRows.push(
      { item_key: 'old-ep', done: true, show: 's9', season: 3 },
      { item_key: 'old-film', done: true, show: null, season: null },
      // Not finished, or another profile's: not checked.
      { item_key: 'half', done: false },
      { item_key: 'p:kid:ep', done: true, show: 's9', season: 3 },
    );
    await m.pullProgressFromCloud();
    await ticks();
    expect(markReads).toHaveLength(1);
    expect(m.isTitleWatched('old-ep')).toBe(true);
    expect(m.isTitleWatched('old-film')).toBe(true);
    expect(m.isTitleWatched('half')).toBe(false);
    expect(m.isTitleWatched('ep')).toBe(false);
    expect(m.watchedEpisodeCount('s9', 3)).toBe(1);
    // Once per viewer per start.
    await m.pullProgressFromCloud();
    await ticks();
    expect(markReads).toHaveLength(1);
  });

  it('the full read goes page by page (the server hands out 1000 rows an ask)', async () => {
    const m = await fresh();
    m.__resetPlexProgressForTests('u1');
    for (let i = 0; i < 1500; i++) markRows.push({ item_key: `f${i}`, done: true, show: null, season: null });
    await m.pullProgressFromCloud();
    await ticks(10);
    expect(markReads).toHaveLength(2);
    expect(m.isTitleWatched('f0')).toBe(true);
    expect(m.isTitleWatched('f1499')).toBe(true);
  });

  it('a full read that did not get through is tried again on the next Plex open', async () => {
    const m = await fresh();
    m.__resetPlexProgressForTests('u1');
    markRows.push({ item_key: 'old-film', done: true, show: null, season: null });
    marksFail = true;
    await m.pullProgressFromCloud();
    await ticks();
    expect(m.isTitleWatched('old-film')).toBe(false);
    marksFail = false;
    await m.pullProgressFromCloud();
    await ticks();
    expect(markReads).toHaveLength(2);
    expect(m.isTitleWatched('old-film')).toBe(true);
    await m.pullProgressFromCloud();
    await ticks();
    expect(markReads).toHaveLength(2); // got through: once per start
  });

  it('the server\'s plays count only on the viewer\'s own Plex account', async () => {
    const m = await fresh();
    const film = { ratingKey: 'f1', type: 'movie', viewCount: 2 };
    const show = { ratingKey: 's1', type: 'show', leafCount: 10, viewedLeafCount: 10 };
    expect(m.plexItemWatched(film)).toBe(false);
    expect(m.plexItemWatched(show)).toBe(false);
    expect(m.plexSeasonWatched('s1', { index: 1, leafCount: 5, viewedLeafCount: 5 })).toBe(false);
    m.setPlexServerMarks(true);
    expect(m.plexItemWatched(film)).toBe(true);
    expect(m.plexItemWatched(show)).toBe(true);
    expect(m.plexItemWatched({ ...show, viewedLeafCount: 9 })).toBe(false);
    expect(m.plexSeasonWatched('s1', { index: 1, leafCount: 5, viewedLeafCount: 5 })).toBe(true);
    m.setPlexServerMarks(false);
    expect(m.plexItemWatched(film)).toBe(false);
  });
});
