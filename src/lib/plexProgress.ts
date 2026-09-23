// Where each viewer stopped in each Plex title: their own resume points,
// "Continue Watching", progress bars and "watched" ticks.
//
// Not Plex's: every box signs into Plex through the same provider account
// (see plex-provider-token), so the server's resume points and On Deck are
// everyone's viewing mixed together. These are kept per viewer — the signed-in
// Snow Media account, else the box — on the device, and mirrored to the
// account (watch_history rows of kind 'plex_progress') so they follow the
// viewer to another box.
//
// Nothing here is on the playback path: every write is fire and forget and
// every storage or network failure is swallowed.
import { supabase } from '@/integrations/supabase/client';
import type { PlexItem } from '@/lib/plex';

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
/** The first and last minute are not a place to resume from. */
const EDGE_S = 60;
/** Past this share of the running time a title counts as watched. */
const DONE_SHARE = 0.92;
/** Cloud copies at most this often per title while it plays. */
const CLOUD_EVERY_MS = 60_000;

let viewer = 'device';
let viewerResolved: Promise<void> | null = null;

/** The viewer: the Snow Media user id when signed in, else the box. */
function resolveViewer(): Promise<void> {
  viewerResolved ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      viewer = data.session?.user?.id ?? 'device';
    } catch { viewer = 'device'; }
    try {
      supabase.auth.onAuthStateChange((_e, session) => {
        const next = session?.user?.id ?? 'device';
        if (next === viewer) return;
        viewer = next;
        memo = null;
        emit();
      });
    } catch { /* no auth in this build */ }
  })();
  return viewerResolved;
}

let memo: { viewer: string; map: Record<string, PlexProgress> } | null = null;

const load = (): Record<string, PlexProgress> => {
  if (memo && memo.viewer === viewer) return memo.map;
  let map: Record<string, PlexProgress> = {};
  try {
    const raw = localStorage.getItem(PREFIX + viewer);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') map = parsed as Record<string, PlexProgress>;
  } catch { /* start empty */ }
  memo = { viewer, map };
  return map;
};

const save = (map: Record<string, PlexProgress>) => {
  // Keep the newest MAX.
  const list = Object.values(map).sort((a, b) => b.t - a.t).slice(0, MAX);
  const trimmed: Record<string, PlexProgress> = {};
  for (const p of list) trimmed[p.ratingKey] = p;
  memo = { viewer, map: trimmed };
  try { localStorage.setItem(PREFIX + viewer, JSON.stringify(trimmed)); } catch { /* full or unavailable */ }
  emit();
};

let emitTimer: number | null = null;
const emit = () => {
  if (emitTimer != null) return;
  emitTimer = window.setTimeout(() => {
    emitTimer = null;
    try { window.dispatchEvent(new CustomEvent(PLEX_PROGRESS_EVENT)); } catch { /* ignore */ }
  }, 0);
};

const lastCloud = new Map<string, number>();
const toCloud = (p: PlexProgress, force: boolean) => {
  if (viewer === 'device') return;
  const now = Date.now();
  if (!force && now - (lastCloud.get(p.ratingKey) ?? 0) < CLOUD_EVERY_MS) return;
  lastCloud.set(p.ratingKey, now);
  const userId = viewer;
  void (async () => {
    try {
      await supabase.from('watch_history').upsert({
        user_id: userId,
        kind: PROGRESS_KIND,
        item_key: p.ratingKey,
        title: p.title,
        subtitle: p.showTitle ?? null,
        poster: null,
        payload: JSON.parse(JSON.stringify(p)),
        watched_at: new Date(p.t).toISOString(),
        count: 1,
      }, { onConflict: 'user_id,kind,item_key' });
    } catch { /* offline: the box keeps it */ }
  })();
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
  });
}

export function getProgress(ratingKey: string): PlexProgress | null {
  return load()[ratingKey] ?? null;
}

/** Seconds to resume from, or undefined: not started, the first or last
 *  minute, or watched. */
export function resumeSeconds(ratingKey: string): number | undefined {
  const p = getProgress(ratingKey);
  if (!p || p.done || p.at < EDGE_S || p.at > p.dur - EDGE_S) return undefined;
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

/** Continue Watching: titles stopped part-way, newest first, one episode per
 *  show (the latest), as tiles. Episodes show their show's poster. */
export function continueWatching(limit = 30, sectionId?: string): PlexItem[] {
  const seenShows = new Set<string>();
  const out: PlexItem[] = [];
  const list = Object.values(load()).sort((a, b) => b.t - a.t);
  for (const p of list) {
    if (out.length >= limit) break;
    if (sectionId && p.librarySectionID !== sectionId) continue;
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
    });
  }
  return out;
}

/** Fold the account's copy into this box (newest wins). Call on Plex open. */
export async function pullProgressFromCloud(): Promise<void> {
  await resolveViewer();
  if (viewer === 'device') return;
  const userId = viewer;
  try {
    const { data, error } = await supabase
      .from('watch_history')
      .select('item_key,payload,watched_at')
      .eq('user_id', userId)
      .eq('kind', PROGRESS_KIND)
      .order('watched_at', { ascending: false })
      .limit(MAX);
    if (error || !data || viewer !== userId) return;
    const map = { ...load() };
    let changed = false;
    for (const r of data) {
      const p = r.payload as unknown as PlexProgress | null;
      if (!p || !p.ratingKey || !(p.dur > 0)) continue;
      const t = Date.parse(String(r.watched_at)) || p.t || 0;
      const have = map[p.ratingKey];
      if (!have || have.t < t) { map[p.ratingKey] = { ...p, t }; changed = true; }
    }
    if (changed) save(map);
  } catch { /* offline */ }
}

/** Resolve the viewer early so the first reads are the right viewer's. */
export function initPlexProgress(): Promise<void> {
  return resolveViewer().then(() => { memo = null; emit(); });
}

/** Tests only. */
export function __resetPlexProgressForTests(v = 'device'): void {
  viewer = v; memo = null; viewerResolved = Promise.resolve(); lastCloud.clear();
}
