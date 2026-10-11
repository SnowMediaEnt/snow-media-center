// Where each viewer stopped in each Plex title: their own resume points,
// "Continue Watching", progress bars and "watched" ticks.
//
// Not Plex's: Plex keeps those per ACCOUNT, and most boxes share one — the
// Hub links each box's plex.tv/link code to your owner or link account, and
// the provider link hands out the provider account — so the server's resume
// points and On Deck are everyone's viewing mixed together. (A box on the
// customer's own Plex account also reports to Plex; see isOwnPlexAccount.)
// These are kept per viewer — the signed-in
// Snow Media account, else the box, and the profile picked on it — on the
// device, and mirrored to the account (watch_history rows of kind
// 'plex_progress', see viewer.ts for a profile's rows) so they follow the
// viewer to another box.
//
// The "watched" checks are kept apart from the resume points (see Watched
// marks below): those are only the newest MAX titles, and a season's check
// must not go as its oldest episodes drop off them.
//
// Nothing here is on the playback path: every write is fire and forget and
// every storage or network failure is swallowed.
import { supabase } from '@/integrations/supabase/client';
import type { PlexItem, PlexSeason } from '@/lib/plex';
import { __setViewerForTests, cloudItemKey, deviceKeyToCarry, fromCloudItemKey, onViewerChange, resolveViewer, scopeToProfile, viewerAccountConfirmed, viewerAccountId, viewerKey } from '@/lib/viewer';

export interface PlexProgress {
  ratingKey: string;
  kind: 'movie' | 'episode';
  title: string;
  /** seconds */
  at: number;
  /** seconds */
  dur: number;
  /** When it was last watched (ms since epoch). */
  t: number;
  /** Watched to the end. */
  done: boolean;
  librarySectionID?: string;
  showKey?: string;
  showTitle?: string;
  season?: number;
  index?: number;
}

export const PLEX_PROGRESS_EVENT = 'plex-progress:changed';
export const PROGRESS_KIND = 'plex_progress';
const PREFIX = 'snow-plex-progress:';
const MAX = 400;
/** What is kept when storage has no room for MAX: the newest this many. */
const MAX_WHEN_FULL = 150;
/** The first and last minute are not a place to resume from. */
const EDGE_S = 60;
/** Past this share of the running time a title counts as watched. */
const DONE_SHARE = 0.92;
/** Continue Watching lets go of a title not touched in this long: the row is
 *  what someone is watching now, not everything they ever started. (Its
 *  resume point is kept.) */
export const CONTINUE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Cloud copies at most this often per title while it plays. */
const CLOUD_EVERY_MS = 60_000;
/** When the box's list comes over to the account, this many of the newest
 *  are copied to it at once; the rest go up as they are watched again. */
const CARRY_TO_CLOUD = 50;
/** A time more than this far ahead was written under a wrong clock. */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
/** A "watched" or "not started" report this close after a place saved here
 *  is the same sitting ending (the player closing, autoplay's next title),
 *  not a newer place to resume from. */
const SAME_SITTING_MS = 10 * 60 * 1000;

// A change of viewer (sign-in, sign-out) means another viewer's list and
// checks, and on signing in the box's own come along (carryDeviceOver).
onViewerChange(() => { switchViewer(); });
const switchViewer = () => {
  const was = memo, wasMarks = marks;
  memo = null; marks = null;
  carryDeviceOver(was);
  carryMarksOver(wasMarks);
  emit();
  marksChanged();
};

type Memo = { viewer: string; map: Record<string, PlexProgress> };
let memo: Memo | null = null;

/** One saved entry as the rest of this file expects it, or null. An older
 *  version or another box may have written the numbers as text, and one that
 *  is not a number at all sorts nowhere: Continue Watching's newest-first
 *  order, and so its 30-day cut, stop meaning anything. */
const cleanEntry = (v: unknown, key?: string): PlexProgress | null => {
  if (!v || typeof v !== 'object') return null;
  const p = v as PlexProgress;
  const ratingKey = String(p.ratingKey || key || '');
  const t = Number(p.t), at = Number(p.at), dur = Number(p.dur);
  if (!ratingKey || !Number.isFinite(t) || !Number.isFinite(at) || !Number.isFinite(dur)) return null;
  return { ...p, ratingKey, t, at, dur };
};

