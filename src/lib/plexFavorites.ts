// My List: the Plex movies and shows a viewer saved, like Live TV favorites.
//
// Kept per viewer (see viewer.ts) on the box, and for a signed-in viewer also
// on the account (watch_history rows of kind 'plex_fav'), so the list follows
// them to another box. The account is the truth once it has answered: a title
// removed on one box goes from the others at their next pull, while one added
// here since the last pull is kept even if the account has not got it yet.
import { supabase } from '@/integrations/supabase/client';
import type { PlexItem } from '@/lib/plex';
import { cloudItemKey, fromCloudItemKey, onViewerChange, resolveViewer, scopeToProfile, viewerAccountConfirmed, viewerAccountId, viewerKey, __setViewerForTests } from '@/lib/viewer';

export interface PlexFavorite {
  ratingKey: string;
  type: 'movie' | 'show';
  title: string;
  year?: number;
  librarySectionID?: string;
  /** When it was added (ms since epoch). */
  t: number;
}

export const PLEX_FAVORITES_EVENT = 'plex-favorites:changed';
export const FAVORITE_KIND = 'plex_fav';
const PREFIX = 'snow-plex-favorites:';
const MAX = 300;

let memo: { viewer: string; map: Record<string, PlexFavorite>; pulledAt: number } | null = null;

const storeKey = (v: string) => PREFIX + v;

const load = () => {
  const viewer = viewerKey();
  if (memo && memo.viewer === viewer) return memo;
  let map: Record<string, PlexFavorite> = {};
  let pulledAt = 0;
  try {
    const parsed = JSON.parse(localStorage.getItem(storeKey(viewer)) || 'null') as { map?: Record<string, PlexFavorite>; pulledAt?: number } | null;
    if (parsed?.map && typeof parsed.map === 'object') map = parsed.map;
    pulledAt = Number(parsed?.pulledAt) || 0;
  } catch { /* start empty */ }
  memo = { viewer, map, pulledAt };
  return memo;
};

let emitTimer: number | null = null;
const emit = () => {
  if (emitTimer != null) return;
  emitTimer = window.setTimeout(() => {
    emitTimer = null;
    try { window.dispatchEvent(new CustomEvent(PLEX_FAVORITES_EVENT)); } catch { /* ignore */ }
  }, 0);
};

const save = (map: Record<string, PlexFavorite>, pulledAt?: number) => {
  const cur = load();
  const list = Object.values(map).sort((a, b) => b.t - a.t).slice(0, MAX);
  const trimmed: Record<string, PlexFavorite> = {};
  for (const f of list) trimmed[f.ratingKey] = f;
  memo = { viewer: cur.viewer, map: trimmed, pulledAt: pulledAt ?? cur.pulledAt };
  try { localStorage.setItem(storeKey(cur.viewer), JSON.stringify({ map: trimmed, pulledAt: memo.pulledAt })); } catch { /* full */ }
  emit();
};

onViewerChange(() => { memo = null; emit(); });

export function isFavorite(ratingKey: string): boolean {
  return !!load().map[ratingKey];
}

/** Add or remove a movie or show. Returns whether it is now on the list. */
export function toggleFavorite(item: Pick<PlexItem, 'ratingKey' | 'title' | 'type' | 'year' | 'librarySectionID'>): boolean {
  const key = String(item.ratingKey);
  const { map } = load();
  const next = { ...map };
  const adding = !next[key];
  if (adding) {
    next[key] = {
      ratingKey: key,
      type: item.type === 'show' ? 'show' : 'movie',
      title: item.title,
      year: item.year,
      librarySectionID: item.librarySectionID != null ? String(item.librarySectionID) : undefined,
      t: Date.now(),
    };
  } else {
    delete next[key];
  }
  save(next);
  const userId = viewerAccountId();
  if (userId) {
    const fav = next[key];
    const itemKey = cloudItemKey(key);
    void (async () => {
      try {
        if (fav) {
          await supabase.from('watch_history').upsert({
            user_id: userId, kind: FAVORITE_KIND, item_key: itemKey, title: fav.title,
            subtitle: fav.year ? String(fav.year) : null, poster: null,
            payload: JSON.parse(JSON.stringify(fav)), watched_at: new Date(fav.t).toISOString(), count: 1,
          }, { onConflict: 'user_id,kind,item_key' });
        } else {
          await supabase.from('watch_history').delete()
            .eq('user_id', userId).eq('kind', FAVORITE_KIND).eq('item_key', itemKey);
        }
      } catch { /* offline: the box keeps it; the next toggle or pull settles it */ }
    })();
  }
  return adding;
}

/** The list as poster tiles, newest first. */
export function myList(): PlexItem[] {
  return Object.values(load().map)
    .sort((a, b) => b.t - a.t)
    .map((f) => ({
      ratingKey: f.ratingKey,
      title: f.title,
      type: f.type,
      year: f.year,
      librarySectionID: f.librarySectionID,
      thumb: `/library/metadata/${f.ratingKey}/thumb`,
    }));
}

/** Bring the box up to date with the account. Call when Plex opens. */
export async function pullFavoritesFromCloud(): Promise<void> {
  await resolveViewer();
  const userId = viewerAccountId();
  // A session not refreshed yet reads as nobody: no rows, which would drop
  // the whole list here.
  if (!userId || !viewerAccountConfirmed()) return;
  const viewer = viewerKey();
  try {
    const { data, error } = await scopeToProfile(supabase
      .from('watch_history')
      .select('item_key,payload,watched_at')
      .eq('user_id', userId)
      .eq('kind', FAVORITE_KIND))
      .limit(MAX);
    if (error || !data || viewerKey() !== viewer) return;
    const cur = load();
    const map: Record<string, PlexFavorite> = {};
    for (const r of data) {
      const f = r.payload as unknown as PlexFavorite | null;
      if (f?.ratingKey && fromCloudItemKey(String(r.item_key)) === f.ratingKey) map[f.ratingKey] = f;
    }
    // Added here since the last pull and maybe not uploaded yet: keep.
    for (const f of Object.values(cur.map)) {
      if (!map[f.ratingKey] && f.t >= cur.pulledAt) map[f.ratingKey] = f;
    }
    save(map, Date.now());
  } catch { /* offline */ }
}

/** Tests only. */
export function __resetPlexFavoritesForTests(v = 'device'): void {
  __setViewerForTests(v); memo = null;
}
