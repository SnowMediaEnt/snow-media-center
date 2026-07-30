// Canned Live TV lineup for demo mode (website embed).
//
// When isDemo() is true the Xtream data layer in @/lib/xtream routes every
// read here instead of the network, so the whole Player renders a convincing
// lineup — categories, channels, EPG with now/next progress, movies, series —
// without contacting any provider host. All artwork is generated in code as
// SVG data-URIs (deterministic gradient + initials, same trick as the Plex
// dummy posters): nothing external is fetched, so nothing can 404, leak a
// referrer, or break later.
//
// EDIT THIS FILE to change the demo lineup. Types match the real Xtream
// shapes so every downstream component renders unchanged.
//
// Demo mode is always OFF on native; the shipped APK is unaffected.

import type {
  XtreamCategory,
  XtreamLiveStream,
  XtreamVodStream,
  XtreamSeries,
  XtreamEpgEntry,
  XtreamEpisode,
  XtreamVodInfo,
  XtreamSeriesInfo,
  XtreamCreds,
  FavChannel,
} from '@/lib/xtream';

/**
 * Presented as the signed-in account in demo mode. The `demo://` host is a
 * sentinel — every data read is intercepted before the transport layer, so
 * this host is never contacted and nothing is ever persisted to storage.
 */
export const DEMO_LIVE_CREDS: XtreamCreds = {
  host: 'demo://livetv',
  username: 'DEMO ACCOUNT',
  password: 'demo',
  output: 'm3u8',
  serverLabel: 'DEMO ACCOUNT',
};

// ── deterministic helpers ───────────────────────────────────────────────────

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const initials = (name: string): string => {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

// Brand-hued gradient pairs (navy / teal / ice / gold families).
const PALETTES: Array<[string, string]> = [
  ['#0b3b5e', '#0e7490'],
  ['#123a6d', '#1d4ed8'],
  ['#0f5132', '#0e9488'],
  ['#5b3a8e', '#2563eb'],
  ['#8a5a12', '#d97706'],
  ['#7a1f3d', '#dc2626'],
  ['#134e4a', '#0d9488'],
  ['#312e81', '#7c3aed'],
];

const svgUri = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** Square channel logo: deterministic gradient tile + channel initials. */
export const demoLogo = (name: string): string => {
  const [c1, c2] = PALETTES[hash(name) % PALETTES.length];
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="128" height="128" rx="22" fill="url(#g)"/>` +
    `<rect x="4" y="4" width="120" height="120" rx="19" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="2"/>` +
    `<text x="64" y="78" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="700" fill="#ffffff" text-anchor="middle">${initials(name)}</text>` +
    `</svg>`,
  );
};

/** 2:3 poster tile: gradient + oversized initials + decorative rings. */
export const demoPoster = (title: string): string => {
  const [c1, c2] = PALETTES[hash(title) % PALETTES.length];
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="300" height="450" fill="url(#g)"/>` +
    `<circle cx="150" cy="185" r="120" fill="#ffffff" fill-opacity="0.08"/>` +
    `<circle cx="150" cy="185" r="82" fill="#ffffff" fill-opacity="0.08"/>` +
    `<text x="150" y="214" font-family="Arial,Helvetica,sans-serif" font-size="92" font-weight="700" fill="#ffffff" fill-opacity="0.92" text-anchor="middle">${initials(title)}</text>` +
    `<rect x="0" y="392" width="300" height="58" fill="#000000" fill-opacity="0.35"/>` +
    `</svg>`,
  );
};

// ── Live TV: categories + channels ─────────────────────────────────────────

export const DEMO_LIVE_CATEGORIES: XtreamCategory[] = [
  { category_id: 'demo-news',  category_name: 'News' },
  { category_id: 'demo-sports', category_name: 'Sports' },
  { category_id: 'demo-moviech', category_name: 'Movie Channels' },
  { category_id: 'demo-ent',   category_name: 'Entertainment' },
  { category_id: 'demo-kids',  category_name: 'Kids' },
  { category_id: 'demo-docs',  category_name: 'Documentary' },
  { category_id: 'demo-music', category_name: 'Music' },
  { category_id: 'demo-intl',  category_name: 'International' },
];