const readMap = (viewer: string): Record<string, PlexProgress> => {
  const map: Record<string, PlexProgress> = {};
  try {
    const raw = localStorage.getItem(PREFIX + viewer);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(parsed)) {
        const p = cleanEntry((parsed as Record<string, unknown>)[k], k);
        if (p) map[p.ratingKey] = p;
      }
    }
  } catch { /* start empty */ }
  return map;
};

const load = (): Record<string, PlexProgress> => {
  const viewer = viewerKey();
  if (memo && memo.viewer === viewer) return memo.map;
  const map = readMap(viewer);
  memo = { viewer, map };
  return map;
};

const write = (viewer: string, map: Record<string, PlexProgress>): boolean => {
  try { localStorage.setItem(PREFIX + viewer, JSON.stringify(map)); return true; } catch { return false; }
};

/** Keep the newest MAX, for this viewer. False when storage would not take
 *  it: the list then lasts only until the app closes. `quiet`: tell no one
 *  (a beat that changed nothing Continue Watching shows). */
const save = (map: Record<string, PlexProgress>, quiet = false): boolean => {
  const list = Object.values(map).sort((a, b) => b.t - a.t).slice(0, MAX);
  const newest = (n: number) => {
    const out: Record<string, PlexProgress> = {};
    for (const p of list.slice(0, n)) out[p.ratingKey] = p;
    return out;
  };
  const viewer = viewerKey();
  let kept = newest(MAX);
  let ok = write(viewer, kept);
  // Full (the error's name differs from one WebView to the next, so any
  // failure gets the second try): the newest MAX_WHEN_FULL may fit where a
  // long list does not, and they are the ones Continue Watching shows.
  if (!ok && list.length > MAX_WHEN_FULL) {
    const fewer = newest(MAX_WHEN_FULL);
    if (write(viewer, fewer)) { kept = fewer; ok = true; }
  }
  if (!ok) noteProgressDiag({ storageErrorAt: Date.now() });
  memo = { viewer, map: kept };
  if (!quiet) emit();
  return ok;
};

let emitTimer: number | null = null;
const emit = () => {
  if (emitTimer != null) return;
  emitTimer = window.setTimeout(() => {
    emitTimer = null;
    try { window.dispatchEvent(new CustomEvent(PLEX_PROGRESS_EVENT)); } catch { /* ignore */ }
  }, 0);
};

/** A failed account copy, for the Continue Watching check. */
const noteCloudError = (e: unknown) => {
  const o = e as { message?: unknown; code?: unknown } | null;
  const said = (o && typeof o === 'object' && (o.message || o.code)) || e;
  noteProgressDiag({ cloudErrorAt: Date.now(), cloudError: String(said).slice(0, 100) });
};

const lastCloud = new Map<string, number>();
const toCloud = (p: PlexProgress, force: boolean) => {
  const userId = viewerAccountId();
  if (!userId) return;
  const now = Date.now();
  const itemKey = cloudItemKey(p.ratingKey);
  if (!force && now - (lastCloud.get(itemKey) ?? 0) < CLOUD_EVERY_MS) return;
  lastCloud.set(itemKey, now);
  void (async () => {
    try {
      const { error } = await supabase.from('watch_history').upsert({
        user_id: userId,
        kind: PROGRESS_KIND,
        item_key: itemKey,
        title: p.title,
        subtitle: p.showTitle ?? null,
        poster: null,
        payload: JSON.parse(JSON.stringify(p)),
        watched_at: new Date(p.t).toISOString(),
        count: 1,
      }, { onConflict: 'user_id,kind,item_key' });
      // A refused write (a session that has lapsed, a policy) comes back as
      // { error }, not thrown: unread, the account copy failed without a
      // trace and other boxes never saw the title.
      if (error) noteCloudError(error);
    } catch (e) { noteCloudError(e); /* offline: the box keeps it */ }
  })();
};

