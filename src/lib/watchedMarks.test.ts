// Watched marks for the line's films and shows (owner, 2026-10-10: "Can we
// double check that all movies and episodes watched gets a check mark and
// then entire seasons as well please"). Ported from Tronix 416bb91c's
// watchedMarks.test.ts, with films, the bar's tenths, viewers and the
// sign-in carry-over added.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BEGUN_S, WATCHED_EVENT, carryBoxMarks, clearWatchedMarks, episodeMark, episodePart, filmKey, noteEpisodeFinished,
  noteEpisodeProgress, noteFilmFinished, noteFilmProgress, readWatchedFilms, readWatchedMarks, seasonWatched, showKey,
} from './watchedMarks';
import { watchedFilmsOn, watchedShowsOn } from '@/hooks/useWatchedVod';
import { __setViewerForTests, setViewerProfile } from '@/lib/viewer';

const LINE = { host: 'http://panel.test:8080', username: 'Viewer1' };
const OTHER = { host: 'http://other.test', username: 'someone' };
const E1 = { id: '1001', season: 1, num: '1' };
const E2 = { id: '1002', season: 1, num: '2' };

beforeEach(() => { localStorage.clear(); __setViewerForTests('device'); });
afterEach(() => { vi.restoreAllMocks(); __setViewerForTests('device'); });

describe('watched marks: shows and episodes', () => {
  it('a show is watched once a minute of an episode has played, the episode finished at 95%', () => {
    noteEpisodeProgress(LINE, 77, E1, 20, 2400);
    expect(readWatchedMarks()).toEqual({}); // 20 s: not yet
    noteEpisodeProgress(LINE, 77, E1, BEGUN_S, 2400);
    const show = readWatchedMarks()[showKey(LINE, 77)];
    expect(episodeMark(show, E1.id)).toBe(1);
    expect(show.last).toEqual(E1);
    noteEpisodeProgress(LINE, 77, E1, 2300, 2400);
    expect(episodeMark(readWatchedMarks()[showKey(LINE, 77)], E1.id)).toBe(2);
  });

  it('a finished episode stays finished when it is played again from the start', () => {
    noteEpisodeFinished(LINE, 77, E1);
    noteEpisodeProgress(LINE, 77, E2, 90, 2400);
    noteEpisodeProgress(LINE, 77, E1, 90, 2400); // rewatching E1
    const show = readWatchedMarks()[showKey(LINE, 77)];
    expect(episodeMark(show, E1.id)).toBe(2);
    expect(episodeMark(show, E2.id)).toBe(1);
    expect(show.last?.id).toBe(E1.id); // the episode watched last
  });

  it('writes only when something changes (the player reports every few seconds)', () => {
    const changed = vi.fn();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    window.addEventListener(WATCHED_EVENT, changed);
    noteEpisodeProgress(LINE, 77, E1, 61, 2400);
    noteEpisodeProgress(LINE, 77, E1, 75, 2400);
    noteEpisodeProgress(LINE, 77, E1, 90, 2400);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledTimes(1);
    window.removeEventListener(WATCHED_EVENT, changed);
  });

  it("a begun episode's bar goes up in tenths, never back on a rewind, and goes once it is watched", () => {
    const changed = vi.fn();
    window.addEventListener(WATCHED_EVENT, changed);
    const show = () => readWatchedMarks()[showKey(LINE, 77)];
    noteEpisodeProgress(LINE, 77, E1, 600, 2400);
    expect(episodePart(show(), E1.id)).toBe(0.2);
    noteEpisodeProgress(LINE, 77, E1, 650, 2400); // the same tenth: nothing written
    noteEpisodeProgress(LINE, 77, E1, 1300, 2400);
    expect(episodePart(show(), E1.id)).toBe(0.5);
    noteEpisodeProgress(LINE, 77, E1, 300, 2400); // back to 5:00
    expect(episodePart(show(), E1.id)).toBe(0.5);
    expect(changed).toHaveBeenCalledTimes(2);
    noteEpisodeFinished(LINE, 77, E1);
    expect(episodePart(show(), E1.id)).toBe(0);
    expect(show().part).toBeUndefined();
    window.removeEventListener(WATCHED_EVENT, changed);
  });

  it('a very short episode: half of it counts as begun', () => {
    noteEpisodeProgress(LINE, 5, E1, 25, 40);
    expect(episodeMark(readWatchedMarks()[showKey(LINE, 5)], E1.id)).toBe(1);
  });

  it('a length not known: begun after a minute, watched only at its end', () => {
    noteEpisodeProgress(LINE, 6, E1, 5000, 0);
    expect(episodeMark(readWatchedMarks()[showKey(LINE, 6)], E1.id)).toBe(1);
    noteEpisodeFinished(LINE, 6, E1);
    expect(episodeMark(readWatchedMarks()[showKey(LINE, 6)], E1.id)).toBe(2);
  });

  it('a season is watched when every episode of it was watched to the end', () => {
    noteEpisodeFinished(LINE, 77, E1);
    const show = () => readWatchedMarks()[showKey(LINE, 77)];
    expect(seasonWatched(show(), [E1.id, E2.id])).toBe(false);
    noteEpisodeFinished(LINE, 77, E2);
    expect(seasonWatched(show(), [E1.id, E2.id])).toBe(true);
    expect(seasonWatched(show(), [])).toBe(false);
  });

  it('per line: another line on the box has its own shows', () => {
    noteEpisodeFinished(LINE, 77, E1);
    expect(watchedShowsOn(LINE).has(77)).toBe(true);
    expect(watchedShowsOn(OTHER).has(77)).toBe(false);
  });

  it('a show with very many episodes: the one just marked is never the one dropped', () => {
    for (let i = 0; i < 400; i++) noteEpisodeFinished(LINE, 7, { id: String(5000 + i), season: 9, num: String(i + 1) });
    noteEpisodeProgress(LINE, 7, { id: '100', season: 1, num: '1' }, 120, 2400); // season 1 again
    const show = readWatchedMarks()[showKey(LINE, 7)];
    expect(episodeMark(show, '100')).toBe(1);
    expect(Object.keys(show.eps).length).toBe(400);
    expect(episodeMark(show, '5000')).toBe(0); // the lowest other id went
  });

  it('past 500 shows the one played longest ago goes', () => {
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < 501; i++) { now.mockReturnValue(1_000 + i); noteEpisodeFinished(LINE, 10_000 + i, E1); }
    const all = readWatchedMarks();
    expect(Object.keys(all)).toHaveLength(500);
    expect(all[showKey(LINE, 10_000)]).toBeUndefined();
    expect(all[showKey(LINE, 10_500)]).toBeTruthy();
  });
});

