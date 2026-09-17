// Plex (Recently Added + On Deck) for the content bar's shared rows. The live
// half of the bar — the viewer's own channels, what they watched, what is on
// now — is assembled on the device from their signed-in line; nothing about a
// line ever reaches this function. The old ESPN "live now" feed is gone.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const PLEX_URL = (Deno.env.get('PLEX_SERVER_URL') ?? '').replace(/\/+$/, '');
const PLEX_TOKEN = Deno.env.get('PLEX_TOKEN') ?? '';
let PLEX_MACHINE_ID = '';


type Item = {
  id: string;
  source: 'plex';
  kind: string;
  title: string;
  subtitle?: string;
  poster?: string;
  ratingKey?: string;
  key?: string;
  guid?: string;
  machineIdentifier?: string;
  librarySectionID?: string | number;
  metadataType?: number;
  duration?: number;
  viewOffset?: number;
  androidLink?: string;
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
  const url = `${PLEX_URL}${path}${sep}X-Plex-Token=${encodeURIComponent(PLEX_TOKEN)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Plex ${res.status}`);
  return await res.json();
};

// Posters are served through our own signed proxy so the Plex origin and
// X-Plex-Token never leave the server.
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const POSTER_SECRET = Deno.env.get('POSTER_PROXY_SECRET') ?? '';

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

const plexImage = async (key?: string): Promise<string | undefined> => {
  if (!key || !SUPABASE_URL || !POSTER_SECRET) return undefined;
  const sigBuf = await crypto.subtle.sign('HMAC', await getPosterKey(), new TextEncoder().encode(key));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${SUPABASE_URL}/functions/v1/poster-proxy?p=${encodeURIComponent(key)}&s=${sig}`;
};
const PLEX_METADATA_TYPE: Record<string, number> = { movie: 1, show: 2, season: 3, episode: 4 };

// ---- PLAYBACK-FIRST DEEP LINKS ----
// Goal: click in SMC → Plex opens and immediately plays the exact item from
// the beginning. We always append viewOffset=0&offset=0&t=0 so any Plex build
// that respects deep-link offset hints starts at 0:00. Note: the Plex Android
// client may still apply server-side account resume state and ignore these
// hints — there is no public external API to override that without acting as
// a Plex Companion controller (out of scope here).
const OFFSET_QS = 'viewOffset=0&offset=0&t=0';

const plexPlayScheme = (ratingKey?: string, type?: string) => {
  if (!ratingKey) return undefined;
  const metadataKey = `/library/metadata/${ratingKey}`;
  const metadataType = PLEX_METADATA_TYPE[String(type ?? '').toLowerCase()] ?? 1;
  const base = PLEX_MACHINE_ID
    ? `plex://play/?server=${PLEX_MACHINE_ID}&metadataKey=${encodeURIComponent(metadataKey)}&metadataType=${metadataType}`
    : `plex://play/?metadataKey=${encodeURIComponent(metadataKey)}&metadataType=${metadataType}`;
  return `${base}&${OFFSET_QS}`;
};

const plexWebPlayLink = (ratingKey?: string) => {
  if (!ratingKey) return undefined;
  const metadataKey = `/library/metadata/${ratingKey}`;
  // Plex Web "playMedia" route — kicks off playback rather than landing on
  // the details/preplay screen.
  if (PLEX_MACHINE_ID) {
    return `https://app.plex.tv/desktop#!/server/${PLEX_MACHINE_ID}/playMedia?key=${encodeURIComponent(metadataKey)}&${OFFSET_QS}`;
  }
  return `https://app.plex.tv/desktop#!/playMedia?key=${encodeURIComponent(metadataKey)}&${OFFSET_QS}`;
};