// Signing in moves the viewer from the box ('device') to the account — and
// Live TV signs the box in to the account linked to its line by itself — so
// everything watched before was left under the box's key and Continue
// Watching started empty. The box's list comes over to the account's (the
// newer place wins per title) and leaves the box. Only from the box: going
// from one account to another keeps each one's own. Run again it finds
// nothing left to bring, so it is safe on every change of viewer.
const carryDeviceOver = (was: Memo | null): void => {
  const from = deviceKeyToCarry();
  if (!from) return;
  // The memo is what the box last saved, even what storage had no room for.
  const box = was && was.viewer === from ? was.map : readMap(from);
  const keys = Object.keys(box);
  if (!keys.length) return;
  const map = { ...load() };
  const came: PlexProgress[] = [];
  for (const k of keys) {
    const p = box[k];
    if (!map[k] || map[k].t < p.t) { map[k] = p; came.push(p); }
  }
  // Not stored under the account: the box keeps its copy, for next time.
  if (!save(map)) return;
  try { localStorage.removeItem(PREFIX + from); } catch { /* ignore */ }
  // To the account only once its own copy has been read, and only what is
  // still newer: a box that was never signed in to it knows nothing of it,
  // so an old place here would overwrite a newer one saved on another box.
  const up = came.sort((a, b) => b.t - a.t).slice(0, CARRY_TO_CLOUD);
  if (!up.length) return;
  void pullProgressFromCloud().then((read) => {
    if (!read) return;
    const cur = load();
    for (const p of up) if (cur[p.ratingKey] === p) toCloud(p, true);
  });
};

/** What Continue Watching (and its "next episode" half) would show from
 *  `map`: which titles, in which order. Two maps with the same signature
 *  draw the same rows, progress bars aside. */
const continueSignature = (map: Record<string, PlexProgress>, now: number): string =>
  `${continueFrom(map, MAX, undefined, now).map((i) => i.ratingKey).join(',')}|${
    finishedFrom(map, MAX, now).map((f) => `${f.showKey}:${f.season}:${f.index}`).join(',')}`;

/** Record where playback is. `final` when it stopped (always copied to the
 *  account); otherwise the account copy is refreshed at most once a minute.
 *  The change event (PLEX_PROGRESS_EVENT) goes out on a final save, or when
 *  a beat changes what Continue Watching shows (a title joins it past the
 *  first minute, or leaves it as it is watched): the screens behind the
 *  player re-draw on it, and every 15 s beat of a film re-drew them for
 *  nothing. The player closing refreshes them anyway (watchNonce). */
export function saveProgress(p: Omit<PlexProgress, 't' | 'done'> & { done?: boolean }, final = false): void {
  if (!p.ratingKey || !(p.dur > 0)) return;
  // Taken past Up Next (noteEpisodeFinishing): its closing save is a finish.
  const tookUpNext = final && finishingNow(p.ratingKey);
  void resolveViewer().then(() => {
    const map = load();
    const prev = map[p.ratingKey];
    const done = p.done ?? (tookUpNext || countsAsDone(p.at, p.dur));
    const entry: PlexProgress = { ...prev, ...p, at: Math.max(0, p.at), done, t: Date.now() };
    const next = { ...map, [p.ratingKey]: entry };
    const now = Date.now();
    const quiet = !final && continueSignature(map, now) === continueSignature(next, now);
    save(next, quiet);
    // Its check, which stays (see Watched marks). Only once the player has
    // said so twice running, or as it closed there: one odd reading (the
    // last title's playhead under the next one) would mark it for good.
    if (done && (final || prev?.done)) noteWatched(entry);
    toCloud(entry, final);
    noteProgressDiag({ savedAt: entry.t, title: entry.title, at: entry.at, dur: entry.dur, done });
  });
}

/** Watched to the end at `at` of `dur` seconds: past DONE_SHARE, or into the
 *  last minute. */
export const countsAsDone = (at: number, dur: number): boolean => dur > 0 && (at >= dur * DONE_SHARE || at >= dur - EDGE_S);

// Up Next taken (EpisodeAutoplay): the episode was watched, though the last
// reading may be short of the done line (credits marked early, an anime's
// long ending song) and the episode would never get its check, nor its
// season. Its closing save, which comes as the next one starts, counts it
// done; a minute later the note is stale (no closing save came).
const FINISHING_MS = 60_000;
const finishing = new Map<string, number>();
export function noteEpisodeFinishing(ratingKey: string): void {
  if (ratingKey) finishing.set(ratingKey, Date.now());
}
const finishingNow = (ratingKey: string): boolean => {
  const at = finishing.get(ratingKey);
  if (at == null) return false;
  finishing.delete(ratingKey);
  return Date.now() - at <= FINISHING_MS;
};

