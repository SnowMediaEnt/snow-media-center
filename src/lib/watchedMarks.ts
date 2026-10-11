// Films and shows the viewer has watched on a line, and which episodes
// (owner, 2026-10-10: "Can we double check that all movies and episodes
// watched gets a check mark and then entire seasons as well please"). Movies
// marks a film watched to the end, on its poster and its page; TV Shows marks
// a show on its poster (a check once every episode it had was watched, else
// the episode watched last after the year), on its page each episode watched
// (a check) or begun (a bar as far as it got), and a season whose every
// episode was watched. Ported from Tronix 416bb91c, films added.
//
// The player reports where it is about every 10 s (VodPlayer's onProgress):
// an episode is begun after a minute (half of a very short one), and a title
// is watched at 92% or its last minute, as Plex's are (plexProgress): a
// viewer who stops at the credits has watched it. Written only when something
// changes: the reports come often, and a write to a Fire TV's storage is not
// free.
//
// Kept on the box per viewer (viewer.ts: the signed-in account or the box,
// and the profile on it, so a Kids profile has its own), and by line inside
// that (favoritesSync's lineKey: one customer can have a DreamStreams and a
// Vibez line). Signing in brings the box's own marks over to the account's, as
// Plex's resume points do; a profile deleted, or brought from the box to the
// account, takes its marks along (profiles.ts handles every key ending in the
// profile's id). Nothing here is on the playback path: every storage failure
// is swallowed.
import type { XtreamCreds } from '@/lib/xtream';
import { lineKey } from '@/lib/favoritesSync';
import { deviceKeyToCarry, onViewerChange, resolveViewer, viewerKey } from '@/lib/viewer';

type Line = Pick<XtreamCreds, 'host' | 'username'>;

export interface WatchedEpisodeRef {
  id: string;
  season?: number;
  /** The episode's number in its season, as the panel gives it. */
  num?: string;
}

export interface ShowMark {
  /** When an episode of it last changed state (ms). */
  at: number;
  /** The episode watched last. */
  last?: WatchedEpisodeRef;
  /** Its episodes, by id: begun (1) or watched to the end (2). */
  eps: Record<string, 1 | 2>;
  /** How far a begun episode got, in tenths (1-9), for the bar under it.
   *  Only ever goes up, so a rewind writes nothing. */
  part?: Record<string, number>;
  /** How many episodes the show had when its page was last open: with every
   *  one of them watched, its poster gets the check. */
  n?: number;
}

export interface FilmMark {
  /** When it was watched (ms). */
  at: number;
  /** Watched to the end (2). Only those are kept: a film begun shows
   *  nothing, and kept it would push watched ones out of MAX_FILMS. */
  s: 1 | 2;
}

export const WATCHED_EVENT = 'snow:watched-changed';
const SHOWS_PREFIX = 'snow-watched-v1:';
const FILMS_PREFIX = 'snow-watched-films-v1:';
const MAX_SHOWS = 500;
const MAX_EPISODES = 400;
/** About two years of a film a night; one entry is some 60 bytes. */
const MAX_FILMS = 800;
/** A minute of an episode (half of a very short one) counts as watching it. */
export const BEGUN_S = 60;
/** As Plex's (plexProgress DONE_SHARE and EDGE_S): past 92% of the running
 *  time, or into its last minute, a title was watched; the credits are not
 *  worth sitting through. */
const DONE_FRACTION = 0.92;
const DONE_LAST_S = 60;
/** An "ended" from the player this far short of where the title was last
 *  seen to end is a stream cut short (a server that stops sending), not the
 *  title watched. */
const ENDED_SHORT_FRACTION = 0.8;

type Shows = Record<string, ShowMark>;
type Films = Record<string, FilmMark>;

// Ids as numbers: a panel that sends "123" must find the same entry as 123.
export const showKey = (line: Line, seriesId: number | string): string => `${lineKey(line)}|${Number(seriesId)}`;
export const filmKey = (line: Line, streamId: number | string): string => `${lineKey(line)}|${Number(streamId)}`;

// The last read of each list, kept with the text it came from: a list is read
// on every report while a title plays and by every screen that marks posters,
// and parsing it again is only needed when the stored text changed (a write
// here, another profile's key, a cleared storage).
type Slot = { key: string; raw: string | null; val: Record<string, unknown> };
const slots: Record<'shows' | 'films', Slot | null> = { shows: null, films: null };