// Kept only as a last-ditch fallback for the client to log; not preferred.
const mapPlexItem = async (m: any): Promise<Item & { _seriesKey?: string; _dedupeKey?: string; _is4k?: boolean }> => {
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

  // Detect 4K so we can drop duplicate 4K entries when a 1080p version exists.
  const mediaArr = Array.isArray(m.Media) ? m.Media : [];
  const resolutions = mediaArr.map((x: any) => String(x?.videoResolution ?? '').toLowerCase());
  const sectionTitle = String(m.librarySectionTitle ?? '').toLowerCase();
  const is4k =
    resolutions.some((r: string) => r === '4k' || r === '2160') ||
    /\b(4k|uhd|2160)\b/.test(sectionTitle);

  const titleKey = (isEpisode ? m.grandparentTitle : m.title) ?? '';
  const dedupeKey = isEpisode
    ? `ep|${titleKey}|${m.parentIndex ?? ''}|${m.index ?? ''}`
    : isMovie
      ? `mv|${titleKey}|${m.year ?? ''}`
      : `sh|${titleKey}`;

  const metadataType = PLEX_METADATA_TYPE[String(m.type ?? '').toLowerCase()] ?? 1;
  return {
    id: `plex-${ratingKey}`,
    source: 'plex',
    kind: isMovie ? 'movie' : (isEpisode ? 'episode' : m.type ?? 'show'),
    title: isEpisode ? (m.title ?? 'Episode') : (m.title ?? 'Untitled'),
    subtitle,
    poster: await plexImage(m.thumb ?? m.parentThumb ?? m.grandparentThumb),
    ratingKey,
    key: m.key,
    guid: m.guid,
    machineIdentifier: PLEX_MACHINE_ID || undefined,
    librarySectionID: m.librarySectionID,
    metadataType,
    duration: typeof m.duration === 'number' ? m.duration : undefined,
    viewOffset: typeof m.viewOffset === 'number' ? m.viewOffset : undefined,
    // Playback-first native deep link — keep Android path on plex://play only.
    androidLink: plexPlayScheme(ratingKey, m.type),
    deepLink: plexPlayScheme(ratingKey, m.type),
    webLink: plexWebPlayLink(ratingKey),
    _seriesKey: m.grandparentRatingKey ? `series-${m.grandparentRatingKey}` : undefined,
    _dedupeKey: dedupeKey.toLowerCase(),
    _is4k: is4k,
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
    const item = await mapPlexItem(m);
    if (item.kind === 'movie') movies.push(item);
    else shows.push(item);
  }
  for (const m of deck?.MediaContainer?.Metadata ?? []) {
    const item = await mapPlexItem(m);
    item.subtitle = `Continue · ${item.subtitle ?? ''}`.replace(/ · $/, '');
    onDeck.push(item);
  }
  for (const m of popularMovies?.MediaContainer?.Metadata ?? []) {
    movies.push(await mapPlexItem(m));
  }
  for (const m of popularShows?.MediaContainer?.Metadata ?? []) {
    shows.push(await mapPlexItem(m));
  }

  // Cross-list de-dup: same id never appears twice across movies/shows/onDeck.
  // Also collapse multiple episodes from the same series down to ONE entry per series.
  // ALSO: collapse Plex 1080p + 4K duplicate libraries into a single 1080p entry
  // (users can switch to 4K from inside Plex). We prefer non-4K when both exist.
  const globalIds = new Set<string>();
  const seenSeries = new Set<string>();
  const seenDedupe = new Set<string>();
  const dedupe = (arr: (Item & { _seriesKey?: string; _dedupeKey?: string; _is4k?: boolean })[]) => {
    // Stable sort: 1080p (non-4K) first, so when we collapse by title the 1080p wins.
    const sorted = [...arr].sort((a, b) => Number(!!a._is4k) - Number(!!b._is4k));
    return sorted.filter((i) => {
      if (globalIds.has(i.id)) return false;
      if (i._dedupeKey) {
        if (seenDedupe.has(i._dedupeKey)) return false;
        seenDedupe.add(i._dedupeKey);
      }
      if (i.kind === 'episode' && i._seriesKey) {
        if (seenSeries.has(i._seriesKey)) return false;
        seenSeries.add(i._seriesKey);
      }
      globalIds.add(i.id);
      return true;
    }).map(({ _seriesKey, _dedupeKey, _is4k, ...rest }) => rest as Item);
  };
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

// ---------- Weave ----------
// Order: continue watching → movies/shows interleaved.
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

// Strip every Plex-navigation field for untrusted/public callers.
const toPublicItem = (i: Item): Item => ({
  id: i.id,
  source: i.source,
  kind: i.kind,
  title: i.title,
  subtitle: i.subtitle,
  poster: i.poster,
  isLive: i.isLive,
  ratingKey: i.ratingKey,
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const isPublic = new URL(req.url).searchParams.get('public') === '1';
    const plex = await safe(fetchPlex(), 'plex');
    let items = weave(
      plex?.movies ?? [],
      [],
      plex?.shows ?? [],
      plex?.onDeck ?? [],
    );
    if (isPublic) items = items.map(toPublicItem);
    return new Response(
      JSON.stringify({
        items,
        liveCount: 0,
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
