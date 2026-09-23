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

export async function overseerrRequest(item: Pick<OverseerrItem, 'id' | 'mediaType'>): Promise<OverseerrRequestResult> {
  try {
    const { data, error } = await supabase.functions.invoke('overseerr-request', {
      body: { action: 'request', mediaType: item.mediaType, tmdbId: item.id },
    });
    if (error) return 'failed';
    if (data?.ok) return 'requested';
    if (data?.already) return 'already';
    return 'failed';
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