// ── "Continue Watching check" (Plex Settings) ─────────────────────────────
// What the box last saved, and when it last could not tell what was playing,
// so a photo of Plex Settings says where Continue Watching stops. Per box.
const DIAG_KEY = 'smc-plex-progress-diag';
export interface ProgressDiag {
  savedAt?: number; title?: string; at?: number; dur?: number; done?: boolean;
  /** The last time "what is playing" could not be read from the server. */
  infoMissAt?: number;
  /** The reporter's last 15 s beat: when, what the player said, and why it
   *  saved nothing when it did not ('inactive', 'no-duration', 'no-position',
   *  'last-title': the last title's playhead still under this one). */
  beatAt?: number; beatPos?: number; beatDur?: number; beatSkip?: string;
  /** The last time the player closed: whether the title was known and the
   *  reporter was active then. */
  closedAt?: number; closedKnown?: boolean; closedActive?: boolean;
  /** The last failed write: the box's storage, or the account copy online. */
  storageErrorAt?: number; cloudErrorAt?: number; cloudError?: string;
}
// What storage would not take (it is full: often the very failure being
// noted), kept for this run of the app so the check can still show it.
let diagHeld: ProgressDiag | null = null;
export function progressDiag(): ProgressDiag {
  if (diagHeld) return diagHeld;
  try {
    const d = JSON.parse(localStorage.getItem(DIAG_KEY) || 'null') as ProgressDiag | null;
    return d && typeof d === 'object' ? d : {};
  } catch { return {}; }
}
/** Never throws: it is called from the player's reporting. */
export function noteProgressDiag(patch: ProgressDiag): void {
  try {
    const next = { ...progressDiag(), ...patch };
    try { localStorage.setItem(DIAG_KEY, JSON.stringify(next)); diagHeld = null; } catch { diagHeld = next; }
  } catch { /* ignore */ }
}
/** How many titles this viewer has a saved place in. */
export function progressCount(): number {
  return Object.keys(load()).length;
}

export function getProgress(ratingKey: string): PlexProgress | null {
  return load()[ratingKey] ?? null;
}

/** Stopped part-way: not watched, and not in the first or last minute. */
const resumable = (p: PlexProgress): boolean => !p.done && p.at >= EDGE_S && p.at <= p.dur - EDGE_S;

/** Seconds to resume from, or undefined: not started, the first or last
 *  minute, or watched. */
export function resumeSeconds(ratingKey: string): number | undefined {
  const p = getProgress(ratingKey);
  if (!p || !resumable(p)) return undefined;
  return Math.floor(p.at);
}

/** Share watched 0–100 for a progress bar, or null when there is nothing to
 *  resume. */
export function progressPercent(ratingKey: string): number | null {
  const at = resumeSeconds(ratingKey);
  const p = getProgress(ratingKey);
  if (at == null || !p) return null;
  return Math.max(3, Math.min(97, Math.round((at / p.dur) * 100)));
}

export function isWatched(ratingKey: string): boolean {
  return !!getProgress(ratingKey)?.done;
}

// ── Watched marks ─────────────────────────────────────────────────────────
// The check on a poster, an episode and a season. A resume point above is a
// title, its show, its place and its running time, and only the newest MAX
// are kept: a viewer who had finished a long show plus some films lost the
// checks of its first seasons as their episodes dropped off. A check is
// only the title's key and, for an episode, its show and season (a few
// bytes, "48213|48200|2"), so WATCHED_MAX of them take less room than the
// resume points do. Per viewer like them; written only when a title is first
// finished (or its show becomes known), never on the beats in between.
// The account copy is the resume points' rows: a finished title's row says
// so (`done`), and a box new to the account reads those once
// (pullMarksFromCloud).
export const PLEX_WATCHED_EVENT = 'plex-watched:changed';
const WATCHED_PREFIX = 'snow-plex-watched:';
/** Thirteen ten-season shows of 22 episodes and change; the oldest go first. */
const WATCHED_MAX = 3000;
/** What is kept when storage has no room for all of them: the newest. */
const WATCHED_WHEN_FULL = 1000;

interface Marks {
  viewer: string;
  /** ratingKey -> where it sits: 'show|season', 'show', or '' (a film, or an
   *  episode whose show was not known). In the order they were marked. */
  keys: Map<string, string>;
  /** 'show' and 'show|season' -> how many of its episodes are marked. */
  counts: Map<string, number>;
}
let marks: Marks | null = null;
let marksVersion = 0;
/** The viewer's own Plex account: the server's plays count too. */
let serverMarks = false;
const marksPulled = new Set<string>();

const placeOf = (p: { kind?: string; showKey?: string; season?: number }): string =>
  (p.kind === 'episode' && p.showKey ? (p.season != null ? `${p.showKey}|${p.season}` : p.showKey) : '');

