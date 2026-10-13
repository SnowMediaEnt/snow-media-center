// "Recommend to others" in Plex: a viewer holds OK on a movie or show (or
// presses Recommend on its page) and the title joins Discover's "Recommended
// by viewers" row on every box that plays from the same Plex server.
//
// Saved on the Snow Media account (plex_recommendations, one row per account
// and title), so it needs a signed-in viewer; a Kids profile and the demo
// never recommend, and neither does anything adult. A ratingKey only means
// something on one Plex server, so every call names the server by its
// machineIdentifier (the connection's clientIdentifier), and the row is only
// ever read for that server.
//
// The list itself (plex_recommended) counts the last ninety days and never
// says who recommended what. The box keeps two small things: which titles
// this account recommended on this server, so the menu can say
// "Recommended ✓", and when this viewer last changed anything, so Discover
// asks again next time instead of replaying the row it kept.
// Nothing here throws.
import { supabase } from '@/integrations/supabase/client';
import type { PlexItem } from '@/lib/plex';
import { isAdultPlexItem } from '@/lib/adultContent';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { kidsLevel } from '@/lib/kidsFilter';
import { onViewerChange, resolveViewer, viewerAccountConfirmed, viewerAccountId } from '@/lib/viewer';

/** Fired after this viewer recommended a title or took one back. */
export const PLEX_RECOMMEND_EVENT = 'plex-recommend:changed';
/** Discover's row heading, as a translation key (translated when drawn). */
export const RECOMMENDED_TITLE_KEY = 'plex.discover.recommended';

/** What is saved for a title. */
export interface RecommendTarget {
  ratingKey: string;
  type: 'movie' | 'show';
  title: string;
  year?: number;
  /** The poster's path on the server, never a full address. */
  thumb?: string;
  contentRating?: string;
}

/** One title of the list, as plex_recommended returns it. */
export interface RecommendedRow {
  rating_key: string;
  type: string;
  title: string;
  year: number | null;
  thumb: string | null;
  content_rating: string | null;
  recommenders: number;
  last_recommended_at: string;
}

/** The answer to a recommend or a take-back. 'limit': the account's daily
 *  limit (50, server side). */
export type RecommendResult = 'ok' | 'signed_out' | 'limit' | 'error';

const TABLE = 'plex_recommendations';
const LIST_TIMEOUT_MS = 8000;
const RATING_KEY = /^\d{1,12}$/;

// ── where Plex is ───────────────────────────────────────────────────────────
// The server the box plays from and its adult libraries, set by PlexSection
// while Plex is open. With no server known nothing can be recommended.
let server: string | null = null;
let adultSections = new Set<string>();

export function setPlexRecommendContext(serverId: string | null | undefined, adultKeys?: Set<string>): void {
  server = serverId ? String(serverId) : null;
  adultSections = adultKeys ?? new Set<string>();
}

/** The machineIdentifier of the server the box plays from, or null. */
export const plexRecommendServer = (): string | null => server;

// ── which title, and may it be recommended ─────────────────────────────────

/** A path on the server only: no query (a token never belongs here), no
 *  address, nothing the table would refuse. */
const cleanThumb = (p: string | null | undefined): string | undefined => {
  if (!p || p.charAt(0) !== '/') return undefined;
  const path = p.split('?')[0];
  return path.length <= 300 && !/token|:\/\//i.test(path) ? path : undefined;
};
const cleanYear = (y: number | undefined): number | undefined =>
  (typeof y === 'number' && Number.isInteger(y) && y >= 1870 && y <= 2100 ? y : undefined);
const cleanRating = (r: string | undefined): string | undefined => (r && r.length <= 20 ? r : undefined);

/** The title a poster recommends: a movie or show itself, an episode its
 *  show (when the tile knows which). Null for anything else. */
export function recommendTarget(it: Pick<PlexItem, 'ratingKey' | 'type' | 'title' | 'year' | 'thumb' | 'contentRating' | 'grandparentRatingKey' | 'grandparentTitle'>): RecommendTarget | null {
  if (it.type === 'movie' || it.type === 'show') {
    const key = String(it.ratingKey ?? '');
    const title = (it.title || '').trim();
    if (!RATING_KEY.test(key) || !title) return null;
    return { ratingKey: key, type: it.type, title: title.slice(0, 300), year: cleanYear(it.year), thumb: cleanThumb(it.thumb), contentRating: cleanRating(it.contentRating) };
  }
  if (it.type === 'episode') {
    const key = String(it.grandparentRatingKey ?? '');
    const title = (it.grandparentTitle || '').trim();
    if (!RATING_KEY.test(key) || !title) return null;
    // The show's own poster; its year is not on an episode.
    return { ratingKey: key, type: 'show', title: title.slice(0, 300), thumb: `/library/metadata/${key}/thumb`, contentRating: cleanRating(it.contentRating) };
  }
  return null;
}

/** Whether a poster offers "Recommend to others": a movie or show (or an
 *  episode's show), on a known server, never on a Kids profile, in the demo,
 *  or for an adult title or library. Signed out still counts: the menu then
 *  says to sign in. */
export function canRecommend(it: PlexItem | null | undefined): boolean {
  if (!it || !server || isDemo() || kidsLevel()) return false;
  if (it.librarySectionID && adultSections.has(String(it.librarySectionID))) return false;
  if (isAdultPlexItem({ title: it.title, grandparentTitle: it.grandparentTitle, contentRating: it.contentRating, genres: it.genres })) return false;
  return recommendTarget(it) != null;
}

// ── this account's own ─────────────────────────────────────────────────────
// `${account}|${server}` and the keys this account recommended there.
let mine: { key: string; keys: Set<string> } | null = null;
let minePending: { key: string; p: Promise<Set<string> | null> } | null = null;
let changedAt = 0;

