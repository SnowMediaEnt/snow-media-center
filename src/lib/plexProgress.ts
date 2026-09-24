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
import { __setViewerForTests, cloudItemKey, fromCloudItemKey, onViewerChange, resolveViewer, scopeToProfile, viewerAccountId, viewerKey } from '@/lib/viewer';

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

// A change of viewer (sign-in, sign-out) means another viewer's list.
onViewerChange(() => { memo = null; emit(); });

let memo: { viewer: string; map: Record<string, PlexProgress> } | null = null;

const load = (): Record<string, PlexProgress> => {
  const viewer = viewerKey();
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
  const viewer = viewerKey();
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
  const userId = viewerAccountId();
  if (!userId) return;
  const now = Date.now();
  const itemKey = cloudItemKey(p.ratingKey);
  if (!force && now - (lastCloud.get(itemKey) ?? 0) < CLOUD_EVERY_MS) return;
  lastCloud.set(itemKey, now);
  void (async () => {
    try {
      await supabase.from('watch_history').upsert({
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
      lastViewedAt: p.t,
    });
  }
  return out;
}

/** Fold the account's copy into this box (newest wins). Call on Plex open. */
export async function pullProgressFromCloud(): Promise<void> {
  await resolveViewer();
  const userId = viewerAccountId();
  if (!userId) return;
  const viewer = viewerKey();
  try {
    const { data, error } = await scopeToProfile(supabase
      .from('watch_history')
      .select('item_key,payload,watched_at')
      .eq('user_id', userId)
      .eq('kind', PROGRESS_KIND))
      .order('watched_at', { ascending: false })
      .limit(MAX);
    if (error || !data || viewerKey() !== viewer) return;
    const map = { ...load() };
    let changed = false;
    for (const r of data) {
      const p = r.payload as unknown as PlexProgress | null;
      if (!p || !p.ratingKey || !(p.dur > 0)) continue;
      if (fromCloudItemKey(String(r.item_key)) !== p.ratingKey) continue;
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
  __setViewerForTests(v); memo = null; lastCloud.clear();
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
