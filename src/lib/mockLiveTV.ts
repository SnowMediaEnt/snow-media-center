// Mock data shown until the user enters real Xtream credentials.
// Covers Live TV, Movies (VOD) and Series so Demo mode is fully populated.
import type {
  XtreamCategory,
  XtreamLiveStream,
  XtreamVodStream,
  XtreamVodInfo,
  XtreamSeries,
  XtreamSeriesInfo,
  EpgNowNext,
} from './xtream';

// ============================================================================
// LIVE
// ============================================================================

export const MOCK_CATEGORIES: XtreamCategory[] = [
  { category_id: 'm-news', category_name: 'News' },
  { category_id: 'm-sports', category_name: 'Sports' },
  { category_id: 'm-movies', category_name: 'Movies 24/7' },
  { category_id: 'm-kids', category_name: 'Kids' },
  { category_id: 'm-music', category_name: 'Music' },
  { category_id: 'm-docs', category_name: 'Documentaries' },
];

const CHAN = (id: number, name: string, category_id: string): XtreamLiveStream => ({
  stream_id: id,
  name,
  category_id,
  stream_icon: '',
  epg_channel_id: `mock.${id}`,
});

export const MOCK_STREAMS: XtreamLiveStream[] = [
  CHAN(1001, 'BBC World News',       'm-news'),
  CHAN(1002, 'CNN International',    'm-news'),
  CHAN(1003, 'Sky News',             'm-news'),
  CHAN(1004, 'Al Jazeera English',   'm-news'),
  CHAN(1005, 'France 24 English',    'm-news'),

  CHAN(2001, 'ESPN HD',              'm-sports'),
  CHAN(2002, 'Sky Sports Premier',   'm-sports'),
  CHAN(2003, 'NBA TV',               'm-sports'),
  CHAN(2004, 'Eurosport 1',          'm-sports'),
  CHAN(2005, 'DAZN 1',               'm-sports'),

  CHAN(3001, 'Action Movies HD',     'm-movies'),
  CHAN(3002, 'Comedy Central+',      'm-movies'),
  CHAN(3003, 'Sci-Fi Channel',       'm-movies'),
  CHAN(3004, 'Classic Cinema',       'm-movies'),

  CHAN(4001, 'Cartoon Network',      'm-kids'),
  CHAN(4002, 'Nickelodeon',          'm-kids'),
  CHAN(4003, 'Disney Channel',       'm-kids'),

  CHAN(5001, 'MTV Hits',             'm-music'),
  CHAN(5002, 'VH1 Classic',          'm-music'),
  CHAN(5003, 'Kiss TV',              'm-music'),

  CHAN(6001, 'Discovery Channel',    'm-docs'),
  CHAN(6002, 'National Geographic',  'm-docs'),
  CHAN(6003, 'History HD',           'm-docs'),
  CHAN(6004, 'Animal Planet',        'm-docs'),
];

const TITLES_BY_CATEGORY: Record<string, string[]> = {
  'm-news':   ['World News Live', 'Top Stories', 'Breaking Now', 'World Report', 'The Briefing'],
  'm-sports': ['Live: Premier League', 'SportsCenter', 'NBA Tonight', 'Champions League Highlights', 'Boxing Live'],
  'm-movies': ['The Last Stand', 'Midnight Run', 'Galaxy Wars VII', 'Detective Files', 'City of Shadows'],
  'm-kids':   ['Adventure Time', 'SpongeBob Marathon', 'Mickey & Friends', 'Cartoon Hour', 'Bluey'],
  'm-music':  ['Top 40 Countdown', 'Classic Rock Block', '90s Hits', 'Live Acoustic Sessions', 'Chart Toppers'],
  'm-docs':   ['Planet Earth III', 'Ancient Mysteries', 'Wild Africa', 'Universe Unknown', 'Engineering Marvels'],
};

export function mockEpgFor(stream: XtreamLiveStream): EpgNowNext {
  const list = TITLES_BY_CATEGORY[stream.category_id || ''] || ['Live Programming'];
  const idx = stream.stream_id % list.length;
  const now = Date.now();
  const slot = 30 * 60 * 1000;
  const start = Math.floor(now / slot) * slot;
  const end = start + slot;
  return {
    now:  { title: list[idx],                       start,           end,            description: 'Live programming' },
    next: { title: list[(idx + 1) % list.length],   start: end,      end: end + slot, description: 'Coming up next' },
  };
}

// ============================================================================
// MOVIES (VOD)
// ============================================================================

export const MOCK_VOD_CATEGORIES: XtreamCategory[] = [
  { category_id: 'v-action',   category_name: 'Action' },
  { category_id: 'v-comedy',   category_name: 'Comedy' },
  { category_id: 'v-scifi',    category_name: 'Sci-Fi' },
  { category_id: 'v-drama',    category_name: 'Drama' },
  { category_id: 'v-family',   category_name: 'Family' },
];

const MOVIE = (
  id: number, name: string, category_id: string, year: string, rating: number,
): XtreamVodStream => ({
  stream_id: id,
  name,
  category_id,
  stream_icon: '',
  rating,
  rating_5based: rating / 2,
  year,
  container_extension: 'mp4',
});

