// Aggregates Plex (Recently Added) + TRULY LIVE sports events (happening RIGHT NOW)
// Uses ESPN's public scoreboard API which exposes a real "in progress" status flag
// (status.type.state === "in"). Only events that are actively airing at this moment
// are returned with isLive=true. Everything else is dropped — for non-live content
// we rely on Plex VOD.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
let PLEX_MACHINE_ID = '';

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
  webLink?: string;
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
const plexDeepLink = (ratingKey?: string) => {
  if (!ratingKey) return undefined;
  const metadataKey = `/library/metadata/${ratingKey}`;
  // Plex mobile/TV app deep link — opens directly to the item's preplay screen.
  // Including the server machineIdentifier ensures it routes to the correct server
  // even if the user has multiple servers signed in.
  if (PLEX_MACHINE_ID) {
    return `plex://preplay/?server=${PLEX_MACHINE_ID}&metadataKey=${encodeURIComponent(metadataKey)}`;
  }
  return `plex://preplay/?metadataKey=${encodeURIComponent(metadataKey)}`;
};

const plexWebLink = (ratingKey?: string) => {
  if (!ratingKey || !PLEX_MACHINE_ID) return undefined;
  return `https://app.plex.tv/desktop/#!/server/${PLEX_MACHINE_ID}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
};

const mapPlexItem = (m: any): Item & { _seriesKey?: string } => {
  const isMovie = m.type === 'movie';
  const isEpisode = m.type === 'episode';
  const ratingKey = m.ratingKey;
  let subtitle: string;
  if (isMovie) subtitle = m.year ? String(m.year) : 'Movie';
  else if (isEpisode) {
    const s = m.parentIndex ?? m.seasonNumber;
    const ep = m.index ?? m.episodeNumber;
    const se = (s != null && ep != null) ? `S${String(s).padStart(2,'0')}E${String(ep).padStart(2,'0')}` : '';
    subtitle = [m.grandparentTitle, se].filter(Boolean).join(' · ') || 'Episode';
  } else subtitle = m.grandparentTitle ?? (m.year ? String(m.year) : 'Series');
  return {
    id: `plex-${ratingKey}`,
    source: 'plex',
    kind: isMovie ? 'movie' : (isEpisode ? 'episode' : m.type ?? 'show'),
    title: isEpisode ? (m.title ?? 'Episode') : (m.title ?? 'Untitled'),
    subtitle,
    poster: plexImage(m.thumb ?? m.parentThumb ?? m.grandparentThumb),
    deepLink: plexDeepLink(ratingKey),
    webLink: plexWebLink(ratingKey),
    _seriesKey: m.grandparentRatingKey ? `series-${m.grandparentRatingKey}` : undefined,
  };
};

const fetchMachineId = async () => {
  if (PLEX_MACHINE_ID || !PLEX_URL || !PLEX_TOKEN) return;
  try {
    const data = await plexFetch('/identity');
    const id = data?.MediaContainer?.machineIdentifier;
    if (id) PLEX_MACHINE_ID = id;
  } catch (e) {
    console.warn('[media-bar-feed] machineId fetch failed:', (e as Error).message);
  }
};

const fetchPlex = async (): Promise<{ movies: Item[]; shows: Item[]; onDeck: Item[] }> => {
  const movies: Item[] = [];
  const shows: Item[] = [];
  const onDeck: Item[] = [];

  // Need machineIdentifier so deep links route to THIS server inside the Plex app
  await fetchMachineId();

  // Pull from MULTIPLE Plex endpoints so the bar always has fresh material
  const [recent, deck, popularMovies, popularShows] = await Promise.all([
    safe(plexFetch('/library/recentlyAdded?X-Plex-Container-Size=80'), 'plex recent'),
    safe(plexFetch('/library/onDeck?X-Plex-Container-Size=40'), 'plex onDeck'),
    safe(plexFetch('/library/sections/all?type=1&sort=viewCount:desc&X-Plex-Container-Size=40'), 'plex popular movies'),
    safe(plexFetch('/library/sections/all?type=2&sort=lastViewedAt:desc&X-Plex-Container-Size=40'), 'plex popular shows'),
  ]);

  for (const m of recent?.MediaContainer?.Metadata ?? []) {
    const item = mapPlexItem(m);
    if (item.kind === 'movie') movies.push(item);
    else shows.push(item);
  }
  for (const m of deck?.MediaContainer?.Metadata ?? []) {
    const item = mapPlexItem(m);
    item.subtitle = `Continue · ${item.subtitle ?? ''}`.replace(/ · $/, '');
    onDeck.push(item);
  }
  for (const m of popularMovies?.MediaContainer?.Metadata ?? []) {
    movies.push(mapPlexItem(m));
  }
  for (const m of popularShows?.MediaContainer?.Metadata ?? []) {
    shows.push(mapPlexItem(m));
  }

  // Cross-list de-dup: same id never appears twice across movies/shows/onDeck.
  // Also collapse multiple episodes from the same series down to ONE entry per series
  // (the first one we see, which is the most recently added / on deck).
  const globalIds = new Set<string>();
  const seenSeries = new Set<string>();
  const dedupe = (arr: (Item & { _seriesKey?: string })[]) =>
    arr.filter((i) => {
      if (globalIds.has(i.id)) return false;
      if (i.kind === 'episode' && i._seriesKey) {
        if (seenSeries.has(i._seriesKey)) return false;
        seenSeries.add(i._seriesKey);
      }
      globalIds.add(i.id);
      return true;
    }).map(({ _seriesKey, ...rest }) => rest as Item);
  // Order matters: onDeck wins over recent which wins over popular catalog
  const onDeckOut = dedupe(onDeck);
  const moviesOut = dedupe(movies);
  const showsOut = dedupe(shows);
  return {
    movies: moviesOut.slice(0, 60),
    shows: showsOut.slice(0, 30),
    onDeck: onDeckOut.slice(0, 20),
  };
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
// Order: live sports → continue watching → movies/shows interleaved.
// Goal: a long, varied feed so the bar effectively never "ends".
const weave = (movies: Item[], liveSports: Item[], shows: Item[], onDeck: Item[]): Item[] => {
  const out: Item[] = [];
  const seen = new Set<string>();
  const push = (i?: Item) => {
    if (!i || seen.has(i.id)) return;
    seen.add(i.id);
    out.push(i);
  };

  for (const s of liveSports) push(s);
  for (const d of onDeck) push(d);

  const m = movies.slice();
  const sh = shows.slice();
  while (m.length || sh.length) {
    if (m.length) push(m.shift());
    if (m.length) push(m.shift());
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
    const items = weave(
      plex?.movies ?? [],
      sports ?? [],
      plex?.shows ?? [],
      plex?.onDeck ?? [],
    );
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
