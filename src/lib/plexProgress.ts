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
// Nothing here is on the playback path: every write is fire and forget and
// every storage or network failure is swallowed.
import { supabase } from '@/integrations/supabase/client';
import type { PlexItem } from '@/lib/plex';
import { __setViewerForTests, cloudItemKey, deviceKeyToCarry, fromCloudItemKey, onViewerChange, resolveViewer, scopeToProfile, viewerAccountId, viewerKey } from '@/lib/viewer';

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

// A change of viewer (sign-in, sign-out) means another viewer's list, and on
// signing in the box's own list comes along (carryDeviceOver).
onViewerChange(() => { const was = memo; memo = null; carryDeviceOver(was); emit(); });

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
 *  it: the list then lasts only until the app closes. */
const save = (map: Record<string, PlexProgress>): boolean => {
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
  emit();
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

/** Record where playback is. `final` when it stopped (always copied to the
 *  account); otherwise the account copy is refreshed at most once a minute. */
export function saveProgress(p: Omit<PlexProgress, 't' | 'done'> & { done?: boolean }, final = false): void {
  if (!p.ratingKey || !(p.dur > 0)) return;
  void resolveViewer().then(() => {
    const map = load();
    const done = p.done ?? (p.at >= p.dur * DONE_SHARE || p.at >= p.dur - EDGE_S);
    const entry: PlexProgress = { ...map[p.ratingKey], ...p, at: Math.max(0, p.at), done, t: Date.now() };
    save({ ...map, [p.ratingKey]: entry });
    toCloud(entry, final);
    noteProgressDiag({ savedAt: entry.t, title: entry.title, at: entry.at, dur: entry.dur, done });
  });
}

// ── "Continue Watching check" (Plex Settings) ─────────────────────────────
// What the box last saved, and when it last could not tell what was playing,
// so a photo of Plex Settings says where Continue Watching stops. Per box.
const DIAG_KEY = 'smc-plex-progress-diag';
export interface ProgressDiag {
  savedAt?: number; title?: string; at?: number; dur?: number; done?: boolean;
  /** The last time "what is playing" could not be read from the server. */
  infoMissAt?: number;
  /** The reporter's last 15 s beat: when, what the player said, and why it
   *  saved nothing when it did not ('inactive', 'no-duration', 'no-position'). */
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

/** Opened and left inside the first minute, not watched. */
const barelyStarted = (p: PlexProgress): boolean => !p.done && p.at < EDGE_S;

/** When a title was last watched, for order and age. A time more than a day
 *  ahead was saved while the box's clock was wrong: taken as now, or it
 *  would sit at the front of the row until that date came round. */
const watchedAt = (p: PlexProgress, now: number): number => (p.t > now + FUTURE_SLACK_MS ? now : p.t);

/** This viewer's titles, most recently watched first. */
const newestFirst = (now: number) =>
  Object.values(load()).map((p) => ({ p, t: watchedAt(p, now) })).sort((a, b) => b.t - a.t);

/** Continue Watching: titles stopped part-way, newest first, one episode per
 *  show (the latest), as tiles. Episodes show their show's poster. */
export function continueWatching(limit = 30, sectionId?: string, now = Date.now()): PlexItem[] {
  const seenShows = new Set<string>();
  const out: PlexItem[] = [];
  for (const { p, t } of newestFirst(now)) {
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
    if (resumeSeconds(p.ratingKey) == null) continue;
    out.push({
      ratingKey: p.ratingKey,
      title: p.title,
      type: p.kind,
      thumb: `/library/metadata/${p.kind === 'episode' && p.showKey ? p.showKey : p.ratingKey}/thumb`,
      viewOffset: Math.floor(p.at * 1000),
      duration: Math.floor(p.dur * 1000),
      librarySectionID: p.librarySectionID,
      grandparentTitle: p.kind === 'episode' ? p.showTitle : undefined,
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
  const seen = new Set<string>();
  const out: FinishedShow[] = [];
  for (const { p, t } of newestFirst(now)) {
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
    let changed = false;
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
      const have = map[p.ratingKey];
      if (have && have.t >= t) continue;
      // The same sitting ending — the player closing, autoplay's next title —
      // must not take away the place this box kept from it.
      if (have && resumable(have) && (p.done || barelyStarted(p)) && t - have.t <= SAME_SITTING_MS) continue;
      map[p.ratingKey] = p; changed = true;
    }
    if (changed) save(map);
    return true;
  } catch { /* offline */ return false; }
}

/** Resolve the viewer early so the first reads are the right viewer's. */
export function initPlexProgress(): Promise<void> {
  // Signed in before this start (no change of viewer to hear), perhaps by a
  // version of the app that left the box's list behind: it comes over now.
  return resolveViewer().then(() => { const was = memo; memo = null; carryDeviceOver(was); emit(); });
}

/** Tests only. */
export function __resetPlexProgressForTests(v = 'device'): void {
  __setViewerForTests(v); memo = null; lastCloud.clear(); diagHeld = null;
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
