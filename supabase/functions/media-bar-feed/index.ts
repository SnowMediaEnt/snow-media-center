// Aggregates Plex (Recently Added) + TRULY LIVE sports events (happening RIGHT NOW)
// Uses ESPN's public scoreboard API which exposes a real "in progress" status flag
// (status.type.state === "in"). Only events that are actively airing at this moment
// are returned with isLive=true. Everything else is dropped — for non-live content
// we rely on Plex VOD.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';

// ESPN public scoreboard endpoints. No API key required.
// state values: "pre" (scheduled), "in" (LIVE NOW), "post" (final)
const ESPN_LEAGUES: { url: string; label: string }[] = [
  { label: 'NBA',     url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard' },
  { label: 'WNBA',    url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard' },
  { label: 'NCAAB',   url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard' },
  { label: 'NFL',     url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard' },
  { label: 'NCAAF',   url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard' },
  { label: 'MLB',     url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard' },
  { label: 'NHL',     url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard' },
  { label: 'MLS',     url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard' },
  { label: 'EPL',     url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard' },
  { label: 'UCL',     url: 'https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard' },
  { label: 'F1',      url: 'https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard' },
  { label: 'NASCAR',  url: 'https://site.api.espn.com/apis/site/v2/sports/racing/nascar-premier/scoreboard' },
  { label: 'PGA',     url: 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard' },
  { label: 'UFC',     url: 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard' },
];

type Item = {
  id: string;
  source: 'plex' | 'sports';
  kind: string;
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

// ---------- Plex (VOD) ----------
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
  return { movies: movies.slice(0, 14), shows: shows.slice(0, 6) };
};

// ---------- ESPN (LIVE NOW only) ----------
const fetchEspnLive = async (url: string, label: string): Promise<Item[]> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`espn ${label} ${res.status}`);
  const data = await res.json();
  const events = data?.events ?? [];
  const out: Item[] = [];
  for (const e of events) {
    const comp = e?.competitions?.[0];
    const status = comp?.status ?? e?.status;
    const state = status?.type?.state; // "pre" | "in" | "post"
    if (state !== 'in') continue; // ONLY truly live right now

    const competitors = comp?.competitors ?? [];
    const home = competitors.find((c: any) => c.homeAway === 'home') ?? competitors[0];
    const away = competitors.find((c: any) => c.homeAway === 'away') ?? competitors[1];

    const homeName = home?.team?.shortDisplayName ?? home?.team?.name ?? '';
    const awayName = away?.team?.shortDisplayName ?? away?.team?.name ?? '';
    const title = (awayName && homeName)
      ? `${awayName} @ ${homeName}`
      : (e?.shortName ?? e?.name ?? 'Live Event');

    const homeScore = home?.score;
    const awayScore = away?.score;
    const scoreStr = (awayScore !== undefined && homeScore !== undefined && (awayName || homeName))
      ? ` · ${awayScore}-${homeScore}`
      : '';
    const period = status?.type?.shortDetail ?? 'LIVE';

    const poster =
      home?.team?.logo ??
      away?.team?.logo ??
      comp?.competitors?.[0]?.team?.logo ??
      undefined;

    out.push({
      id: `sports-${e.id}`,
      source: 'sports',
      kind: 'sport',
      title,
      subtitle: `${label} · ${period}${scoreStr}`,
      poster,
      startTime: e?.date,
      isLive: true,
    });
  }
  return out;
};

const fetchSportsLiveNow = async (): Promise<Item[]> => {
  const results = await Promise.all(
    ESPN_LEAGUES.map((l) => safe(fetchEspnLive(l.url, l.label), `espn ${l.label}`)),
  );
  const all = results.flatMap((r) => r ?? []);
  // Sort by league priority (NFL > NBA > others) then by event id for stability
  const priority: Record<string, number> = {
    NFL: 0, NBA: 1, NHL: 2, MLB: 3, UFC: 4, EPL: 5, UCL: 6, NCAAF: 7, NCAAB: 8,
    MLS: 9, F1: 10, NASCAR: 11, PGA: 12, WNBA: 13,
  };
  all.sort((a, b) => {
    const la = (a.subtitle ?? '').split(' · ')[0];
    const lb = (b.subtitle ?? '').split(' · ')[0];
    return (priority[la] ?? 99) - (priority[lb] ?? 99);
  });
  return all.slice(0, 24);
};

// ---------- Weave ----------
// If live sports exist: live sports first, then movies/shows interleaved.
// If nothing is live: just Plex VOD.
const weave = (movies: Item[], liveSports: Item[], shows: Item[]): Item[] => {
  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (i?: Item) => {
    if (!i || seen.has(i.id)) return;
    seen.add(i.id);
    out.push(i);
  };

  // All live sports up front (they're the "right now" priority)
  for (const s of liveSports) push(s);

  // Then round-robin movies + shows for VOD
  const m = movies.slice();
  const sh = shows.slice();
  while (m.length || sh.length) {
    if (m.length) push(m.shift());
    if (m.length) push(m.shift()); // movies 2:1 over shows
    if (sh.length) push(sh.shift());
  }
  return out;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const [plex, sports] = await Promise.all([
      safe(fetchPlex(), 'plex'),
      safe(fetchSportsLiveNow(), 'sports-live'),
    ]);
    const items = weave(plex?.movies ?? [], sports ?? [], plex?.shows ?? []);
    return new Response(
      JSON.stringify({
        items,
        liveCount: (sports ?? []).length,
        fetchedAt: Date.now(),
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          // Short cache so "live now" stays fresh
          'Cache-Control': 'public, max-age=60',
        },
      },
    );
  } catch (e) {
    console.error('[media-bar-feed] fatal:', e);
    return new Response(JSON.stringify({ items: [], error: (e as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
