// demo-plex-catalog — one JSON payload that powers the website-embedded demo.
//
// Built SERVER-SIDE from the real Plex Media Server (same PLEX_SERVER_URL /
// PLEX_TOKEN secrets media-bar-feed uses) and then scrubbed: no base URLs, no
// tokens, no machineIdentifier, no Media[].Part keys ever reach the browser.
// Posters/art are rewritten to signed poster-proxy URLs (same HMAC scheme as
// media-bar-feed).
//
// Crawl budget: 3 Plex requests TOTAL (movies, shows, recentlyAdded) using the
// exact `/library/sections/all?type=…` pattern that media-bar-feed proves works
// against this server. Item metadata, seasons and episodes are synthesized
// locally from the list payload — zero extra requests.
//
// Durable cache: public.demo_catalog_cache holds the last built payload. A row
// younger than 24h is served straight from Postgres (single fast read, no Plex
// calls). A failed rebuild falls back to the last good cached payload; the
// hardcoded catalog is only used when no cached row exists at all.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const POSTER_SECRET = Deno.env.get('POSTER_PROXY_SECRET') ?? '';

const MOVIE_COUNT = 24;
const SHOW_COUNT = 24;
const SHOWS_WITH_CHILDREN = 3;
const CACHE_ROW_ID = 'v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MEM_TTL_MS = 60 * 60 * 1000;
const PLEX_TIMEOUT_MS = 6000;

// ── shapes (mirror src/lib/plex.ts) ────────────────────────────────────────
interface DemoLibrary { key: string; title: string; type: string }
interface DemoItem {
  ratingKey: string; title: string; type: string;
  thumb?: string; art?: string; year?: number; summary?: string;
  duration?: number; videoResolution?: string;
}
interface DemoPerson { id?: string; tag: string; role?: string; thumb?: string }
interface DemoMetadata extends DemoItem {
  contentRating?: string; studio?: string; audienceRating?: number; rating?: number;
  genres: string[]; cast: DemoPerson[]; directors: string[];
  viewOffset?: number;
  media?: { videoResolution?: string; videoCodec?: string; audioCodec?: string; audioChannels?: number };
  librarySectionID?: string;
}
interface DemoSeason { ratingKey: string; title: string; index?: number; thumb?: string; leafCount?: number }
interface DemoEpisode { ratingKey: string; title: string; index?: number; thumb?: string; duration?: number; summary?: string }
interface DemoCatalog {
  libraries: DemoLibrary[];
  home: { continueWatching: DemoItem[]; recentlyAdded: DemoItem[] };
  itemsByLibrary: Record<string, DemoItem[]>;
  metadataByRatingKey: Record<string, DemoMetadata>;
  seasonsByShow: Record<string, DemoSeason[]>;
  episodesBySeason: Record<string, DemoEpisode[]>;
  fallback?: boolean;
}

