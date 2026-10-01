// Snow Originals: the owner's own short videos, uploaded in the Snow Media Hub
// and shown in Live TV › Snow Originals. The table is public.snow_originals
// and the files live in the public `snow-originals` bucket (migration
// 20261001060000_snow_originals.sql).
//
// The list is small and changes rarely, so it is fetched once on entering the
// section (not polled, no realtime) and kept in localStorage: a second visit
// within a minute asks nothing, and a box that has lost its connection still
// shows the last list it had for a week.
import { supabase } from '@/integrations/supabase/client';
import { kidsLevel, type KidsLevel } from '@/lib/kidsFilter';

export const ORIGINALS_BUCKET = 'snow-originals';

export interface SnowOriginalRow {
  id: string;
  title: string;
  description: string | null;
  video_path: string;
  poster_path: string | null;
  backdrop_path: string | null;
  duration_sec: number;
  width: number;
  height: number;
  orientation: 'portrait' | 'landscape';
  kid_friendly: boolean;
  published: boolean;
  published_at: string | null;
  sort: number;
  created_at: string;
}

export interface SnowOriginal {
  id: string;
  title: string;
  description: string | null;
  videoUrl: string;
  posterUrl: string | null;
  backdropUrl: string | null;
  durationSec: number;
  width: number;
  height: number;
  portrait: boolean;
  kidFriendly: boolean;
  publishedAt: string | null;
  createdAt: string;
  sort: number;
}

/** What the section hands the player (src/components/livetv/OriginalsPlayer.tsx, default export).
 *  `items` is the list the viewer sees, already Kids-filtered and in order. */
export interface OriginalsPlayerProps {
  items: SnowOriginal[];
  startId: string;
  onClose: (lastId: string) => void;
}

// Every column the box needs; created_by (a staff member's id) stays in the Hub.
const SELECT = 'id,title,description,video_path,poster_path,backdrop_path,duration_sec,width,height,orientation,kid_friendly,published,published_at,sort,created_at';

const CACHE_KEY = 'smc-originals-v1';
/** A list newer than this is not asked for again on entering the section. */
export const FRESH_MS = 60_000;
/** How long a saved list is still shown when the box can't reach the server. */
export const KEEP_MS = 7 * 24 * 60 * 60_000;
/** A video published within this long gets the New chip. */
export const NEW_MS = 7 * 24 * 60 * 60_000;

/** Builds the URL without a network call. */
const publicUrl = (path: string): string => supabase.storage.from(ORIGINALS_BUCKET).getPublicUrl(path).data.publicUrl;

/** One row as the screens use it, or null for a row that can't play (no file, no size). */
export function toOriginal(row: SnowOriginalRow): SnowOriginal | null {
  if (!row || !row.id || !row.video_path) return null;
  const width = Number(row.width);
  const height = Number(row.height);
  if (!(width > 0) || !(height > 0)) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    videoUrl: publicUrl(row.video_path),
    posterUrl: row.poster_path ? publicUrl(row.poster_path) : null,
    backdropUrl: row.backdrop_path ? publicUrl(row.backdrop_path) : null,
    durationSec: Number(row.duration_sec) || 0,
    width,
    height,
    portrait: height > width,
    kidFriendly: !!row.kid_friendly,
    publishedAt: row.published_at ?? null,
    createdAt: row.created_at,
    sort: Number(row.sort) || 0,
  };
}

export const toOriginals = (rows: SnowOriginalRow[]): SnowOriginal[] =>
  rows.map(toOriginal).filter((o): o is SnowOriginal => o !== null);

/** The database's `orientation` is a generated column, typed `string | null`:
 *  a value that is not one of the two falls back to the stored size. */
export function orientationOf(r: { orientation: string | null; width: number; height: number }): 'portrait' | 'landscape' {
  if (r.orientation === 'portrait' || r.orientation === 'landscape') return r.orientation;
  return Number(r.height) > Number(r.width) ? 'portrait' : 'landscape';
}

/** The published videos, in the Hub's order. Throws when the server can't be reached. */
export async function fetchOriginals(): Promise<SnowOriginalRow[]> {
  // Always ask for published rows only: a box signed in as staff would
  // otherwise be handed the drafts too (the admin policy reads every row).
  const { data, error } = await supabase
    .from('snow_originals')
    .select(SELECT)
    .eq('published', true)
    .order('sort', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, orientation: orientationOf(r) }));
}

export interface OriginalsCache { at: number; rows: SnowOriginalRow[] }

/** The saved list, or null when there is none, it is over a week old, or storage is unusable. */
export function loadCachedOriginals(now = Date.now()): OriginalsCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as OriginalsCache;
    if (!c || typeof c.at !== 'number' || !Array.isArray(c.rows)) return null;
    if (now - c.at > KEEP_MS) return null;
    return c;
  } catch {
    return null;
  }
}

export function saveCachedOriginals(rows: SnowOriginalRow[], now = Date.now()): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, rows })); } catch { /* full or blocked: next visit asks again */ }
}

/** The videos this profile may see. Little and Kids profiles see only the
 *  kid-friendly ones; Teens and grown-ups see them all (owner's choice). */
export function forViewer(list: SnowOriginal[], level: KidsLevel | null = kidsLevel()): SnowOriginal[] {
  if (level === 'little' || level === 'kids') return list.filter((o) => o.kidFriendly);
  return list;
}

/** Whether the profile's list is narrowed to kid-friendly videos. */
export const kidsOnly = (level: KidsLevel | null = kidsLevel()): boolean => level === 'little' || level === 'kids';

/** Published (or, failing that, added) within the last 7 days. */
export function isNew(item: Pick<SnowOriginal, 'publishedAt' | 'createdAt'>, now = Date.now()): boolean {
  const at = Date.parse(item.publishedAt ?? item.createdAt);
  if (!Number.isFinite(at)) return false;
  return now - at < NEW_MS;
}

/** "1:05" or "1:02:03": digits only, the same in every language. */
export function fmtDuration(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
