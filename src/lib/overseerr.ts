// Requests through Snow Media's Overseerr, via the overseerr-request edge
// function (the API key never leaves the server). Movies and shows are both
// approved automatically; a show is requested with every season.
import { supabase } from '@/integrations/supabase/client';

export interface OverseerrItem {
  id: number;               // TMDB id
  mediaType: 'movie' | 'tv';
  title: string;
  year: string | null;
  posterUrl: string | null;
  /** 0/1 not requested, 2 pending, 3 processing, 4 partly available, 5 available */
  status: number;
  overview?: string;
}

// ── "Tell me when it's here" ──────────────────────────────────────────────
// A private random key per install identifies this box's requests (never the
// analytics device id). While any request is open, the pending flag is set:
// the app checks on launch / Plex open, and the native alert job checks every
// five minutes, so the TV hears about it even with the app closed.
const KEY_STORE = 'smc-request-key';
const PENDING_STORE = 'smc-request-pending';

export function requestKey(): string {
  try {
    const have = localStorage.getItem(KEY_STORE);
    if (have && /^[A-Za-z0-9_-]{24,128}$/.test(have)) return have;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const k = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY_STORE, k);
    return k;
  } catch {
    return '';
  }
}

export const hasPendingRequests = (): boolean => {
  try { return localStorage.getItem(PENDING_STORE) === '1'; } catch { return false; }
};

async function setPending(pending: boolean): Promise<void> {
  try {
    if (pending) localStorage.setItem(PENDING_STORE, '1');
    else localStorage.removeItem(PENDING_STORE);
  } catch { /* ignore */ }
  // Let the native alert job know whether to ask (Android build only).
  try {
    const { SnowNotify, deviceAlertsSupported } = await import('@/capacitor/SnowNotify');
    if (deviceAlertsSupported()) await SnowNotify.watchRequests({ deviceKey: requestKey(), pending });
  } catch { /* older native build without watchRequests: the app still checks */ }
}

export interface ReadyRequest { tmdbId: number; mediaType: 'movie' | 'tv'; title: string; posterUrl: string | null }

/** Requests from this box that have arrived since the last check (each once). */
export async function checkRequests(): Promise<ReadyRequest[]> {
  const deviceKey = requestKey();
  if (!deviceKey) return [];
  try {
    const { data, error } = await supabase.functions.invoke('overseerr-request', { body: { action: 'check', deviceKey } });
    if (error || !data) return [];
    await setPending((data.pending ?? 0) > 0);
    return (data.ready ?? []) as ReadyRequest[];
  } catch {
    return [];
  }
}

export async function overseerrSearch(query: string): Promise<OverseerrItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const { data, error } = await supabase.functions.invoke('overseerr-request', { body: { action: 'search', query: q } });
    if (error || !data?.results) return [];
    return data.results as OverseerrItem[];
  } catch {
    return [];
  }
}

export type OverseerrRequestResult = 'requested' | 'already' | 'failed';

export async function overseerrRequest(item: Pick<OverseerrItem, 'id' | 'mediaType' | 'title' | 'posterUrl'>): Promise<OverseerrRequestResult> {
  try {
    const { data, error } = await supabase.functions.invoke('overseerr-request', {
      body: {
        action: 'request', mediaType: item.mediaType, tmdbId: item.id,
        deviceKey: requestKey(), title: item.title, posterUrl: item.posterUrl,
      },
    });
    if (error) return 'failed';
    const res: OverseerrRequestResult = data?.ok ? 'requested' : data?.already ? 'already' : 'failed';
    if (res !== 'failed') void setPending(true);
    return res;
  } catch {
    return 'failed';
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** What Overseerr found that this Plex server does not have yet. */
export function missingFromPlex(
  found: OverseerrItem[],
  plex: Array<{ title: string; year?: number | string | null }>,
  max: number,
): OverseerrItem[] {
  const have = new Set(plex.map((p) => `${norm(p.title)}|${p.year ?? ''}`));
  const haveTitle = new Set(plex.map((p) => norm(p.title)));
  return found
    .filter((it) => it.status !== 5)
    .filter((it) => !have.has(`${norm(it.title)}|${it.year ?? ''}`) && !(it.year == null && haveTitle.has(norm(it.title))))
    .slice(0, max);
}