const countPlace = (counts: Map<string, number>, place: string, by: number) => {
  if (!place) return;
  const bar = place.indexOf('|');
  for (const k of bar < 0 ? [place] : [place.slice(0, bar), place]) {
    const n = (counts.get(k) ?? 0) + by;
    if (n > 0) counts.set(k, n); else counts.delete(k);
  }
};

/** Mark a title watched at `place`. True when that changed something: a new
 *  title, or the show or season of one marked before they were known. */
const mark = (m: Marks, ratingKey: string, place: string): boolean => {
  const had = m.keys.get(ratingKey);
  if (had != null && (had === place || !place || had.startsWith(`${place}|`))) return false;
  if (had != null) { countPlace(m.counts, had, -1); m.keys.delete(ratingKey); }
  m.keys.set(ratingKey, place);
  countPlace(m.counts, place, 1);
  if (m.keys.size > WATCHED_MAX) {
    let over = m.keys.size - WATCHED_MAX;
    // A Map keeps the order its keys went in: the first are the oldest.
    for (const [k, at] of m.keys) {
      if (over-- <= 0) break;
      m.keys.delete(k);
      countPlace(m.counts, at, -1);
    }
  }
  return true;
};

const readMarks = (viewer: string): Marks => {
  const m: Marks = { viewer, keys: new Map(), counts: new Map() };
  try {
    const list = JSON.parse(localStorage.getItem(WATCHED_PREFIX + viewer) || '[]');
    if (Array.isArray(list)) {
      for (const s of list) {
        if (typeof s !== 'string' || !s) continue;
        const bar = s.indexOf('|');
        mark(m, bar < 0 ? s : s.slice(0, bar), bar < 0 ? '' : s.slice(bar + 1));
      }
    }
  } catch { /* start empty */ }
  return m;
};

const marksNow = (): Marks => {
  const viewer = viewerKey();
  if (marks && marks.viewer === viewer) return marks;
  let stored = true;
  try { stored = localStorage.getItem(WATCHED_PREFIX + viewer) != null; } catch { /* as stored */ }
  const m = readMarks(viewer);
  marks = m;
  // Finished before the checks were kept here: from the resume points, once
  // per viewer (the list is then stored, if empty). Not again: a single odd
  // reading left in a resume point would become a check for good.
  if (!stored) {
    for (const p of Object.values(load()).sort((a, b) => a.t - b.t)) {
      if (p.done) mark(m, p.ratingKey, placeOf(p));
    }
    writeMarks(m);
  }
  return m;
};

let marksTimer: number | null = null;
const marksChanged = () => {
  marksVersion += 1;
  if (marksTimer != null) return;
  marksTimer = window.setTimeout(() => {
    marksTimer = null;
    try { window.dispatchEvent(new CustomEvent(PLEX_WATCHED_EVENT)); } catch { /* ignore */ }
  }, 0);
};

/** Store `m` and tell the lists. False when storage would not take even the
 *  newest WATCHED_WHEN_FULL: they all stay checked until the app closes. */
const writeMarks = (m: Marks): boolean => {
  const list = Array.from(m.keys, ([k, place]) => (place ? `${k}|${place}` : k));
  let ok = false;
  try { localStorage.setItem(WATCHED_PREFIX + m.viewer, JSON.stringify(list)); ok = true; } catch {
    try { localStorage.setItem(WATCHED_PREFIX + m.viewer, JSON.stringify(list.slice(-WATCHED_WHEN_FULL))); ok = true; } catch { /* this run only */ }
  }
  marksChanged();
  return ok;
};

const noteWatched = (p: PlexProgress): void => {
  const m = marksNow();
  if (mark(m, p.ratingKey, placeOf(p))) writeMarks(m);
};

// Signing in: the box's checks come over to the account with its resume
// points (carryDeviceOver) and leave the box.
const carryMarksOver = (was: Marks | null): void => {
  const from = deviceKeyToCarry();
  if (!from) return;
  const box = was && was.viewer === from ? was : readMarks(from);
  if (!box.keys.size) return;
  const m = marksNow();
  let changed = false;
  for (const [k, place] of box.keys) if (mark(m, k, place)) changed = true;
  // Not stored under the account: the box keeps its copy, for next time.
  if (changed && !writeMarks(m)) return;
  try { localStorage.removeItem(WATCHED_PREFIX + from); } catch { /* ignore */ }
};

