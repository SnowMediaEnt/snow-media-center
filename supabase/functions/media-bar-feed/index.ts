// Aggregates Plex (Recently Added + On Deck), TMDB trending, and TheSportsDB
// today's events into a single scrolling-bar payload.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const TMDB_KEY = Deno.env.get('TMDB_API_KEY') ?? '';
const SPORTSDB_KEY = '123'; // Free tier

type Item = {
  id: string;
  source: 'plex' | 'tmdb' | 'sports';
  kind: string; // movie | show | episode | sport
  title: string;
  subtitle?: string;
  poster?: string;
  deepLink?: string;
  startTime?: string;
};

const safe = async <T>(p: Promise<T>, label: string): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    console.warn(`[media-bar-feed] ${label} failed:`, (e as Error).message);
    return null;
  }
};

const plexFetch = async (path: string) => {
  if (!PLEX_URL || !PLEX_TOKEN) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PLEX_URL}${path}${sep}X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Plex ${res.status}`);
  return await res.json();
};

const plexImage = (key?: string) =>
  key && PLEX_URL ? `${PLEX_URL}${key}?X-Plex-Token=${PLEX_TOKEN}` : undefined;

const plexDeepLink = (ratingKey?: string) =>
  ratingKey ? `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${ratingKey}` : undefined;

const fetchPlex = async (): Promise<Item[]> => {
  const items: Item[] = [];
  // Recently Added
  const recent = await safe(plexFetch('/library/recentlyAdded?X-Plex-Container-Size=15'), 'plex recent');
  for (const m of recent?.MediaContainer?.Metadata ?? []) {
    items.push({
      id: `plex-${m.ratingKey}`,
      source: 'plex',
      kind: m.type === 'episode' ? 'episode' : m.type ?? 'movie',
      title: m.title ?? 'Untitled',
      subtitle: m.grandparentTitle ?? (m.year ? String(m.year) : 'Recently Added'),
      poster: plexImage(m.thumb ?? m.parentThumb ?? m.grandparentThumb),
      deepLink: plexDeepLink(m.ratingKey),
    });
  }
  // On Deck
  const onDeck = await safe(plexFetch('/library/onDeck?X-Plex-Container-Size=10'), 'plex onDeck');
  for (const m of onDeck?.MediaContainer?.Metadata ?? []) {
    items.push({
      id: `plex-deck-${m.ratingKey}`,
      source: 'plex',
      kind: m.type ?? 'episode',
      title: m.grandparentTitle ?? m.title ?? 'Continue Watching',
      subtitle: m.grandparentTitle ? `S${m.parentIndex}·E${m.index} ${m.title ?? ''}`.trim() : 'Continue Watching',
      poster: plexImage(m.grandparentThumb ?? m.thumb ?? m.parentThumb),
      deepLink: plexDeepLink(m.ratingKey),
    });
  }
  return items;
};

const fetchTMDB = async (): Promise<Item[]> => {
  if (!TMDB_KEY) return [];
  const url = `https://api.themoviedb.org/3/trending/all/day?api_key=${TMDB_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  const data = await res.json();
  return (data.results ?? []).slice(0, 15).map((r: any) => ({
    id: `tmdb-${r.id}`,
    source: 'tmdb' as const,
    kind: r.media_type === 'tv' ? 'show' : 'movie',
    title: r.title ?? r.name ?? 'Trending',
    subtitle: r.media_type === 'tv' ? 'Trending Show' : 'Trending Movie',
    poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : undefined,
  }));
};

const fetchSports = async (): Promise<Item[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsday.php?d=${today}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`SportsDB ${res.status}`);
  const data = await res.json();
  return (data.events ?? []).slice(0, 12).map((e: any) => ({
    id: `sports-${e.idEvent}`,
    source: 'sports' as const,
    kind: 'sport',
    title: e.strEvent ?? 'Event',
    subtitle: `${e.strLeague ?? ''}${e.strTime ? ' · ' + e.strTime.slice(0, 5) : ''}`.trim(),
    poster: e.strThumb || e.strPoster || undefined,
    startTime: e.strTimestamp,
  }));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const [plex, tmdb, sports] = await Promise.all([
      safe(fetchPlex(), 'plex'),
      safe(fetchTMDB(), 'tmdb'),
      safe(fetchSports(), 'sports'),
    ]);
    const items = [
      ...(plex ?? []),
      ...(sports ?? []),
      ...(tmdb ?? []),
    ];
    return new Response(
      JSON.stringify({ items, fetchedAt: Date.now() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } },
    );
  } catch (e) {
    console.error('[media-bar-feed] fatal:', e);
    return new Response(JSON.stringify({ items: [], error: (e as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