onViewerChange(() => { mine = null; minePending = null; });

/** The titles this account recommended on `serverId`, if already known. */
export function myRecommendedKeys(serverId: string): Set<string> | null {
  const acc = viewerAccountId();
  return acc && mine && mine.key === `${acc}|${serverId}` ? mine.keys : null;
}

/** The titles this account recommended on `serverId`, read once per account
 *  and server, then kept current here. Null when signed out or unreadable. */
export async function loadMyRecommended(serverId: string): Promise<Set<string> | null> {
  await resolveViewer();
  const acc = viewerAccountId();
  if (!acc || !serverId) return null;
  const key = `${acc}|${serverId}`;
  if (mine?.key === key) return mine.keys;
  if (minePending?.key === key) return minePending.p;
  const p = (async (): Promise<Set<string> | null> => {
    try {
      const { data, error } = await supabase.from(TABLE).select('rating_key')
        .eq('user_id', acc).eq('server_id', serverId).limit(2000);
      if (error || !Array.isArray(data)) return null;
      const keys = new Set(data.map((r) => String(r.rating_key)));
      // A session not refreshed yet reads as nobody's (no rows, no error):
      // that answer is used once, not kept.
      if (viewerAccountId() === acc && viewerAccountConfirmed()) mine = { key, keys };
      return keys;
    } catch {
      return null;
    }
  })();
  minePending = { key, p };
  void p.then(() => { if (minePending?.p === p) minePending = null; });
  return p;
}

/** When this viewer last recommended or took back a title (ms), 0 if never. */
export const plexRecommendChangedAt = (): number => changedAt;

const noteChange = (serverId: string, ratingKey: string, on: boolean) => {
  changedAt = Date.now();
  const acc = viewerAccountId();
  if (acc && mine?.key === `${acc}|${serverId}`) {
    const keys = new Set(mine.keys);
    if (on) keys.add(ratingKey); else keys.delete(ratingKey);
    mine = { key: mine.key, keys };
  }
  try { window.dispatchEvent(new CustomEvent(PLEX_RECOMMEND_EVENT)); } catch { /* ignore */ }
};

/** Recommend a title to the other viewers of `serverId`. */
export async function recommendTitle(serverId: string, target: RecommendTarget): Promise<RecommendResult> {
  await resolveViewer();
  const acc = viewerAccountId();
  if (!acc) return 'signed_out';
  try {
    const { error } = await supabase.from(TABLE).insert({
      user_id: acc,
      server_id: serverId,
      rating_key: target.ratingKey,
      type: target.type,
      title: target.title,
      year: target.year ?? null,
      thumb: target.thumb ?? null,
      content_rating: target.contentRating ?? null,
    });
    // 23505: already there (recommended from another box), which is what
    // was asked for.
    if (error && error.code !== '23505') return /daily_limit/.test(error.message || '') ? 'limit' : 'error';
  } catch {
    return 'error';
  }
  noteChange(serverId, target.ratingKey, true);
  try { trackEvent('plex_recommend', 'player', { action: 'add', type: target.type }); } catch { /* ignore */ }
  return 'ok';
}

/** Take back this account's recommendation of a title on `serverId`. */
export async function unrecommendTitle(serverId: string, ratingKey: string): Promise<RecommendResult> {
  await resolveViewer();
  const acc = viewerAccountId();
  if (!acc) return 'signed_out';
  try {
    const { error } = await supabase.from(TABLE).delete()
      .eq('user_id', acc).eq('server_id', serverId).eq('rating_key', ratingKey);
    if (error) return 'error';
  } catch {
    return 'error';
  }
  noteChange(serverId, ratingKey, false);
  try { trackEvent('plex_recommend', 'player', { action: 'remove' }); } catch { /* ignore */ }
  return 'ok';
}

// ── the list ───────────────────────────────────────────────────────────────

/** The titles recommended on `serverId` (plex_recommended): most
 *  recommenders first. Null when it could not be read, so the caller does
 *  not keep an empty answer that was only a failure. */
export async function fetchRecommended(serverId: string, limit = 24): Promise<RecommendedRow[] | null> {
  if (!serverId) return null;
  try {
    const call = supabase.rpc('plex_recommended', { p_server: serverId, p_limit: limit });
    const timeout = new Promise<null>((r) => { window.setTimeout(() => r(null), LIST_TIMEOUT_MS); });
    const res = await Promise.race([call, timeout]);
    if (!res || res.error || !Array.isArray(res.data)) return null;
    return res.data as RecommendedRow[];
  } catch {
    return null;
  }
}

/** The list as poster tiles, in its order, each with its count. Anything
 *  that is not a movie or show under a plain ratingKey is skipped. */
export function recommendedItems(rows: RecommendedRow[] | null | undefined): PlexItem[] {
  const out: PlexItem[] = [];
  const seen = new Set<string>();
  for (const r of rows ?? []) {
    const key = String(r?.rating_key ?? '');
    if (!RATING_KEY.test(key) || seen.has(key) || (r.type !== 'movie' && r.type !== 'show')) continue;
    seen.add(key);
    out.push({
      ratingKey: key,
      type: r.type,
      title: String(r.title || ''),
      year: typeof r.year === 'number' ? r.year : undefined,
      thumb: cleanThumb(r.thumb) ?? `/library/metadata/${key}/thumb`,
      contentRating: r.content_rating || undefined,
      recommenders: Math.max(1, Math.floor(Number(r.recommenders)) || 1),
    });
  }
  return out;
}

/** Tests only. */
export function __resetPlexRecommendForTests(): void {
  server = null; adultSections = new Set(); mine = null; minePending = null; changedAt = 0;
}