// [channel number, name, category_id]
const CHANNEL_TABLE: Array<[number, string, string]> = [
  // News
  [101, 'World News Network', 'demo-news'],
  [102, 'Metro News 24', 'demo-news'],
  [103, 'The Daily Brief', 'demo-news'],
  [104, 'Business Wire TV', 'demo-news'],
  [105, 'WeatherWatch', 'demo-news'],
  [106, 'Global Affairs', 'demo-news'],
  [107, 'NewsNight', 'demo-news'],
  [108, 'First Light News', 'demo-news'],
  // Sports
  [201, 'Summit Sports', 'demo-sports'],
  [202, 'Arena Sports Extra', 'demo-sports'],
  [203, 'The Dugout', 'demo-sports'],
  [204, 'Courtside', 'demo-sports'],
  [205, 'Gridiron Weekly', 'demo-sports'],
  [206, 'Fairway TV', 'demo-sports'],
  [207, 'Ringside', 'demo-sports'],
  [208, 'Velocity Racing', 'demo-sports'],
  // Movie channels
  [301, 'Aurora Cinema', 'demo-moviech'],
  [302, 'Classic Reel', 'demo-moviech'],
  [303, 'Matinee Channel', 'demo-moviech'],
  [304, 'FilmVault', 'demo-moviech'],
  [305, 'Silver Screen', 'demo-moviech'],
  [306, 'Indie Spotlight', 'demo-moviech'],
  [307, 'Premiere One', 'demo-moviech'],
  [308, 'Drive-In Classics', 'demo-moviech'],
  // Entertainment
  [401, 'Prism TV', 'demo-ent'],
  [402, 'The Variety Network', 'demo-ent'],
  [403, 'Encore', 'demo-ent'],
  [404, 'Spotlight', 'demo-ent'],
  [405, 'Daybreak Live', 'demo-ent'],
  [406, 'Primetime Plus', 'demo-ent'],
  [407, 'Stage Door', 'demo-ent'],
  // Kids
  [501, 'Jellybean TV', 'demo-kids'],
  [502, 'Rocket Club', 'demo-kids'],
  [503, 'Storybook Corner', 'demo-kids'],
  [504, 'Toon Express', 'demo-kids'],
  [505, 'Little Explorers', 'demo-kids'],
  [506, 'Craft Corner', 'demo-kids'],
  [507, 'Dino Park', 'demo-kids'],
  // Documentary
  [601, 'Deep Field Docs', 'demo-docs'],
  [602, 'Planet Wild', 'demo-docs'],
  [603, 'Ancient Worlds', 'demo-docs'],
  [604, 'Frontier Science', 'demo-docs'],
  [605, 'True Stories', 'demo-docs'],
  [606, 'Ocean Realm', 'demo-docs'],
  [607, 'Engineering Marvels', 'demo-docs'],
  // Music
  [701, 'Soundwave', 'demo-music'],
  [702, 'Classic Vinyl', 'demo-music'],
  [703, 'The Jazz Lounge', 'demo-music'],
  [704, 'Country Roads TV', 'demo-music'],
  [705, 'Live Session', 'demo-music'],
  [706, 'Rhythm City', 'demo-music'],
  [707, 'Symphony Hall', 'demo-music'],
  // International
  [801, 'Casa Latina', 'demo-intl'],
  [802, 'Europa One', 'demo-intl'],
  [803, 'Sahara TV', 'demo-intl'],
  [804, 'Pacific Rim', 'demo-intl'],
  [805, 'Emerald Isle TV', 'demo-intl'],
  [806, 'Nordika', 'demo-intl'],
  [807, 'Balkan Beats', 'demo-intl'],
  [808, 'Le Monde Francais', 'demo-intl'],
];