/** Every title the account has finished, not only the newest MAX that
 *  pullProgressFromCloud reads: a box new to the account, or one whose
 *  storage was cleared, gets all its checks back. Once per viewer per start,
 *  and small: keys only, no titles or times. */
// Typed as a plain string: spelled out, the client's type for these JSON
// paths is too deep for the compiler.
const MARK_COLUMNS: string = 'item_key,done:payload->done,show:payload->showKey,season:payload->season';
/** The server hands out at most this many rows an ask (the project's API
 *  "max rows", 1000 on 2026-10-10): more come page by page. */
const CLOUD_PAGE = 1000;
type MarkRow = { item_key: unknown; done?: unknown; show?: unknown; season?: unknown };
/** True when the account's checks were read (none is an answer too). */
const pullMarksFromCloud = async (userId: string, viewer: string): Promise<boolean> => {
  try {
    const data: MarkRow[] = [];
    for (let from = 0; from < WATCHED_MAX; from += CLOUD_PAGE) {
      const { data: page, error } = await scopeToProfile(supabase
        .from('watch_history')
        .select(MARK_COLUMNS)
        .eq('user_id', userId)
        .eq('kind', PROGRESS_KIND)
        .eq('payload->>done', 'true'))
        .order('watched_at', { ascending: false })
        .range(from, Math.min(from + CLOUD_PAGE, WATCHED_MAX) - 1);
      if (error || !Array.isArray(page)) { noteCloudError(error); return false; }
      data.push(...(page as unknown as MarkRow[]));
      if (page.length < CLOUD_PAGE) break;
    }
    if (viewerKey() !== viewer) return false;
    const m = marksNow();
    let changed = false;
    // Oldest first, so the newest are the last to go.
    const rows = data;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const key = r.done === true ? fromCloudItemKey(String(r.item_key)) : null;
      if (!key) continue;
      const showKey = typeof r.show === 'string' && r.show ? r.show : undefined;
      const season = typeof r.season === 'number' ? r.season : undefined;
      if (mark(m, key, placeOf({ kind: showKey ? 'episode' : 'movie', showKey, season }))) changed = true;
    }
    if (changed) writeMarks(m);
    return true;
  } catch { /* offline: the next Plex open */ return false; }
};

/** Changes whenever a check may have: a title finished, another viewer, the
 *  account's checks arriving. Lists redraw their posters on it (and on
 *  PLEX_WATCHED_EVENT, which follows each change). */
export function plexWatchedVersion(): number {
  marksNow();
  return marksVersion;
}

/** This viewer has watched it to the end: a film or an episode. */
export function isTitleWatched(ratingKey: string): boolean {
  return marksNow().keys.has(ratingKey) || isWatched(ratingKey);
}

/** How many of a show's episodes this viewer has watched: in all, or in one
 *  season (its index, as Plex numbers it: 0 is Specials). */
export function watchedEpisodeCount(showKey: string, season?: number): number {
  return marksNow().counts.get(season != null ? `${showKey}|${season}` : showKey) ?? 0;
}

/** `watched` of a show's or a season's `n` episodes is all of them. More
 *  checks than it has episodes means some were of episodes the server no
 *  longer has (a daily show keeping its latest few, one deleted and added
 *  again): which of today's are watched is not known, so no check. */
const allOf = (watched: number, n: number): boolean => n > 0 && watched === n;

/** A poster's check: a film or an episode watched to the end, a show whose
 *  every episode was (its leafCount, which lists send; Specials count). */
export function plexItemWatched(it: Pick<PlexItem, 'ratingKey' | 'type' | 'viewCount' | 'leafCount' | 'viewedLeafCount'>): boolean {
  if (it.type === 'show') {
    const n = it.leafCount ?? 0;
    return allOf(watchedEpisodeCount(it.ratingKey), n) || (serverMarks && n > 0 && (it.viewedLeafCount ?? 0) >= n);
  }
  if (it.type !== 'movie' && it.type !== 'episode') return false;
  return isTitleWatched(it.ratingKey) || (serverMarks && (it.viewCount ?? 0) > 0);
}

/** A season's check: every episode in it watched. Counted from the checks,
 *  so no season's episodes need loading for it. */