function readList<T>(which: 'shows' | 'films', key: string): Record<string, T> {
  let raw: string | null = null;
  try { raw = localStorage.getItem(key); } catch { return {}; }
  const s = slots[which];
  if (s && s.key === key && s.raw === raw) return s.val as Record<string, T>;
  let val: Record<string, unknown> = {};
  try {
    const o = JSON.parse(raw || '{}');
    if (o && typeof o === 'object' && !Array.isArray(o)) val = o;
  } catch { /* unreadable: none */ }
  slots[which] = { key, raw, val };
  return val as Record<string, T>;
}

const changed = (): void => {
  try { window.dispatchEvent(new CustomEvent(WATCHED_EVENT)); } catch { /* ignore */ }
};

/** False when storage would not take it (full or blocked: the marks just
 *  don't stick). */
function writeList(which: 'shows' | 'films', key: string, val: Record<string, unknown>): boolean {
  const raw = JSON.stringify(val);
  try { localStorage.setItem(key, raw); } catch { return false; }
  slots[which] = { key, raw, val };
  return true;
}

const showsKey = (viewer = viewerKey()): string => `${SHOWS_PREFIX}${viewer}`;
const filmsKey = (viewer = viewerKey()): string => `${FILMS_PREFIX}${viewer}`;

/** This viewer's shows, every line. Read only: copy before changing. */
export const readWatchedMarks = (): Shows => readList<ShowMark>('shows', showsKey());
/** This viewer's films, every line. Read only: copy before changing. */
export const readWatchedFilms = (): Films => readList<FilmMark>('films', filmsKey());

/** The oldest go first past `max` (by `at`). */
function capByAge<T extends { at: number }>(all: Record<string, T>, max: number): void {
  const keys = Object.keys(all);
  if (keys.length <= max) return;
  keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - max).forEach((old) => { delete all[old]; });
}

/** Mark an episode begun (1, `tenth` how far) or finished (2). Written only
 *  when something changes. */
function markEpisode(line: Line, seriesId: number | string, ep: WatchedEpisodeRef, state: 1 | 2, tenth = 0): void {
  if (!ep.id || !Number.isFinite(Number(seriesId))) return;
  const k = showKey(line, seriesId);
  const prev: ShowMark | undefined = readWatchedMarks()[k];
  const had = prev?.eps?.[ep.id] ?? 0;
  const next = (had > state ? had : state) as 1 | 2;
  const hadPart = prev?.part?.[ep.id] ?? 0;
  const part = next === 1 && tenth > hadPart ? tenth : 0;
  if (prev && had >= state && prev.last?.id === ep.id && !part) return;
  const eps: Record<string, 1 | 2> = { ...(prev?.eps ?? {}) };
  eps[ep.id] = next;
  const parts: Record<string, number> = { ...(prev?.part ?? {}) };
  if (next === 2) delete parts[ep.id];
  else if (part) parts[ep.id] = part;
  // A show with very many: the lowest episode ids (usually its oldest
  // episodes) go first, never the one just marked. (An object lists numeric
  // keys in ascending order, whatever order they were added in.)
  const others = Object.keys(eps).filter((id) => id !== ep.id);
  const over = others.length + 1 - MAX_EPISODES;
  if (over > 0) {
    others.sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b)).slice(0, over).forEach((id) => { delete eps[id]; delete parts[id]; });
  }
  const all: Shows = { ...readWatchedMarks() };
  all[k] = {
    at: Date.now(),
    last: { id: ep.id, season: ep.season, num: ep.num },
    eps,
    ...(Object.keys(parts).length ? { part: parts } : {}),
    ...(prev?.n ? { n: prev.n } : {}),
  };
  capByAge(all, MAX_SHOWS);
  if (writeList('shows', showsKey(), all)) changed();
}

/** Mark a film watched to the end. Written only when it changes. */
function markFilm(line: Line, streamId: number | string): void {
  if (!Number.isFinite(Number(streamId))) return;
  const k = filmKey(line, streamId);
  if (readWatchedFilms()[k]?.s === 2) return;
  const all: Films = { ...readWatchedFilms(), [k]: { at: Date.now(), s: 2 } };
  capByAge(all, MAX_FILMS);
  if (writeList('films', filmsKey(), all)) changed();
}

