// What this viewer has watched: channels in Live TV and titles in Plex.
//
// Kept on the device per viewer — the signed-in Snow Media account when there
// is one, otherwise the box itself — and mirrored to the account's row in
// `watch_history` so it follows them to another device. The content bar reads
// it to build "continue watching", pick the live channels to show, and ask
// Plex for titles like the ones they watched.
//
// Nothing here is on the critical path of playback: recording is fire and
// forget, and every storage or network failure is swallowed.
import { supabase } from '@/integrations/supabase/client';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import type { PlexItem } from '@/lib/plex';
import { cloudItemKey, fromCloudItemKey, resolveViewer, scopeToProfile, viewerAccountId, viewerKey } from '@/lib/viewer';

export type WatchKind = 'channel' | 'plex';

export interface WatchEntry {
  kind: WatchKind;
  /** Stable id: `host|username|stream_id` for a channel, the ratingKey for Plex. */
  key: string;
  title: string;
  subtitle?: string;
  poster?: string;
  watchedAt: number;
  count: number;
  channel?: { host: string; username: string; streamId: number; categoryId?: string; num?: number; icon?: string; serverLabel?: string };
  plex?: { ratingKey: string; librarySectionID?: string; kind?: string; thumb?: string };
}

export const WATCH_HISTORY_EVENT = 'watch-history:changed';
const PREFIX = 'snow-watch-history:';
const MAX = 60;

const storageKey = (viewer: string) => `${PREFIX}${viewer}`;

/** The viewer key (see viewer.ts): the Snow Media account when signed in,
 *  else the box, plus the profile picked on it. Read now, not the key from the
 *  first resolve: a sign-in, sign-out or profile switch since then counts. */
export async function currentViewer(): Promise<string> {
  await resolveViewer();
  return viewerKey();
}

export const loadWatchHistory = (viewer: string): WatchEntry[] => {
  try {
    const raw = localStorage.getItem(storageKey(viewer));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as WatchEntry[]).filter((e) => e && e.kind && e.key && e.title) : [];
  } catch { return []; }
};

const saveWatchHistory = (viewer: string, entries: WatchEntry[]): void => {
  try { localStorage.setItem(storageKey(viewer), JSON.stringify(entries.slice(0, MAX))); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(WATCH_HISTORY_EVENT, { detail: viewer })); } catch { /* ignore */ }
};

/** Newest first, one row per key, counts preserved across repeats. */
const mergeEntry = (entries: WatchEntry[], entry: WatchEntry): WatchEntry[] => {
  const prev = entries.find((e) => e.kind === entry.kind && e.key === entry.key);
  const next: WatchEntry = { ...entry, count: (prev?.count ?? 0) + (entry.count || 1) };
  return [next, ...entries.filter((e) => !(e.kind === entry.kind && e.key === entry.key))].slice(0, MAX);
};

const cloudUpsert = async (userId: string, entry: WatchEntry): Promise<void> => {
  try {
    await supabase.from('watch_history').upsert({
      user_id: userId,
      kind: entry.kind,
      item_key: cloudItemKey(entry.key),
      title: entry.title,
      subtitle: entry.subtitle ?? null,
      poster: entry.poster ?? null,
      payload: JSON.parse(JSON.stringify(entry.channel ?? entry.plex ?? {})),
      watched_at: new Date(entry.watchedAt).toISOString(),
      count: entry.count,
    }, { onConflict: 'user_id,kind,item_key' });
  } catch { /* the table may not exist yet, or we are offline — local is enough */ }
};

async function record(entry: Omit<WatchEntry, 'watchedAt' | 'count'>): Promise<void> {
  const viewer = await currentViewer();
  const full: WatchEntry = { ...entry, watchedAt: Date.now(), count: 1 };
  const merged = mergeEntry(loadWatchHistory(viewer), full);
  saveWatchHistory(viewer, merged);
  const account = viewerAccountId();
  if (account && viewerKey() === viewer) {
    const stored = merged.find((e) => e.kind === full.kind && e.key === full.key) ?? full;
    void cloudUpsert(account, stored);
  }
}

// Rows taken off on the box whose delete on the account has not gone through
// yet (offline): the next pull from the account must not bring them back,
// and sends the delete again. Per viewer, item key -> when it was removed.
const REMOVED_PREFIX = 'snow-watch-removed:';
type Removed = Record<string, number>;
const removedKey = (kind: WatchKind, key: string) => `${kind}:${key}`;
const loadRemoved = (viewer: string): Removed => {
  try {
    const o = JSON.parse(localStorage.getItem(`${REMOVED_PREFIX}${viewer}`) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Removed) : {};
  } catch { return {}; }
};
const saveRemoved = (viewer: string, r: Removed): void => {
  try {
    if (Object.keys(r).length) localStorage.setItem(`${REMOVED_PREFIX}${viewer}`, JSON.stringify(r));
    else localStorage.removeItem(`${REMOVED_PREFIX}${viewer}`);
  } catch { /* ignore */ }
};

/** The account's row, as it stood when it was removed (a newer play on
 *  another box stays). True when the account has it gone. */
