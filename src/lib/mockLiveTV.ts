// Mock channel + EPG data shown until the user enters real Xtream credentials.
import type { XtreamCategory, XtreamLiveStream } from './xtream';
import type { EpgNowNext } from './xtream';

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
  // Slot the current program in a 30-minute aligned window
  const slot = 30 * 60 * 1000;
  const start = Math.floor(now / slot) * slot;
  const end = start + slot;
  return {
    now:  { title: list[idx],                       start,           end,            description: 'Live programming' },
    next: { title: list[(idx + 1) % list.length],   start: end,      end: end + slot, description: 'Coming up next' },
  };
}
