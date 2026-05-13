// Aggregates Plex (Recently Added + On Deck) + Live TV sports events
// (NBA, MLB, NHL, NFL, F1, NASCAR, UFC, WWE) into a single content-bar payload.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const SPORTSDB_KEY = '123'; // Free tier

// TheSportsDB league IDs
const LEAGUES: { id: string; label: string }[] = [
  { id: '4387', label: 'NBA' },
  { id: '4424', label: 'MLB' },
  { id: '4380', label: 'NHL' },
  { id: '4391', label: 'NFL' },
  { id: '4370', label: 'F1' },
  { id: '4393', label: 'NASCAR' },
  { id: '4443', label: 'UFC' },
  { id: '4444', label: 'WWE' },
];

type Item = {
  id: string;
  source: 'plex' | 'sports';
  kind: string; // movie | show | episode | sport
  title: string;
  subtitle?: string;
  poster?: string;
  deepLink?: string;
  startTime?: string;
  isLive?: boolean;
};

const safe = async <T>(p: Promise<T>, label: string): Promise<T | null> => {
  try { return await p; } catch (e) {
    console.warn(`[media-bar-feed] ${label} failed:`, (e as Error).message);
    return null;
  }
};

const plexFetch = async (path: string) => {
  if (!PLEX_URL || !PLEX_TOKEN) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PLEX_URL}${path}${sep}X-Plex-Token=${PLEX_TOKEN}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Plex ${res.status}`);
  return await res.json();
};

const plexImage = (key?: string) =>
  key && PLEX_URL ? `${PLEX_URL}${key}?X-Plex-Token=${PLEX_TOKEN}` : undefined;

const plexDeepLink = (ratingKey?: string) =>
  ratingKey ? `plex://preplay/?metadataKey=%2Flibrary%2Fmetadata%2F${ratingKey}` : undefined;

const fetchPlex = async (): Promise<{ movies: Item[]; shows: Item[] }> => {
  const movies: Item[] = [];
  const shows: Item[] = [];
  // Pull a larger window so we have enough of each type to balance
  const recent = await safe(plexFetch('/library/recentlyAdded?X-Plex-Container-Size=60'), 'plex recent');
  for (const m of recent?.MediaContainer?.Metadata ?? []) {
    const isMovie = m.type === 'movie';
    const item: Item = {
      id: `plex-${m.ratingKey}`,
      source: 'plex',
      kind: isMovie ? 'movie' : (m.type === 'episode' ? 'episode' : m.type ?? 'show'),
      title: m.title ?? 'Untitled',
      subtitle: isMovie
        ? (m.year ? String(m.year) : 'Movie')
        : (m.grandparentTitle ?? (m.year ? String(m.year) : 'Series')),
      poster: plexImage(m.thumb ?? m.parentThumb ?? m.grandparentThumb),
      deepLink: plexDeepLink(m.ratingKey),
    };
    if (isMovie) movies.push(item);
    else shows.push(item);
  }
  // Cap shows so they don't drown out movies/sports
  return { movies: movies.slice(0, 12), shows: shows.slice(0, 6) };
};

const todayStr = () => new Date().toISOString().slice(0, 10);
const isWithinDays = (dateStr: string | undefined, days: number) => {
  if (!dateStr) return false;
  const d = new Date(dateStr).getTime();
  if (Number.isNaN(d)) return false;
  const diff = d - Date.now();
  return diff > -3 * 60 * 60 * 1000 && diff < days * 24 * 60 * 60 * 1000;
};

const mapEvent = (e: any, leagueLabel: string): Item => {
  const today = todayStr();
  const isToday = e.dateEvent === today;
  return {
    id: `sports-${e.idEvent}`,
    source: 'sports',
    kind: 'sport',
    title: e.strEvent ?? 'Event',
    subtitle: `${leagueLabel}${e.strTime ? ' · ' + String(e.strTime).slice(0, 5) : ''}`,
    poster: e.strThumb || e.strPoster || e.strSquare || undefined,
    startTime: e.strTimestamp ?? e.dateEvent,
    isLive: isToday,
  };
};

const fetchLeague = async (leagueId: string, label: string): Promise<Item[]> => {
  const url = `https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsnextleague.php?id=${leagueId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`league ${leagueId} ${res.status}`);
  const data = await res.json();
  return (data.events ?? [])
    .filter((e: any) => isWithinDays(e.dateEvent, 7))
    .slice(0, 4)
    .map((e: any) => mapEvent(e, label));
};

const fetchSports = async (): Promise<Item[]> => {
  const results = await Promise.all(
    LEAGUES.map((l) => safe(fetchLeague(l.id, l.label), `league ${l.label}`)),
  );
  const all = results.flatMap((r) => r ?? []);
  all.sort((a, b) => {
    if (!!b.isLive !== !!a.isLive) return b.isLive ? 1 : -1;
    return (a.startTime ?? '').localeCompare(b.startTime ?? '');
  });
  return all.slice(0, 24);
};

// Round-robin merge: movie, sport, show, sport, movie, sport, ...
// Ensures every category is visible and shows never dominate.
const weave = (movies: Item[], sports: Item[], shows: Item[]): Item[] => {
  const out: Item[] = [];
  const queues = [movies.slice(), sports.slice(), shows.slice(), sports.slice()];
  // Use sports twice in the rotation so live events appear ~2x as often
  while (queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  // De-dup sports by id (since sports queue is referenced twice via .slice copies)
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const [plex, sports] = await Promise.all([
      safe(fetchPlex(), 'plex'),
      safe(fetchSports(), 'sports'),
    ]);
    const items = interleave(plex ?? [], sports ?? []);
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