export const MOCK_VOD_STREAMS: XtreamVodStream[] = [
  MOVIE(7001, 'Midnight Pursuit',        'v-action', '2023', 7.6),
  MOVIE(7002, 'Iron Horizon',            'v-action', '2022', 8.1),
  MOVIE(7003, 'Last Light Standing',     'v-action', '2024', 7.2),

  MOVIE(7101, 'Office Antics',           'v-comedy', '2021', 6.8),
  MOVIE(7102, 'Holiday Havoc',           'v-comedy', '2023', 7.0),
  MOVIE(7103, 'Best Friends Forever?',   'v-comedy', '2022', 6.5),

  MOVIE(7201, 'Nebula Drift',            'v-scifi',  '2024', 8.4),
  MOVIE(7202, 'The Quantum Echo',        'v-scifi',  '2023', 7.9),
  MOVIE(7203, 'Sentinels of Mars',       'v-scifi',  '2022', 7.4),

  MOVIE(7301, 'Quiet Streets',           'v-drama',  '2021', 7.7),
  MOVIE(7302, 'A Letter Home',           'v-drama',  '2023', 8.0),

  MOVIE(7401, 'The Little Adventurer',   'v-family', '2024', 7.1),
  MOVIE(7402, 'Pawsome Day Out',         'v-family', '2022', 6.9),
];

const PLOTS: Record<string, string> = {
  'v-action':
    'A relentless chase across neon-soaked streets pulls an off-duty officer back into a world she swore to leave behind. Allegiances blur as the night wears on.',
  'v-comedy':
    'A series of perfectly avoidable misunderstandings spirals into the best — and worst — week of their lives.',
  'v-scifi':
    'When an experimental probe returns from beyond the heliopause carrying something it shouldn\'t, a fractured crew must decide what is worth saving.',
  'v-drama':
    'A small town keeps its secrets close. One quiet morning, a letter arrives that will force every door in it open.',
  'v-family':
    'A backyard treasure map sends an unlikely trio on the kind of adventure that only a long summer afternoon allows.',
};

export function mockVodInfo(m: XtreamVodStream): XtreamVodInfo {
  return {
    info: {
      plot: PLOTS[m.category_id || ''] || 'A captivating story you have to experience to believe.',
      genre: (MOCK_VOD_CATEGORIES.find(c => c.category_id === m.category_id)?.category_name) || 'Feature',
      releasedate: `${m.year || '2024'}-01-01`,
      rating: m.rating,
      duration: '01:48:00',
    },
    movie_data: {
      stream_id: m.stream_id,
      name: m.name,
      container_extension: m.container_extension || 'mp4',
    },
  };
}

// ============================================================================
// SERIES
// ============================================================================

export const MOCK_SERIES_CATEGORIES: XtreamCategory[] = [
  { category_id: 's-drama',   category_name: 'Drama' },
  { category_id: 's-comedy',  category_name: 'Comedy' },
  { category_id: 's-crime',   category_name: 'Crime' },
  { category_id: 's-scifi',   category_name: 'Sci-Fi' },
];

const SERIES = (
  id: number, name: string, category_id: string, rating: number, releaseDate: string,
): XtreamSeries => ({
  series_id: id,
  name,
  category_id,
  cover: '',
  plot: '',
  rating,
  releaseDate,
});

export const MOCK_SERIES: XtreamSeries[] = [
  SERIES(8001, 'Northern Lights',     's-drama',  8.2, '2023-09-12'),
  SERIES(8002, 'The Glass Office',    's-drama',  7.9, '2022-04-03'),
  SERIES(8101, 'Roommate Rules',      's-comedy', 7.6, '2021-11-01'),
  SERIES(8102, 'Two Left Feet',       's-comedy', 7.4, '2024-02-14'),
  SERIES(8201, 'Cold Cases',          's-crime',  8.5, '2020-10-20'),
  SERIES(8202, 'Precinct Twelve',     's-crime',  8.0, '2023-06-05'),
  SERIES(8301, 'Orbital',             's-scifi',  8.6, '2024-08-30'),
  SERIES(8302, 'Beyond the Veil',     's-scifi',  7.8, '2022-07-22'),
];

const SERIES_PLOT: Record<string, string> = {
  's-drama':  'An ensemble cast navigates loyalty, ambition and quiet heartbreak in a town where nothing stays buried for long.',
  's-comedy': 'A pitch-perfect cast finds the absurd in the everyday — and the family in the people they never asked for.',
  's-crime':  'Cases that fell through the cracks come roaring back when a stubborn detective refuses to file them away.',
  's-scifi':  'A near-future thriller about the cost of crossing lines we promised we never would.',
};

const mockEpisode = (seasonNum: number, epNum: number, seriesId: number): import('./xtream').XtreamEpisode => ({
  id: `${seriesId}${seasonNum}${String(epNum).padStart(2, '0')}`,
  episode_num: epNum,
  title: `Episode ${epNum}`,
  container_extension: 'mp4',
  info: {
    plot: 'A pivotal hour that pushes the story into new territory.',
    duration: '00:45:00',
  },
});

export function mockSeriesInfo(s: XtreamSeries): XtreamSeriesInfo {
  const seasons = [1, 2].map(n => ({ season_number: n, name: `Season ${n}`, episode_count: 6 }));
  const episodes: Record<string, import('./xtream').XtreamEpisode[]> = {};
  for (const sn of seasons) {
    episodes[String(sn.season_number)] = Array.from({ length: sn.episode_count! }, (_, i) =>
      mockEpisode(sn.season_number, i + 1, s.series_id),
    );
  }
  return {
    info: {
      name: s.name,
      plot: SERIES_PLOT[s.category_id || ''] || 'A standout series with unforgettable characters.',
      genre: (MOCK_SERIES_CATEGORIES.find(c => c.category_id === s.category_id)?.category_name) || 'Series',
      releaseDate: s.releaseDate,
      rating: s.rating,
    },
    seasons,
    episodes,
  };
}