// ── poster signing (identical scheme to media-bar-feed) ────────────────────
let posterKeyPromise: Promise<CryptoKey> | null = null;
const getPosterKey = () => {
  if (!posterKeyPromise) {
    posterKeyPromise = crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(POSTER_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  }
  return posterKeyPromise;
};

const proxyImage = async (key?: unknown): Promise<string | undefined> => {
  const path = typeof key === 'string' ? key : '';
  if (!path || !path.startsWith('/') || !SUPABASE_URL || !POSTER_SECRET) return undefined;
  const sigBuf = await crypto.subtle.sign('HMAC', await getPosterKey(), new TextEncoder().encode(path));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${SUPABASE_URL}/functions/v1/poster-proxy?p=${encodeURIComponent(path)}&s=${sig}`;
};

// ── plex (same helper shape media-bar-feed uses, plus loud error logging) ───
const plexFetch = async (path: string): Promise<Record<string, any> | null> => {
  if (!PLEX_URL || !PLEX_TOKEN) {
    console.error('[demo-plex-catalog] plex not configured (PLEX_SERVER_URL/PLEX_TOKEN missing)');
    return null;
  }
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PLEX_URL}${path}${sep}X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PLEX_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[demo-plex-catalog] ${path} -> HTTP ${res.status} in ${Date.now() - started}ms: ${text.slice(0, 200)}`);
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      console.error(`[demo-plex-catalog] ${path} -> non-JSON body in ${Date.now() - started}ms: ${text.slice(0, 200)}`);
      return null;
    }
  } catch (e) {
    console.error(`[demo-plex-catalog] ${path} -> fetch failed in ${Date.now() - started}ms: ${(e as Error).message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = (v: unknown): Array<Record<string, any>> => (Array.isArray(v) ? v : []);

const mapItem = async (m: Record<string, any>): Promise<DemoItem> => ({
  ratingKey: String(m.ratingKey ?? ''),
  title: String(m.title ?? ''),
  type: String(m.type ?? 'movie'),
  // NOTE: thumb/art are ABSOLUTE poster-proxy URLs in demo payloads. The
  // client renders them as-is (PlexImage already passes absolute URLs through).
  thumb: await proxyImage(m.thumb ?? m.parentThumb ?? m.grandparentThumb),
  art: await proxyImage(m.art ?? m.grandparentArt),
  year: num(m.year),
  summary: str(m.summary),
  duration: num(m.duration),
  videoResolution: str(arr(m.Media)[0]?.videoResolution),
});

// Metadata is synthesized ENTIRELY from the /all list row — no extra requests.
const GENRE_POOL = ['Drama', 'Action', 'Adventure', 'Thriller', 'Comedy', 'Sci-Fi'];

const mapMetadata = async (m: Record<string, any>, base: DemoItem): Promise<DemoMetadata> => {
  const media0 = arr(m.Media)[0];
  const listedGenres = arr(m.Genre).map((g) => String(g.tag ?? '')).filter(Boolean);
  const seed = Math.abs(Number(base.ratingKey) || base.title.length);
  const genres = listedGenres.length
    ? listedGenres
    : [GENRE_POOL[seed % GENRE_POOL.length], GENRE_POOL[(seed + 2) % GENRE_POOL.length]];
  return {
    ...base,
    contentRating: str(m.contentRating),
    studio: str(m.studio),
    audienceRating: num(m.audienceRating),
    rating: num(m.rating),
    genres,
    cast: arr(m.Role).slice(0, 20).map((r) => ({
      id: r.id != null ? String(r.id) : undefined,
      tag: String(r.tag ?? ''),
      role: str(r.role),
      // Actor thumbs are absolute plex.tv URLs — drop them rather than leak.
      thumb: undefined,
    })),
    directors: arr(m.Director).map((d) => String(d.tag ?? '')).filter(Boolean),
    viewOffset: undefined,
    media: media0
      ? {
        videoResolution: str(media0.videoResolution),
        videoCodec: str(media0.videoCodec),
        audioCodec: str(media0.audioCodec),
        audioChannels: num(media0.audioChannels),
      }
      : undefined,
    // Demo library key, never the real section id.
    librarySectionID: base.type === 'show' ? 'demo-shows' : 'demo-movies',
  };
};

const buildCatalog = async (): Promise<DemoCatalog> => {
  // Discover the real section keys first, then pull one page per section.
  // 3 Plex requests total (sections + movies + shows).
  const sections = await plexFetch('/library/sections');
  const dirs = arr(sections?.MediaContainer?.Directory);
  console.log('[demo-plex-catalog] sections:', JSON.stringify(dirs.map((d) => ({ key: d.key, type: d.type, title: d.title }))));
  const movieKey = dirs.find((d) => d.type === 'movie')?.key;
  const showKey = dirs.find((d) => d.type === 'show')?.key;

  const [movieData, showData, recentData] = await Promise.all([
    movieKey
      ? plexFetch(`/library/sections/${movieKey}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=${MOVIE_COUNT}`)
      : Promise.resolve(null),
    showKey
      ? plexFetch(`/library/sections/${showKey}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=${SHOW_COUNT}`)
      : Promise.resolve(null),
    plexFetch('/library/recentlyAdded?X-Plex-Container-Size=20'),
  ]);

  const rawMovies = arr(movieData?.MediaContainer?.Metadata);
  const rawShows = arr(showData?.MediaContainer?.Metadata);
  console.log(`[demo-plex-catalog] counts movies=${rawMovies.length} shows=${rawShows.length} recent=${arr(recentData?.MediaContainer?.Metadata).length}`);
  if (!rawMovies.length && !rawShows.length) throw new Error('no items returned from Plex');


  const libraries: DemoLibrary[] = [];
  if (rawMovies.length) libraries.push({ key: 'demo-movies', title: 'Movies', type: 'movie' });
  if (rawShows.length) libraries.push({ key: 'demo-shows', title: 'TV Shows', type: 'show' });

  const movies = await Promise.all(rawMovies.map(mapItem));
  const shows = await Promise.all(rawShows.map(mapItem));
  const itemsByLibrary: Record<string, DemoItem[]> = {};
  if (movies.length) itemsByLibrary['demo-movies'] = movies;
  if (shows.length) itemsByLibrary['demo-shows'] = shows;

  const keepKinds = new Set(['movie', 'show', 'episode']);
  const recentlyAdded = (await Promise.all(arr(recentData?.MediaContainer?.Metadata).map(mapItem)))
    .filter((i) => keepKinds.has(i.type) && i.ratingKey);
  // Continue-watching is synthesized from the library lists (no onDeck call).
  const continueWatching = [...movies, ...shows].slice(0, 6);

  // Metadata for everything the demo can open, from list fields only.
  const metadataByRatingKey: Record<string, DemoMetadata> = {};
  const pairs: Array<[Record<string, any>, DemoItem]> = [
    ...rawMovies.map((m, i) => [m, movies[i]] as [Record<string, any>, DemoItem]),
    ...rawShows.map((m, i) => [m, shows[i]] as [Record<string, any>, DemoItem]),
  ];
  for (const [raw, item] of pairs) {
    if (!item.ratingKey || metadataByRatingKey[item.ratingKey]) continue;
    metadataByRatingKey[item.ratingKey] = await mapMetadata(raw, item);
  }
  for (const item of recentlyAdded) {
    if (!item.ratingKey || metadataByRatingKey[item.ratingKey]) continue;
    metadataByRatingKey[item.ratingKey] = await mapMetadata({}, item);
  }

  // Seasons/episodes are invented locally — zero requests, plenty for a demo.
  const seasonsByShow: Record<string, DemoSeason[]> = {};
  const episodesBySeason: Record<string, DemoEpisode[]> = {};
  for (const show of shows.filter((s) => s.ratingKey).slice(0, SHOWS_WITH_CHILDREN)) {
    const seasons: DemoSeason[] = [1, 2].map((n) => ({
      ratingKey: `${show.ratingKey}-s${n}`,
      title: `Season ${n}`,
      index: n,
      thumb: show.thumb,
      leafCount: 6,
    }));
    seasonsByShow[show.ratingKey] = seasons;
    for (const season of seasons) {
      episodesBySeason[season.ratingKey] = Array.from({ length: 6 }, (_, i) => ({
        ratingKey: `${season.ratingKey}-e${i + 1}`,
        title: `Episode ${i + 1}`,
        index: i + 1,
        thumb: show.thumb,
        duration: 45 * 60 * 1000,
        summary: show.summary,
      }));
    }
  }

  return {
    libraries,
    home: { continueWatching, recentlyAdded: recentlyAdded.length ? recentlyAdded : [...movies, ...shows].slice(0, 12) },
    itemsByLibrary,
    metadataByRatingKey,
    seasonsByShow,
    episodesBySeason,
  };
};

// ── fallback (never touches Plex) ──────────────────────────────────────────
const FALLBACK_TITLES: Array<[string, string, number]> = [
  ['Northern Lights', 'movie', 2023],
  ['Ice Runner', 'movie', 2022],
  ['The Long Winter', 'movie', 2021],
  ['Snowbound', 'movie', 2024],
  ['Deep Frost', 'movie', 2020],
  ['Glacier Road', 'movie', 2019],
  ['Aurora Nine', 'show', 2023],
  ['Whiteout', 'show', 2022],
  ['Signal North', 'show', 2021],
  ['Cold Harbour', 'show', 2020],
  ['Drift Season', 'show', 2024],
  ['Silent Peaks', 'show', 2019],
];

const buildFallback = (): DemoCatalog => {
  const movies: DemoItem[] = [];
  const shows: DemoItem[] = [];
  const metadataByRatingKey: Record<string, DemoMetadata> = {};
  FALLBACK_TITLES.forEach(([title, type, year], idx) => {
    const item: DemoItem = {
      ratingKey: `demo-${idx + 1}`,
      title,
      type,
      thumb: undefined,
      art: undefined,
      year,
      summary: 'Preview title — sign in on your TV to browse the real library.',
      duration: 5_400_000,
    };
    (type === 'movie' ? movies : shows).push(item);
    metadataByRatingKey[item.ratingKey] = { ...item, genres: [], cast: [], directors: [] };
  });
  return {
    libraries: [
      { key: 'demo-movies', title: 'Movies', type: 'movie' },
      { key: 'demo-shows', title: 'TV Shows', type: 'show' },
    ],
    home: { continueWatching: movies.slice(0, 3), recentlyAdded: [...movies, ...shows].slice(0, 10) },
    itemsByLibrary: { 'demo-movies': movies, 'demo-shows': shows },
    metadataByRatingKey,
    seasonsByShow: {},
    episodesBySeason: {},
    fallback: true,
  };
};

// ── durable cache ──────────────────────────────────────────────────────────
const db = () =>
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    : null;

const readCache = async (): Promise<{ payload: DemoCatalog; builtAt: number } | null> => {
  const client = db();
  if (!client) return null;
  const { data, error } = await client
    .from('demo_catalog_cache')
    .select('payload, built_at')
    .eq('id', CACHE_ROW_ID)
    .maybeSingle();
  if (error) {
    console.error('[demo-plex-catalog] cache read failed:', error.message);
    return null;
  }
  if (!data?.payload) return null;
  return { payload: data.payload as DemoCatalog, builtAt: Date.parse(data.built_at as string) || 0 };
};

const writeCache = async (payload: DemoCatalog) => {
  const client = db();
  if (!client) return;
  const { error } = await client
    .from('demo_catalog_cache')
    .upsert({ id: CACHE_ROW_ID, payload, built_at: new Date().toISOString() });
  if (error) console.error('[demo-plex-catalog] cache write failed:', error.message);
};

// ── serve ──────────────────────────────────────────────────────────────────
let mem: { at: number; body: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const headers = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };
  const ok = (body: string) => new Response(body, { status: 200, headers });

  if (mem && Date.now() - mem.at < MEM_TTL_MS) return ok(mem.body);

  const cached = await readCache();
  if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) {
    const body = JSON.stringify(cached.payload);
    mem = { at: Date.now(), body };
    return ok(body);
  }

  try {
    const catalog = await buildCatalog();
    const body = JSON.stringify(catalog);
    mem = { at: Date.now(), body };
    await writeCache(catalog);
    return ok(body);
  } catch (e) {
    console.error('[demo-plex-catalog] build failed:', (e as Error).message);
    if (cached) return ok(JSON.stringify(cached.payload)); // last good, even if stale
    return ok(JSON.stringify(buildFallback()));
  }
});