/** Begun (1), watched to the end (2), or neither (0) at `pos` of `dur` seconds. */
function stateAt(pos: number, dur: number): 0 | 1 | 2 {
  if (!Number.isFinite(pos) || pos <= 0) return 0;
  const known = Number.isFinite(dur) && dur > 0;
  if (known && (pos >= dur * DONE_FRACTION || (dur > 2 * DONE_LAST_S && pos >= dur - DONE_LAST_S))) return 2;
  return pos >= (known ? Math.min(BEGUN_S, dur / 2) : BEGUN_S) ? 1 : 0;
}

// Where the title playing was last seen (the player's last report, every
// 10 s while it plays), for noteEpisodeFinished / noteFilmFinished to tell an
// end from a cut. An older report is another sitting: it decides nothing.
const SEEN_FRESH_MS = 60_000;
let lastSeen: { key: string; pos: number; dur: number; at: number } | null = null;
const seen = (key: string, pos: number, dur: number): void => { lastSeen = { key, pos, dur, at: Date.now() }; };
/** False when the title was just seen well short of a known end. */
const endedForReal = (key: string): boolean => {
  const l = lastSeen;
  if (!l || l.key !== key || Date.now() - l.at > SEEN_FRESH_MS || !(Number.isFinite(l.dur) && l.dur > 0)) return true;
  return l.pos >= l.dur * ENDED_SHORT_FRACTION;
};

/** The player's progress for an episode (seconds): begun after a minute,
 *  finished at 92% or its last minute. */
export function noteEpisodeProgress(line: Line, seriesId: number | string, ep: WatchedEpisodeRef, pos: number, dur: number): void {
  seen(`e|${showKey(line, seriesId)}|${ep.id}`, pos, dur);
  const s = stateAt(pos, dur);
  if (!s) return;
  const tenth = s === 1 && dur > 0 ? Math.min(9, Math.max(1, Math.floor((pos / dur) * 10))) : 0;
  markEpisode(line, seriesId, ep, s, tenth);
}

/** An episode played to its end (the player's "ended"). */
export function noteEpisodeFinished(line: Line, seriesId: number | string, ep: WatchedEpisodeRef): void {
  if (!endedForReal(`e|${showKey(line, seriesId)}|${ep.id}`)) return;
  markEpisode(line, seriesId, ep, 2);
}

/** The player's progress for a film (seconds): watched at 92% or its last
 *  minute. */
export function noteFilmProgress(line: Line, streamId: number | string, pos: number, dur: number): void {
  seen(`f|${filmKey(line, streamId)}`, pos, dur);
  if (stateAt(pos, dur) === 2) markFilm(line, streamId);
}

/** A film played to its end (the player's "ended"). */
export function noteFilmFinished(line: Line, streamId: number | string): void {
  if (!endedForReal(`f|${filmKey(line, streamId)}`)) return;
  markFilm(line, streamId);
}

/** How many episodes a show the viewer has begun has now (its page open):
 *  the poster's check needs every one of them watched, so a new episode
 *  takes it away again. Shows never begun are not kept. Written only when
 *  the number changes. */
export function noteShowSize(line: Line, seriesId: number | string, episodes: number): void {
  if (!Number.isFinite(Number(seriesId)) || !(episodes > 0)) return;
  const k = showKey(line, seriesId);
  const prev: ShowMark | undefined = readWatchedMarks()[k];
  if (!prev || prev.n === episodes) return;
  if (writeList('shows', showsKey(), { ...readWatchedMarks(), [k]: { ...prev, n: episodes } })) changed();
}

/** Every episode the show had watched to the end (its page was open once
 *  since it was begun, so the number is known). */
export const showWatched = (show: ShowMark | undefined): boolean => {
  if (!show?.n) return false;
  let done = 0;
  for (const s of Object.values(show.eps ?? {})) if (s === 2) done += 1;
  return done >= show.n;
};

/** Forget this viewer's marks (every line). SMC has no "Clear watch history"
 *  yet: this is for when it does, and for tests. */
/** Tests: no list read and no title seen yet. */
export function __resetWatchedMarksForTests(): void {
  slots.shows = null;
  slots.films = null;
  lastSeen = null;
}

export function clearWatchedMarks(): void {
  try { localStorage.removeItem(showsKey()); } catch { /* ignore */ }
  try { localStorage.removeItem(filmsKey()); } catch { /* ignore */ }
  slots.shows = null;
  slots.films = null;
  changed();
}