const cloudRemove = async (userId: string, kind: WatchKind, key: string, before: number): Promise<boolean> => {
  try {
    const { error } = await supabase.from('watch_history').delete()
      .eq('user_id', userId).eq('kind', kind).eq('item_key', cloudItemKey(key))
      .lte('watched_at', new Date(before).toISOString());
    return !error;
  } catch { return false; }
};

/**
 * Take ONE entry off Recently watched (Live TV's Recently watched panel: a
 * channel, not the whole history), on the box at once and on the account.
 * Offline, the account's delete waits for the next pull (see Removed above).
 */
export async function removeWatchEntry(kind: WatchKind, key: string): Promise<void> {
  const viewer = await currentViewer().catch(() => viewerKey());
  const list = loadWatchHistory(viewer);
  const next = list.filter((e) => !(e.kind === kind && e.key === key));
  if (next.length !== list.length) saveWatchHistory(viewer, next);
  const account = viewerAccountId();
  if (!account || viewerKey() !== viewer) return;
  const at = Date.now();
  if (await cloudRemove(account, kind, key, at)) return;
  saveRemoved(viewer, { ...loadRemoved(viewer), [removedKey(kind, key)]: at });
}

export const channelKey = (line: XtreamCreds, streamId: number): string =>
  `${line.host.replace(/^https?:\/\//, '')}|${line.username}|${streamId}`;

export function recordChannelWatch(stream: XtreamLiveStream, line: XtreamCreds, categoryName?: string): void {
  void record({
    kind: 'channel',
    key: channelKey(line, stream.stream_id),
    title: stream.name,
    subtitle: categoryName || line.serverLabel,
    poster: stream.stream_icon || undefined,
    channel: {
      host: line.host, username: line.username, streamId: stream.stream_id,
      categoryId: stream.category_id, num: stream.num, icon: stream.stream_icon || undefined, serverLabel: line.serverLabel,
    },
  });
}

export function recordPlexWatch(item: Pick<PlexItem, 'ratingKey' | 'title' | 'type' | 'thumb' | 'librarySectionID' | 'year' | 'grandparentTitle'>, posterUrl?: string): void {
  const kind = item.type || 'movie';
  void record({
    kind: 'plex',
    key: String(item.ratingKey),
    title: kind === 'episode' && item.grandparentTitle ? item.grandparentTitle : item.title,
    subtitle: kind === 'episode' ? item.title : (item.year ? String(item.year) : undefined),
    poster: posterUrl,
    plex: { ratingKey: String(item.ratingKey), librarySectionID: item.librarySectionID, kind, thumb: item.thumb },
  });
}

/** Pull the account's rows for this viewer (the current profile's) and fold
 *  them into the local list (newest wins). `viewer` is currentViewer(). */
export async function syncWatchHistoryFromCloud(viewer: string): Promise<WatchEntry[]> {
  const local = loadWatchHistory(viewer);
  const userId = viewerAccountId();
  if (!userId || viewerKey() !== viewer) return local;
  try {
    const { data, error } = await scopeToProfile(supabase
      .from('watch_history')
      .select('kind,item_key,title,subtitle,poster,payload,watched_at,count')
      .eq('user_id', userId)
      // The same table holds Plex resume points (kind 'plex_progress', see
      // plexProgress); only watched channels and titles belong here.
      .in('kind', ['channel', 'plex']))
      .order('watched_at', { ascending: false })
      .limit(MAX);
    if (error || !data || viewerKey() !== viewer) return local;
    // Removed on the box while the account could not be told: kept off, and
    // the delete sent again.
    const removed = loadRemoved(viewer);
    if (Object.keys(removed).length) {
      const left: Removed = {};
      for (const [rk, at] of Object.entries(removed)) {
        const i = rk.indexOf(':');
        if (!(await cloudRemove(userId, rk.slice(0, i) as WatchKind, rk.slice(i + 1), at))) left[rk] = at;
      }
      saveRemoved(viewer, left);
    }
    const byKey = new Map<string, WatchEntry>();
    for (const e of local) byKey.set(`${e.kind}:${e.key}`, e);
    for (const r of data) {
      const kind = r.kind as WatchKind;
      const itemKey = fromCloudItemKey(String(r.item_key));
      if (itemKey == null) continue;
      const entry: WatchEntry = {
        kind,
        key: itemKey,
        title: String(r.title),
        subtitle: r.subtitle ?? undefined,
        poster: r.poster ?? undefined,
        watchedAt: Date.parse(String(r.watched_at)) || 0,
        count: Number(r.count) || 1,
        ...(kind === 'channel' ? { channel: r.payload as WatchEntry['channel'] } : { plex: r.payload as WatchEntry['plex'] }),
      };
      const k = `${kind}:${entry.key}`;
      if ((removed[removedKey(kind, entry.key)] ?? 0) >= entry.watchedAt) continue;
      const have = byKey.get(k);
      if (!have || have.watchedAt < entry.watchedAt) byKey.set(k, entry);
    }
    const merged = Array.from(byKey.values()).sort((a, b) => b.watchedAt - a.watchedAt).slice(0, MAX);
    try { localStorage.setItem(storageKey(viewer), JSON.stringify(merged)); } catch { /* ignore */ }
    return merged;
  } catch {
    return local;
  }
}
