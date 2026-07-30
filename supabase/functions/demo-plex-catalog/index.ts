// demo-plex-catalog — one JSON payload that powers the website-embedded demo.
//
// Everything is built SERVER-SIDE from the real Plex Media Server (same
// PLEX_SERVER_URL / PLEX_TOKEN secrets media-bar-feed uses) and then scrubbed:
// no base URLs, no tokens, no machineIdentifier, no Media[].Part keys ever
// reach the browser. Posters/art are rewritten to signed poster-proxy URLs
// (same HMAC scheme as media-bar-feed).
//
// Public + cacheable: verify_jwt = false, in-memory cache per instance plus
// Cache-Control: public, max-age=3600. Any Plex failure returns a 200 with a
// small hardcoded fallback catalog so the demo can never break.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const POSTER_SECRET = Deno.env.get('POSTER_PROXY_SECRET') ?? '';

const MOVIE_COUNT = 24;
const SHOW_COUNT = 16;
const SHOWS_WITH_CHILDREN = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;

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

// ── plex ───────────────────────────────────────────────────────────────────
const plexFetch = async (path: string): Promise<Record<string, any> | null> => {
  if (!PLEX_URL || !PLEX_TOKEN) throw new Error('plex not configured');
  const sep = path.includes('?') ? '&' : '?';
  const url = `${PLEX_URL}${path}${sep}X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(`Plex ${res.status}`);
  return await res.json();
};

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const arr = (v: unknown): Array<Record<string, any>> => (Array.isArray(v) ? v : []);

const mediaRes = (m: Record<string, any>): string | undefined => {
  const r = arr(m.Media)[0]?.videoResolution;
  return r ? String(r) : undefined;
};

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
  videoResolution: mediaRes(m),
});

const mapMetadata = async (m: Record<string, any>, ratingKey: string): Promise<DemoMetadata> => {
  const base = await mapItem({ ...m, ratingKey: m.ratingKey ?? ratingKey });
  const media0 = arr(m.Media)[0];
  const cast: DemoPerson[] = [];
  for (const r of arr(m.Role).slice(0, 20)) {
    cast.push({
      id: r.id != null ? String(r.id) : undefined,
      tag: String(r.tag ?? ''),
      role: str(r.role),
      // Actor thumbs are absolute plex.tv URLs — drop them rather than leak.
      thumb: undefined,
    });
  }
  return {
    ...base,
    ratingKey: String(m.ratingKey ?? ratingKey),
    contentRating: str(m.contentRating),
    studio: str(m.studio),
    audienceRating: num(m.audienceRating),
    rating: num(m.rating),
    genres: arr(m.Genre).map((g) => String(g.tag ?? '')).filter(Boolean),
    cast,
    directors: arr(m.Director).map((d) => String(d.tag ?? '')).filter(Boolean),
    viewOffset: num(m.viewOffset),
    media: media0
      ? {
        videoResolution: str(media0.videoResolution),
        videoCodec: str(media0.videoCodec),
        audioCodec: str(media0.audioCodec),
        audioChannels: num(media0.audioChannels),
      }
      : undefined,
    // Section id is a local integer, not server-identifying — but we replace
    // it with the demo library key so nothing maps back to the real layout.
    librarySectionID: m.librarySectionID != null ? String(m.librarySectionID) : undefined,
  };
};

const pool = async <T, R>(items: T[], limit: number, fn: (t: T) => Promise<R | null>): Promise<R[]> => {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        const r = await fn(items[idx]);
        if (r) out.push(r);
      } catch { /* skip */ }
    }
  });
  await Promise.all(workers);
  return out;
};

const buildCatalog = async (): Promise<DemoCatalog> => {
  const sections = await plexFetch('/library/sections');
  const dirs = arr(sections?.MediaContainer?.Directory);
  const movieDir = dirs.find((d) => d.type === 'movie');
  const showDir = dirs.find((d) => d.type === 'show');
  if (!movieDir && !showDir) throw new Error('no usable sections');

  // Stable, non-identifying library keys for the demo client.
  const libraries: DemoLibrary[] = [];
  const realKeyByDemoKey: Record<string, string> = {};
  if (movieDir) { libraries.push({ key: 'demo-movies', title: 'Movies', type: 'movie' }); realKeyByDemoKey['demo-movies'] = String(movieDir.key); }
  if (showDir) { libraries.push({ key: 'demo-shows', title: 'TV Shows', type: 'show' }); realKeyByDemoKey['demo-shows'] = String(showDir.key); }

  const itemsByLibrary: Record<string, DemoItem[]> = {};
  for (const lib of libraries) {
    const size = lib.type === 'movie' ? MOVIE_COUNT : SHOW_COUNT;
    const data = await plexFetch(
      `/library/sections/${realKeyByDemoKey[lib.key]}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=${size}`,
    ).catch(() => null);
    const list = arr(data?.MediaContainer?.Metadata);
    itemsByLibrary[lib.key] = await Promise.all(list.map(mapItem));
  }

  const [deck, recent] = await Promise.all([
    plexFetch('/library/onDeck?X-Plex-Container-Size=12').catch(() => null),
    plexFetch('/library/recentlyAdded?X-Plex-Container-Size=20').catch(() => null),
  ]);
  const keepKinds = new Set(['movie', 'show', 'episode']);
  const continueWatching = (await Promise.all(arr(deck?.MediaContainer?.Metadata).map(mapItem)))
    .filter((i) => keepKinds.has(i.type));
  const recentlyAdded = (await Promise.all(arr(recent?.MediaContainer?.Metadata).map(mapItem)))
    .filter((i) => keepKinds.has(i.type));

  // Full metadata for everything the demo can open.
  const allItems = [
    ...Object.values(itemsByLibrary).flat(),
    ...continueWatching,
    ...recentlyAdded,
  ];
  const uniqueKeys = Array.from(new Set(allItems.map((i) => i.ratingKey).filter(Boolean)));
  const metadataByRatingKey: Record<string, DemoMetadata> = {};
  // Seed from list data so a failed metadata call still renders something.
  for (const it of allItems) {
    if (!it.ratingKey || metadataByRatingKey[it.ratingKey]) continue;
    metadataByRatingKey[it.ratingKey] = { ...it, genres: [], cast: [], directors: [] };
  }
  const detailed = await pool(uniqueKeys, 6, async (rk) => {
    const data = await plexFetch(`/library/metadata/${rk}?includeExtras=0`).catch(() => null);
    const m = arr(data?.MediaContainer?.Metadata)[0];
    if (!m) return null;
    return await mapMetadata(m, rk);
  });
  for (const d of detailed) metadataByRatingKey[d.ratingKey] = d;

  // Children for a couple of shows only — enough to demo the season browser.
  const seasonsByShow: Record<string, DemoSeason[]> = {};
  const episodesBySeason: Record<string, DemoEpisode[]> = {};
  const showKeys = (itemsByLibrary['demo-shows'] ?? [])
    .filter((s) => s.type === 'show')
    .slice(0, SHOWS_WITH_CHILDREN)
    .map((s) => s.ratingKey);
  for (const showKey of showKeys) {
    const data = await plexFetch(`/library/metadata/${showKey}/children`).catch(() => null);
    const seasons: DemoSeason[] = [];
    for (const s of arr(data?.MediaContainer?.Metadata)) {
      if (String(s.type ?? '') !== 'season') continue;
      seasons.push({
        ratingKey: String(s.ratingKey ?? ''),
        title: String(s.title ?? `Season ${s.index ?? ''}`),
        index: num(s.index),
        thumb: await proxyImage(s.thumb),
        leafCount: num(s.leafCount),
      });
    }
    seasonsByShow[showKey] = seasons;
    for (const season of seasons.slice(0, 2)) {
      const ep = await plexFetch(`/library/metadata/${season.ratingKey}/children`).catch(() => null);
      const eps: DemoEpisode[] = [];
      for (const e of arr(ep?.MediaContainer?.Metadata)) {
        eps.push({
          ratingKey: String(e.ratingKey ?? ''),
          title: String(e.title ?? ''),
          index: num(e.index),
          thumb: await proxyImage(e.thumb),
          duration: num(e.duration),
          summary: str(e.summary),
        });
      }
      episodesBySeason[season.ratingKey] = eps;
    }
  }

  return { libraries, home: { continueWatching, recentlyAdded }, itemsByLibrary, metadataByRatingKey, seasonsByShow, episodesBySeason };
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

// ── serve ──────────────────────────────────────────────────────────────────
let cached: { at: number; body: string } | null = null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const headers = {
    ...corsHeaders,
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=3600',
  };

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return new Response(cached.body, { status: 200, headers });
  }

  let catalog: DemoCatalog;
  try {
    catalog = await buildCatalog();
  } catch (e) {
    console.warn('[demo-plex-catalog] build failed, serving fallback:', (e as Error).message);
    catalog = buildFallback();
  }

  const body = JSON.stringify(catalog);
  // Only cache real catalogs — a fallback should retry on the next request.
  if (!catalog.fallback) cached = { at: Date.now(), body };
  return new Response(body, { status: 200, headers });
});