/** An episode's mark: 0 not watched, 1 begun, 2 watched to the end. */
export const episodeMark = (show: ShowMark | undefined, episodeId: string | number): 0 | 1 | 2 =>
  (show?.eps?.[String(episodeId)] ?? 0) as 0 | 1 | 2;

/** How far a begun episode got (0-1), 0 when not known. */
export const episodePart = (show: ShowMark | undefined, episodeId: string | number): number =>
  (show?.part?.[String(episodeId)] ?? 0) / 10;

/** Every episode of a season watched to the end (a season with episodes). */
export const seasonWatched = (show: ShowMark | undefined, episodeIds: Array<string | number>): boolean =>
  !!show && episodeIds.length > 0 && episodeIds.every((id) => episodeMark(show, id) === 2);

// Signing in moves the viewer from the box ('device') to the account, and
// Live TV signs the box in to the account linked to its line by itself: the
// marks made before that would have stayed under the box's key and every
// poster looked unwatched. The box's marks come over (the more watched state
// wins per title and episode) and leave the box. Only from the box, and only
// its main profile (viewer.deviceKeyToCarry): one account's marks never go to
// another. Run again it finds nothing, so it is safe on every change.
function mergeShow(a: ShowMark | undefined, b: ShowMark): ShowMark {
  if (!a) return b;
  const eps: Record<string, 1 | 2> = { ...a.eps };
  for (const [id, s] of Object.entries(b.eps ?? {})) if (!eps[id] || eps[id] < s) eps[id] = s;
  const part: Record<string, number> = {};
  for (const src of [a.part, b.part]) {
    for (const [id, p] of Object.entries(src ?? {})) if (eps[id] === 1 && p > (part[id] ?? 0)) part[id] = p;
  }
  const newer = (b.at || 0) > (a.at || 0) ? b : a;
  const n = newer.n ?? a.n ?? b.n;
  return { at: newer.at, last: newer.last, eps, ...(Object.keys(part).length ? { part } : {}), ...(n ? { n } : {}) };
}

export function carryBoxMarks(): boolean {
  const from = deviceKeyToCarry();
  if (!from) return false;
  let moved = false;
  const box = { shows: showsKey(from), films: filmsKey(from) };
  let boxShows: string | null = null;
  let boxFilms: string | null = null;
  try { boxShows = localStorage.getItem(box.shows); boxFilms = localStorage.getItem(box.films); } catch { return false; }
  if (boxShows) {
    let theirs: Shows = {};
    try { theirs = JSON.parse(boxShows) || {}; } catch { theirs = {}; }
    const all: Shows = { ...readWatchedMarks() };
    for (const [k, m] of Object.entries(theirs)) if (m && typeof m === 'object') all[k] = mergeShow(all[k], m);
    capByAge(all, MAX_SHOWS);
    // Not stored under the account: the box keeps its copy, for next time.
    if (writeList('shows', showsKey(), all)) { try { localStorage.removeItem(box.shows); } catch { /* ignore */ } moved = true; }
  }
  if (boxFilms) {
    let theirs: Films = {};
    try { theirs = JSON.parse(boxFilms) || {}; } catch { theirs = {}; }
    const all: Films = { ...readWatchedFilms() };
    for (const [k, m] of Object.entries(theirs)) {
      if (!m || typeof m !== 'object' || m.s !== 2) continue;
      const have = all[k];
      if (!have || have.s < m.s || (have.s === m.s && have.at < m.at)) all[k] = m;
    }
    capByAge(all, MAX_FILMS);
    if (writeList('films', filmsKey(), all)) { try { localStorage.removeItem(box.films); } catch { /* ignore */ } moved = true; }
  }
  if (moved) changed();
  return moved;
}

// A change of viewer (sign-in, sign-out, another profile) is another viewer's
// marks: every screen showing them reads again.
onViewerChange(() => { carryBoxMarks(); changed(); });

/** Once the viewer is known, the box's marks from before a sign-in come over
 *  (signed in while no screen that shows them had loaded this file). */
export function initWatchedMarks(): void {
  // The first answer about who is watching tells no one (viewer.ts): a
  // screen that read the box's marks before it must read again.
  try { void resolveViewer().then(() => { if (!carryBoxMarks()) changed(); }, () => { /* no auth here */ }); } catch { /* ignore */ }
}