export function plexSeasonWatched(showKey: string, s: Pick<PlexSeason, 'index' | 'leafCount' | 'viewedLeafCount'>): boolean {
  const n = s.leafCount ?? 0;
  if (!(n > 0)) return false;
  return (s.index != null && allOf(watchedEpisodeCount(showKey, s.index), n)) || (serverMarks && (s.viewedLeafCount ?? 0) >= n);
}

/** On the viewer's own Plex account the server's plays are theirs too (the
 *  Plex apps on their other devices): what it counts as watched is checked
 *  as well. Never on a shared account, where they are everyone's. */
export function setPlexServerMarks(on: boolean): void {
  if (serverMarks === on) return;
  serverMarks = on;
  marksChanged();
}

/** Opened and left inside the first minute, not watched. */
const barelyStarted = (p: PlexProgress): boolean => !p.done && p.at < EDGE_S;

/** When a title was last watched, for order and age. A time more than a day
 *  ahead was saved while the box's clock was wrong: taken as now, or it
 *  would sit at the front of the row until that date came round. */
const watchedAt = (p: PlexProgress, now: number): number => (p.t > now + FUTURE_SLACK_MS ? now : p.t);

/** `map`'s titles, most recently watched first. The index breaks ties:
 *  Array#sort is not stable on an old WebView. */
const newestFirst = (map: Record<string, PlexProgress>, now: number) =>
  Object.values(map).map((p, i) => ({ p, t: watchedAt(p, now), i })).sort((a, b) => b.t - a.t || a.i - b.i);

/** Continue Watching: titles stopped part-way, newest first, one episode per
 *  show (the latest), as tiles. Episodes show their show's poster. */
export function continueWatching(limit = 30, sectionId?: string, now = Date.now()): PlexItem[] {
  return continueFrom(load(), limit, sectionId, now);
}
function continueFrom(map: Record<string, PlexProgress>, limit: number, sectionId: string | undefined, now: number): PlexItem[] {
  const seenShows = new Set<string>();
  const out: PlexItem[] = [];
  for (const { p, t } of newestFirst(map, now)) {
    if (out.length >= limit) break;
    // Passed over, not the end of the list: one odd time must not hide the
    // titles after it.
    if (now - t > CONTINUE_MAX_AGE_MS) continue;
    if (sectionId && String(p.librarySectionID ?? '') !== String(sectionId)) continue;
    // Barely started: not a place to resume, and not where the viewer is in
    // the show either — the next episode that autoplay started and Back ended
    // inside a minute must not take the show's one place from the episode
    // they are part-way through.
    if (barelyStarted(p)) continue;
    if (p.kind === 'episode' && p.showKey) {
      if (seenShows.has(p.showKey)) continue;
      seenShows.add(p.showKey);
    }
    if (!resumable(p)) continue;
    out.push({
      ratingKey: p.ratingKey,
      title: p.title,
      type: p.kind,
      thumb: `/library/metadata/${p.kind === 'episode' && p.showKey ? p.showKey : p.ratingKey}/thumb`,
      viewOffset: Math.floor(p.at * 1000),
      duration: Math.floor(p.dur * 1000),
      librarySectionID: p.librarySectionID,
      grandparentTitle: p.kind === 'episode' ? p.showTitle : undefined,
      grandparentRatingKey: p.kind === 'episode' ? p.showKey : undefined,
      parentIndex: p.season,
      index: p.index,
      lastViewedAt: t,
    });
  }
  return out;
}

/** A show whose latest watched episode was finished, for "next episode" in
 *  Continue Watching (the next one is found on the server). Newest first,
 *  within CONTINUE_MAX_AGE_MS; a show stopped part-way is already in
 *  continueWatching and is not here. */
export interface FinishedShow {
  showKey: string; showTitle?: string; season: number; index: number; t: number; librarySectionID?: string;
}
export function finishedShows(limit = 8, now = Date.now()): FinishedShow[] {
  return finishedFrom(load(), limit, now);
}
function finishedFrom(map: Record<string, PlexProgress>, limit: number, now: number): FinishedShow[] {
  const seen = new Set<string>();
  const out: FinishedShow[] = [];
  for (const { p, t } of newestFirst(map, now)) {
    if (out.length >= limit) break;
    if (now - t > CONTINUE_MAX_AGE_MS) continue;
    // The next episode opened and left inside a minute: the finished one
    // before it still says where the show is (see continueWatching).
    if (barelyStarted(p)) continue;
    if (p.kind !== 'episode' || !p.showKey || seen.has(p.showKey)) continue;
    seen.add(p.showKey);
    if (!p.done || p.season == null || p.index == null) continue;
    out.push({ showKey: p.showKey, showTitle: p.showTitle, season: p.season, index: p.index, t, librarySectionID: p.librarySectionID });
  }
  return out;
}