export const DEMO_CHANNELS: XtreamLiveStream[] = CHANNEL_TABLE.map(([num, name, cat], i) => ({
  num,
  name,
  stream_type: 'live',
  stream_id: 10001 + i,
  stream_icon: demoLogo(name),
  epg_channel_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.demo`,
  category_id: cat,
  tv_archive: 0,
}));

// ── Live TV: rolling EPG ────────────────────────────────────────────────────

const EPG_POOLS: Record<string, string[]> = {
  'demo-news': ['Morning Headlines', 'World Report', 'The Briefing Room', 'Market Open', 'Weather Desk', 'Evening Digest', 'Nightcap News', 'Press Review'],
  'demo-sports': ['Matchday Live', 'The Warm-Up', 'Full-Time Analysis', 'SportsCenter Tonight', 'The Replay Booth', 'Pre-Game Show', 'Highlights Hour'],
  'demo-moviech': ['Feature Presentation', 'Matinee Movie', 'Classic Cinema', 'Late Night Feature', "Director's Cut", 'Sunday Premiere'],
  'demo-ent': ['The Morning Mix', 'Talk of the Town', 'Game Night', 'The Variety Hour', 'Celebrity Circuit', 'Encore Presentation'],
  'demo-kids': ['Cartoon Crew', 'Story Time', 'Science Squad', 'Sing-Along Hour', 'Adventure Club', 'Craft Time'],
  'demo-docs': ['Wild Kingdoms', 'Lost Civilizations', 'The Universe', 'Engineering Giants', 'True Crime Files', 'Deep Blue'],
  'demo-music': ['Acoustic Sessions', 'Top 40 Countdown', 'Jazz After Dark', 'Country Hour', 'Live at the Hall', 'Rewind Classics'],
  'demo-intl': ['Noticias de la Tarde', 'Le Journal', 'World Cinema Showcase', 'Cultural Mosaic', 'The Continent Today'],
};

// Programme lengths cycle 30 / 60 / 60 / 90 minutes per slot, deterministically.
const SLOT_LENGTHS_SEC = [1800, 3600, 3600, 5400];

const b64 = (s: string): string => {
  try { return btoa(unescape(encodeURIComponent(s))); } catch { return s; }
};

/**
 * Rolling demo EPG. The schedule is generated on demand relative to NOW and
 * anchored to half-hour boundaries, so the guide always shows a live "now"
 * programme with a partially-elapsed progress bar, plus upcoming entries.
 * Titles are deterministic per (channel, slot) so the channel list, guide
 * grid, and fullscreen bar all agree for the same time window.
 */
export const demoGetShortEpg = (streamId: number, limit = 10): XtreamEpgEntry[] => {
  const ch = DEMO_CHANNELS.find(c => c.stream_id === streamId);
  const pool = EPG_POOLS[ch?.category_id ?? ''] ?? EPG_POOLS['demo-ent'];
  const nowMs = Date.now();
  // Anchor one hour back so both "now" and "next" fall inside the window
  // even when the caller only asks for a few entries (LiveSection uses 4).
  let tMs = Math.floor((nowMs - 3_600_000) / 1_800_000) * 1_800_000;
  const out: XtreamEpgEntry[] = [];
  for (let i = 0; out.length < limit; i++) {
    const slotIdx = Math.floor(tMs / 1_800_000);
    const lenSec = SLOT_LENGTHS_SEC[hash(`${streamId}:${slotIdx}`) % SLOT_LENGTHS_SEC.length];
    const startSec = Math.floor(tMs / 1000);
    const stopSec = startSec + lenSec;
    const title = pool[(hash(ch?.name ?? String(streamId)) + slotIdx) % pool.length];
    out.push({
      id: String(streamId * 1000 + i),
      epg_id: String(i),
      title: b64(title),
      lang: 'en',
      start: String(startSec),
      end: String(stopSec),
      description: b64(`${title} — demo listing.`),
      channel_id: ch?.epg_channel_id ?? '',
      start_timestamp: String(startSec),
      stop_timestamp: String(stopSec),
    });
    tMs += lenSec * 1000;
  }
  return out;
};

// ── Movies (VOD) ────────────────────────────────────────────────────────────

export const DEMO_VOD_CATEGORIES: XtreamCategory[] = [
  { category_id: 'demo-vod-action', category_name: 'Action and Adventure' },
  { category_id: 'demo-vod-comedy', category_name: 'Comedy' },
  { category_id: 'demo-vod-family', category_name: 'Family' },
  { category_id: 'demo-vod-scifi',  category_name: 'Sci-Fi and Fantasy' },
];

// [title, year, rating, category_id]
const MOVIE_TABLE: Array<[string, string, string, string]> = [
  ['The Last Horizon', '2023', '7.4', 'demo-vod-action'],
  ['Velocity Point', '2024', '6.9', 'demo-vod-action'],
  ['Iron Crossing', '2022', '7.1', 'demo-vod-action'],
  ['Night Runner Protocol', '2024', '7.8', 'demo-vod-action'],
  ['The Granite Path', '2021', '6.8', 'demo-vod-action'],
  ['Stormbreak', '2023', '7.2', 'demo-vod-action'],
  ['Laugh Track', '2023', '6.7', 'demo-vod-comedy'],
  ['The Neighbor Upstairs', '2024', '7.0', 'demo-vod-comedy'],
  ['Worst Best Man', '2022', '6.5', 'demo-vod-comedy'],
  ['Office Olympics', '2023', '7.3', 'demo-vod-comedy'],
  ['The Substitute', '2021', '6.4', 'demo-vod-comedy'],
  ['Dad Bod Squad', '2024', '6.1', 'demo-vod-comedy'],
  ['Camp Firefly', '2023', '7.5', 'demo-vod-family'],
  ['The Big Inning', '2022', '6.9', 'demo-vod-family'],
  ['Penelope the Brave', '2024', '7.8', 'demo-vod-family'],
  ["Grandpa's Workshop", '2021', '7.2', 'demo-vod-family'],
  ['The Treehouse Club', '2023', '7.0', 'demo-vod-family'],
  ['Snow Day Sal', '2022', '6.8', 'demo-vod-family'],
  ['Starward Bound', '2024', '7.9', 'demo-vod-scifi'],
  ['The Andromeda Signal', '2023', '7.6', 'demo-vod-scifi'],
  ['Quantum Drift', '2022', '7.1', 'demo-vod-scifi'],
  ['Terraform', '2024', '8.1', 'demo-vod-scifi'],
  ['The Clockwork Garden', '2021', '6.9', 'demo-vod-scifi'],
  ['Echoes of Tomorrow', '2023', '7.7', 'demo-vod-scifi'],
];

const MOVIE_PLOTS: Record<string, string> = {
  'demo-vod-action': 'A retired operative is pulled back for one final mission across three continents, where every ally has a hidden agenda and the clock never stops.',
  'demo-vod-comedy': 'A well-meaning underdog stumbles into the opportunity of a lifetime and has one chaotic week to keep work, family, and dignity intact.',
  'demo-vod-family': 'A summer adventure brings an unlikely group of kids together as they discover that the greatest treasures are the friends they make along the way.',
  'demo-vod-scifi': 'When a distant signal repeats a pattern no one can explain, a small crew must decide how far they are willing to go to answer it.',
};

export const DEMO_MOVIES: XtreamVodStream[] = MOVIE_TABLE.map(([name, year, rating, cat], i) => ({
  num: i + 1,
  name,
  stream_id: 50001 + i,
  stream_icon: demoPoster(name),
  rating,
  year,
  added: '1700000000',
  category_id: cat,
  container_extension: 'mp4',
}));

// ── Series ──────────────────────────────────────────────────────────────────

export const DEMO_SERIES_CATEGORIES: XtreamCategory[] = [
  { category_id: 'demo-ser-drama', category_name: 'Drama' },
  { category_id: 'demo-ser-comedy', category_name: 'Comedy' },
  { category_id: 'demo-ser-docs',  category_name: 'Docuseries' },
];

// [title, first-air year, rating, category_id]
const SERIES_TABLE: Array<[string, string, string, string]> = [
  ['Harbor Lights', '2022', '8.1', 'demo-ser-drama'],
  ['The Cartographers', '2023', '7.8', 'demo-ser-drama'],
  ['Paper Empire', '2024', '8.4', 'demo-ser-drama'],
  ['Ember and Oak', '2021', '7.5', 'demo-ser-drama'],
  ['Second Shift', '2023', '7.2', 'demo-ser-comedy'],
  ['Bluebird Lane', '2022', '7.6', 'demo-ser-comedy'],
  ['Kitchen Republic', '2024', '7.9', 'demo-ser-comedy'],
  ['The Understudy', '2021', '6.8', 'demo-ser-comedy'],
  ['Deep Field', '2023', '8.6', 'demo-ser-docs'],
  ['True North', '2022', '8.2', 'demo-ser-docs'],
  ['The Longitude Club', '2024', '7.7', 'demo-ser-docs'],
  ['Wavelength', '2023', '8.0', 'demo-ser-docs'],
];

const SERIES_PLOTS: Record<string, string> = {
  'demo-ser-drama': 'A family-run business faces a changing town, old secrets, and the quiet choices that define a generation.',
  'demo-ser-comedy': 'Workplace misfits turn everyday disasters into small victories in this warm ensemble comedy.',
  'demo-ser-docs': 'A globe-spanning documentary series exploring the people and places reshaping our world.',
};

const EPISODE_TITLES = [
  'Pilot', 'The Letter', 'Crossroads', 'Homecoming', 'The Long Night',
  'Reckoning', 'Fault Lines', 'New Ground',
];

export const DEMO_SERIES: XtreamSeries[] = SERIES_TABLE.map(([name, year, rating, cat], i) => ({
  num: i + 1,
  name,
  series_id: 70001 + i,
  cover: demoPoster(name),
  plot: SERIES_PLOTS[cat],
  genre: DEMO_SERIES_CATEGORIES.find(c => c.category_id === cat)?.category_name ?? '',
  releaseDate: year,
  rating,
  category_id: cat,
}));

// ── Demo API surface (same shapes as the real Xtream getters) ───────────────

export async function demoGetLiveCategories(): Promise<XtreamCategory[]> {
  return DEMO_LIVE_CATEGORIES;
}

export async function demoGetLiveStreams(categoryId?: string): Promise<XtreamLiveStream[]> {
  if (!categoryId) return DEMO_CHANNELS;
  return DEMO_CHANNELS.filter(c => c.category_id === categoryId);
}

export async function demoGetShortEpgWrapped(
  streamId: number,
  limit = 10,
): Promise<{ epg_listings: XtreamEpgEntry[] }> {
  return { epg_listings: demoGetShortEpg(streamId, limit) };
}

export async function demoGetVodCategories(): Promise<XtreamCategory[]> {
  return DEMO_VOD_CATEGORIES;
}

export async function demoGetVodStreams(categoryId?: string): Promise<XtreamVodStream[]> {
  if (!categoryId) return DEMO_MOVIES;
  return DEMO_MOVIES.filter(m => m.category_id === categoryId);
}

export async function demoGetVodInfo(vodId: number): Promise<XtreamVodInfo> {
  const m = DEMO_MOVIES.find(x => x.stream_id === vodId);
  if (!m) return {};
  const genre = DEMO_VOD_CATEGORIES.find(c => c.category_id === m.category_id)?.category_name ?? 'Feature';
  const mins = 88 + (hash(m.name) % 55);
  return {
    info: {
      movie_image: m.stream_icon,
      cover_big: m.stream_icon,
      plot: MOVIE_PLOTS[m.category_id ?? ''] ?? 'A demo catalog feature presentation.',
      genre,
      releasedate: m.year ?? '',
      rating: m.rating,
      duration: `${Math.floor(mins / 60)}h ${mins % 60}min`,
      cast: 'A. Shepherd, J. Rivera, M. Okafor',
      director: 'L. Calloway',
    },
    movie_data: {
      stream_id: m.stream_id,
      name: m.name,
      container_extension: m.container_extension ?? 'mp4',
    },
  };
}

export async function demoGetSeriesCategories(): Promise<XtreamCategory[]> {
  return DEMO_SERIES_CATEGORIES;
}

export async function demoGetSeries(categoryId?: string): Promise<XtreamSeries[]> {
  if (!categoryId) return DEMO_SERIES;
  return DEMO_SERIES.filter(s => s.category_id === categoryId);
}

export async function demoGetSeriesInfo(seriesId: number): Promise<XtreamSeriesInfo> {
  const s = DEMO_SERIES.find(x => x.series_id === seriesId);
  if (!s) return {};
  const seasonCount = 2 + (hash(s.name) % 2); // 2–3 seasons, deterministic
  const episodesPerSeason = 6;
  const seasons: NonNullable<XtreamSeriesInfo['seasons']> = [];
  const episodes: Record<string, XtreamEpisode[]> = {};
  for (let sn = 1; sn <= seasonCount; sn++) {
    seasons.push({ season_number: sn, episode_count: episodesPerSeason });
    const list: XtreamEpisode[] = [];
    for (let en = 1; en <= episodesPerSeason; en++) {
      const title = EPISODE_TITLES[(hash(`${s.name}:${sn}:${en}`) + en - 1) % EPISODE_TITLES.length];
      list.push({
        id: String(seriesId * 1000 + sn * 100 + en),
        episode_num: en,
        title,
        container_extension: 'mp4',
        info: {
          plot: `${s.name} — Season ${sn}, Episode ${en}. ${SERIES_PLOTS[s.category_id ?? ''] ?? ''}`,
          duration: `${38 + (hash(`${seriesId}:${sn}:${en}`) % 18)} min`,
          releasedate: String(Number(s.releaseDate ?? '2023') + (sn - 1)),
          rating: s.rating,
        },
      });
    }
    episodes[String(sn)] = list as never;
  }
  return {
    info: {
      name: s.name,
      cover: s.cover,
      plot: s.plot,
      genre: s.genre,
      releaseDate: s.releaseDate,
      rating: s.rating,
      cast: 'A. Shepherd, J. Rivera, M. Okafor',
      director: 'L. Calloway',
    },
    seasons,
    episodes: episodes as XtreamSeriesInfo['episodes'],
  };
}

// ── Demo favorites (sessionStorage — tab-scoped, never the backend) ─────────

const DEMO_FAVS_KEY = 'smc-demo-livetv-favs';
// Pre-seeded "recently watched" picks so the Favorites row isn't empty.
const SEEDED_FAV_STREAM_IDS = [10001, 10009, 10025]; // World News Network, Summit Sports, Aurora Cinema

export function demoLoadFavorites(): Map<number, FavChannel> {
  try {
    const raw = sessionStorage.getItem(DEMO_FAVS_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as FavChannel[];
      return new Map(arr.map(f => [f.stream_id, f]));
    }
  } catch { /* ignore */ }
  const seeded = new Map<number, FavChannel>();
  for (const ch of DEMO_CHANNELS) {
    if (!SEEDED_FAV_STREAM_IDS.includes(ch.stream_id)) continue;
    seeded.set(ch.stream_id, {
      stream_id: ch.stream_id,
      name: ch.name,
      num: ch.num,
      stream_icon: ch.stream_icon,
      category_id: ch.category_id,
      epg_channel_id: ch.epg_channel_id,
    });
  }
  demoSaveFavorites(seeded);
  return seeded;
}

export function demoSaveFavorites(m: Map<number, FavChannel>): void {
  try { sessionStorage.setItem(DEMO_FAVS_KEY, JSON.stringify([...m.values()])); } catch { /* ignore */ }
}