describe('watched marks: films', () => {
  it('begun after a minute, watched at 95% or its end; only watched ones are marked on the line', () => {
    noteFilmProgress(LINE, 42, 30, 6000);
    expect(readWatchedFilms()).toEqual({});
    noteFilmProgress(LINE, 42, 61, 6000);
    expect(readWatchedFilms()[filmKey(LINE, 42)]?.s).toBe(1);
    expect(watchedFilmsOn(LINE).has(42)).toBe(false); // begun is not watched
    noteFilmProgress(LINE, 42, 5800, 6000);
    expect(watchedFilmsOn(LINE).has(42)).toBe(true);
    noteFilmFinished(LINE, 43);
    expect([...watchedFilmsOn(LINE)].sort()).toEqual([42, 43]);
    expect(watchedFilmsOn(OTHER).size).toBe(0);
  });

  it('a film watched stays watched when it is played again; nothing is written for it', () => {
    noteFilmFinished(LINE, 42);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    noteFilmProgress(LINE, 42, 90, 6000);
    noteFilmFinished(LINE, 42);
    expect(setItem).not.toHaveBeenCalled();
    expect(readWatchedFilms()[filmKey(LINE, 42)]?.s).toBe(2);
  });

  it('past the cap the film watched longest ago goes', () => {
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < 801; i++) { now.mockReturnValue(1_000 + i); noteFilmFinished(LINE, i + 1); }
    expect(Object.keys(readWatchedFilms())).toHaveLength(800);
    expect(watchedFilmsOn(LINE).has(1)).toBe(false);
    expect(watchedFilmsOn(LINE).has(801)).toBe(true);
  });
});

describe('watched marks: whose', () => {
  it('per viewer: another account or profile (a Kids profile) has its own', () => {
    noteFilmFinished(LINE, 42);
    noteEpisodeFinished(LINE, 77, E1);
    __setViewerForTests('acc-1:p:kids01');
    expect(watchedFilmsOn(LINE).size).toBe(0);
    expect(watchedShowsOn(LINE).size).toBe(0);
    __setViewerForTests('device');
    expect(watchedFilmsOn(LINE).has(42)).toBe(true);
  });

  it('a profile switch tells the screens to read again', () => {
    const changed = vi.fn();
    window.addEventListener(WATCHED_EVENT, changed);
    setViewerProfile('kids01');
    expect(changed).toHaveBeenCalled();
    setViewerProfile('main');
    window.removeEventListener(WATCHED_EVENT, changed);
  });

  it("signing in brings the box's marks to the account's (the more watched wins) and off the box", () => {
    noteFilmFinished(LINE, 42);
    noteEpisodeFinished(LINE, 77, E1);
    noteEpisodeProgress(LINE, 77, E2, 600, 2400);
    __setViewerForTests('acc-1');
    noteEpisodeFinished(LINE, 77, E2); // watched on the account already
    noteFilmProgress(LINE, 43, 120, 6000);
    expect(carryBoxMarks()).toBe(true);
    const show = watchedShowsOn(LINE).get(77);
    expect(episodeMark(show, E1.id)).toBe(2);
    expect(episodeMark(show, E2.id)).toBe(2);
    expect(watchedFilmsOn(LINE).has(42)).toBe(true);
    expect(readWatchedFilms()[filmKey(LINE, 43)]?.s).toBe(1);
    expect(localStorage.getItem('snow-watched-v1:device')).toBeNull();
    expect(localStorage.getItem('snow-watched-films-v1:device')).toBeNull();
    expect(carryBoxMarks()).toBe(false); // nothing left to bring
  });

  it("another profile on the account takes nothing from the box", () => {
    noteFilmFinished(LINE, 42);
    __setViewerForTests('acc-1:p:kids01');
    expect(carryBoxMarks()).toBe(false);
    expect(watchedFilmsOn(LINE).size).toBe(0);
    expect(localStorage.getItem('snow-watched-films-v1:device')).not.toBeNull();
  });

  it('clearing forgets them', () => {
    noteEpisodeFinished(LINE, 77, E1);
    noteFilmFinished(LINE, 42);
    clearWatchedMarks();
    expect(readWatchedMarks()).toEqual({});
    expect(readWatchedFilms()).toEqual({});
  });

  it('storage cleared behind its back: read again, not from the last read', () => {
    noteFilmFinished(LINE, 42);
    expect(watchedFilmsOn(LINE).has(42)).toBe(true);
    localStorage.clear();
    expect(watchedFilmsOn(LINE).has(42)).toBe(false);
  });
});