/** Fold the account's copy into this box (newest wins). Call on Plex open.
 *  True when the account's copy was read. */
export async function pullProgressFromCloud(): Promise<boolean> {
  await resolveViewer();
  const userId = viewerAccountId();
  if (!userId) return false;
  const viewer = viewerKey();
  try {
    const { data, error } = await scopeToProfile(supabase
      .from('watch_history')
      .select('item_key,payload,watched_at')
      .eq('user_id', userId)
      .eq('kind', PROGRESS_KIND))
      .order('watched_at', { ascending: false })
      .limit(MAX);
    if (error || !data || viewerKey() !== viewer) return false;
    const map = { ...load() };
    const w = marksNow();
    let changed = false, marked = false;
    const now = Date.now();
    for (const r of data) {
      const raw = r.payload as unknown as Partial<PlexProgress> | null;
      if (!raw || typeof raw !== 'object') continue;
      // A box whose clock ran ahead wrote a time still to come, which would
      // beat every later watch here: no later than now.
      const t = Math.min(Date.parse(String(r.watched_at)) || Number(raw.t) || 0, now);
      const p = cleanEntry({ ...raw, t });
      if (!p || !(p.dur > 0)) continue;
      if (fromCloudItemKey(String(r.item_key)) !== p.ratingKey) continue;
      // Finished on another box: checked here too, even where this box's
      // own place in it is newer.
      if (p.done && mark(w, p.ratingKey, placeOf(p))) marked = true;
      const have = map[p.ratingKey];
      if (have && have.t >= t) continue;
      // The same sitting ending — the player closing, autoplay's next title —
      // must not take away the place this box kept from it.
      if (have && resumable(have) && (p.done || barelyStarted(p)) && t - have.t <= SAME_SITTING_MS) continue;
      map[p.ratingKey] = p; changed = true;
    }
    if (changed) save(map);
    if (marked) writeMarks(w);
    // Only for an account the server has confirmed (a remembered session not
    // yet checked reads nothing, and that answer would have stood for the
    // run); tried again on the next Plex open when it did not get through.
    if (viewerAccountConfirmed() && !marksPulled.has(viewer)) {
      marksPulled.add(viewer);
      void pullMarksFromCloud(userId, viewer).then((ok) => { if (!ok) marksPulled.delete(viewer); });
    }
    return true;
  } catch { /* offline */ return false; }
}

/** Resolve the viewer early so the first reads are the right viewer's. */
export function initPlexProgress(): Promise<void> {
  // Signed in before this start (no change of viewer to hear), perhaps by a
  // version of the app that left the box's list behind: it comes over now.
  return resolveViewer().then(switchViewer);
}

/** Tests only. */
export function __resetPlexProgressForTests(v = 'device'): void {
  __setViewerForTests(v); memo = null; lastCloud.clear(); diagHeld = null;
  marks = null; marksPulled.clear(); serverMarks = false; finishing.clear();
}

/** On the viewer's own Plex account the server's Continue Watching is theirs
 *  too (the Plex apps on their other devices): this box's, plus the server's
 *  titles it does not already have — one episode per show (this box's own
 *  wins a show) — most recently watched first. A server title with no time
 *  (an On Deck "next episode") follows the ones that have one. */
export function mergeContinue(own: PlexItem[], server: PlexItem[]): PlexItem[] {
  const keys = new Set(own.map((i) => i.ratingKey));
  const shows = new Set(own.filter((i) => i.type === 'episode' && i.grandparentTitle).map((i) => i.grandparentTitle!.toLowerCase()));
  const extra = server.filter((i) => {
    if (keys.has(i.ratingKey)) return false;
    if (i.type === 'episode' && i.grandparentTitle) {
      const show = i.grandparentTitle.toLowerCase();
      if (shows.has(show)) return false;
      shows.add(show);
    }
    return true;
  });
  return [...own, ...extra]
    .map((it, i) => ({ it, i }))
    // The index breaks ties: Array#sort is not stable on an old WebView.
    .sort((a, b) => (b.it.lastViewedAt ?? -1) - (a.it.lastViewedAt ?? -1) || a.i - b.i)
    .map(({ it }) => it);
}
