// Game Day: today's big games and every channel on this box that carries each.
//
// The games come from the game-day edge function — one shared list, a few
// minutes old at most — with the national TV networks and the local and
// regional ones (RSNs) showing each. The channels are this box's own: the
// whole line-up of each line (the same list Live TV search keeps), or on a
// box short of memory the league, sports and network categories, the
// leagues' first. Never more than ten minutes old: providers rename their
// event channels for each day's games.
//
// A game's channels ("links"), best first:
//   game     an event channel whose name has the game: "MLB 07: Yankees vs
//            Red Sox 7:05 PM", "PPV 3: NYY @ BOS", "UFC 320: Ankalaev vs
//            Pereira". These mostly have no guide; the name is what changes
//            with each day's games. Only when no name has the game, a
//            numbered league channel ("MLB 07") whose guide does.
//   network  the national networks showing it (ESPN, FS1, FOX and its locals)
//   local    the local and regional networks showing it (YES, NESN, Bally …)
//   team     a channel named after one of the teams, in that league
//   league   the league's own channels ("MLB Zone", "NFL RedZone", "NBA TV")
// The networks and locals do have a guide: as a game's list opens, it says
// which of them has this game (and which has another one), and finds the
// teams' cities' channels that have it (checkGuides).
// Streaming-only services (MLB.tv, ESPN+, Peacock …) are never links: no line
// carries them as a channel.
import { supabase } from '@/integrations/supabase/client';
import {
  decodeEpgText, getLiveCategories, getLiveStreams, getShortEpg, parseEpgTime,
  type XtreamCategory, type XtreamCreds, type XtreamEpgEntry, type XtreamLiveStream,
} from '@/lib/xtream';
import { cleanChannelName, normalizeSpeech } from '@/lib/voiceCommands';

export interface GameTeam { name: string; short: string; abbr: string; location: string; logo: string | null; score: string | null }
export interface GameLocal { name: string; market: 'home' | 'away' }
export interface Game {
  id: string; league: string; leagueLabel: string; name: string; start: string;
  state: 'pre' | 'in'; detail: string; home: GameTeam | null; away: GameTeam | null; networks: string[];
  /** Local and regional TV (older lists from the function have none). */
  locals?: GameLocal[];
}

export type LinkKind = 'game' | 'network' | 'local' | 'team' | 'league';
export const LINK_LABELS: Record<LinkKind, string> = {
  game: 'Game channel', network: 'National TV', local: 'Local & regional', team: 'Team channel', league: 'League channel',
};

/** A channel on one of the box's lines, as Game Day sees it. */
export interface SportsChannel {
  line: XtreamCreds;
  stream: XtreamLiveStream;
  /** The channel name, cleaned ("us| espn hd" → "espn"): networks go by it. */
  name: string;
  /** The whole name in plain words, what is in brackets too, with a space at
   *  each end ("MLB 07 [Yankees vs Red Sox]" → " mlb 07 yankees vs red sox "):
   *  teams and events go by it. */
  full: string;
  /** Its category's name, normalised. */
  cat: string;
  /** Leagues its name or category mention. */
  leagues: string[];
}

/** A link for one game. */
export interface GameChannel { line: XtreamCreds; stream: XtreamLiveStream; score: number; via: LinkKind; note?: string }

const GAMES_TTL_MS = 3 * 60_000;
/** How old this box's channel list may get: event channels are renamed for
 *  each day's games. */
export const CHANNELS_TTL_MS = 10 * 60_000;
/** Categories read per line when the whole line-up is not (low memory). */
const MAX_CATEGORIES_PER_LINE = 24;

let gamesCache: { at: number; games: Game[] } | null = null;

export async function fetchGames(force = false): Promise<Game[]> {
  if (!force && gamesCache && Date.now() - gamesCache.at < GAMES_TTL_MS) return gamesCache.games;
  const { data, error } = await supabase.functions.invoke('game-day', { body: { op: 'list' } });
  if (error) throw error;
  const games = Array.isArray((data as { games?: unknown })?.games) ? (data as { games: Game[] }).games : [];
  gamesCache = { at: Date.now(), games };
  return games;
}

// ── leagues, sports and networks by name ───────────────────────────────────

/** League words, by league id (as the game-day function names them). PPV and
 *  event channels are no league's: a PPV channel shows a baseball game as
 *  often as a fight. */
const LEAGUE_WORDS: Record<string, RegExp> = {
  nfl: /\b(nfl|red ?zone|sunday ticket)\b/,
  ncaaf: /\b(ncaaf|ncaa football|college football|cfb|sec network|acc network|big ten network|btn)\b/,
  nba: /\b(nba|league pass)\b/,
  wnba: /\b(wnba)\b/,
  ncaab: /\b(ncaab|ncaa basketball|college basketball|march madness)\b/,
  mlb: /\b(mlb|extra innings)\b/,
  nhl: /\b(nhl|center ice)\b/,
  mls: /\b(mls|season pass)\b/,
  epl: /\b(epl|premier league)\b/,
  ucl: /\b(ucl|champions league)\b/,
  ufc: /\b(ufc|fight night)\b/,
};
/** A sport's word stands for its leagues ("Baseball" → MLB). */
const SPORT_LEAGUES: Array<[RegExp, string[]]> = [
  [/\bbaseball\b/, ['mlb']],
  [/\bhockey\b/, ['nhl']],
  [/\bbasketball\b/, ['nba', 'wnba', 'ncaab']],
  [/\bfootball\b/, ['nfl', 'ncaaf']],
  [/\b(soccer|futbol)\b/, ['mls', 'epl', 'ucl']],
  [/\b(mma|boxing|fights?)\b/, ['ufc']],
];

/** Leagues named outright ("NFL", "MLB"), not by their sport's word. */
const namedLeagues = (text: string): string[] =>
  Object.entries(LEAGUE_WORDS).filter(([, re]) => re.test(text)).map(([id]) => id);

export function leaguesIn(text: string): string[] {
  const out = new Set(namedLeagues(text));
  for (const [re, ids] of SPORT_LEAGUES) if (re.test(text)) for (const id of ids) out.add(id);
  return [...out];
}

const SPORT = /\b(sports?|espn|ppv|pay per view|events?|live events?|game ?day|zone|dazn|fubo|bein|tsn|sky sports|golf|tennis|racing|f1|nascar|wrestling|wwe|aew)\b/;
const NETWORK = /\b(networks?|locals?|regionals?|rsn|abc|cbs|nbc|fox|tnt|tbs|usa|us|united states|america|american|entertainment)\b/;
const NOT_SPORTS = /\b(kids?|children|cartoons?|music|radio|religious|faith|adult|xxx|movies?|cinema|vod|series)\b/;
/** PPV and event categories: any league's games, and the fight cards'. */
const EVENTS = /\b(ppv|pay per view|events?)\b/;

const normalise = (s: string): string => normalizeSpeech(String(s ?? '').replace(/[|:_/-]+/g, ' '));

/** How much a category matters to Game Day: 3 for a league's ("MLB ZONE"),
 *  2 for sports and events ("US| SPORTS", "PPV"), 1 for networks, locals and
 *  general US categories (where ESPN and FOX often live), 0 for the rest. */
export const categoryWeight = (name: string): number => {
  const n = normalise(name);
  if (NOT_SPORTS.test(n)) return 0;
  return leaguesIn(n).length ? 3 : SPORT.test(n) ? 2 : NETWORK.test(n) ? 1 : 0;
};

const lowMemory = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

/** One channel as Game Day reads it (null for a nameless one). */
export function sportsChannel(line: XtreamCreds, stream: XtreamLiveStream, catName = ''): SportsChannel | null {
  const raw = String(stream?.name ?? '');
  const name = cleanChannelName(raw);
  if (!name) return null;
  const cat = normalise(catName);
  const words = normalise(raw);
  return { line, stream, name, full: ` ${words} `, cat, leagues: leaguesIn(`${cat} ${words}`) };
}

let channelsCache: { key: string; at: number; list: SportsChannel[] } | null = null;

/** This box's channels Game Day can use, across its lines, at most ten
 *  minutes old (a kept list older than that is asked for again). */
export async function loadSportsChannels(lines: XtreamCreds[]): Promise<SportsChannel[]> {
  const key = lines.map((l) => `${l.host}|${l.username}`).join(',');
  if (channelsCache && channelsCache.key === key && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.list;
  const fresh = { maxAgeMs: CHANNELS_TTL_MS };
  const out: SportsChannel[] = [];
  const add = (line: XtreamCreds, stream: XtreamLiveStream, catName: string) => {
    const c = sportsChannel(line, stream, catName);
    if (c) out.push(c);
  };
  for (const line of lines) {
    let cats: XtreamCategory[] = [];
    try { cats = await getLiveCategories(line); } catch { continue; }
    const catName = new Map(cats.map((c) => [String(c.category_id), String(c.category_name ?? '')]));
    const weight = new Map(cats.map((c) => [String(c.category_id), categoryWeight(c.category_name)]));
    if (!lowMemory()) {
      // The whole line-up: the list Live TV search keeps (one request, shared).
      let all: XtreamLiveStream[] = [];
      try { all = await getLiveStreams(line, undefined, fresh); } catch { all = []; }
      if (all.length) {
        for (const s of all) {
          const id = String(s.category_id ?? '');
          const n = normalise(String(s.name ?? ''));
          if ((weight.get(id) ?? 0) > 0 || SPORT.test(n) || leaguesIn(n).length) add(line, s, catName.get(id) ?? '');
        }
        continue;
      }
    }
    // A box short of memory (or a line-up that would not load whole): the
    // best categories, the leagues' first, three at a time so the panel sees
    // a short burst.
    const picked = cats
      .map((c) => ({ c, w: categoryWeight(c.category_name) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_CATEGORIES_PER_LINE);
    for (let i = 0; i < picked.length; i += 3) {
      const lists = await Promise.all(picked.slice(i, i + 3).map(({ c }) =>
        getLiveStreams(line, String(c.category_id), fresh).then((l) => ({ c, l })).catch(() => ({ c, l: [] as XtreamLiveStream[] }))));
      for (const { c, l } of lists) for (const s of l) add(line, s, String(c.category_name ?? ''));
    }
  }
  channelsCache = { key, at: Date.now(), list: out };
  return out;
}

// ── networks ───────────────────────────────────────────────────────────────

/** What ESPN calls a network → what providers call the channel. */
const NETWORK_ALIASES: Record<string, string[]> = {
  fs1: ['fox sports 1', 'fs1'], fs2: ['fox sports 2', 'fs2'], espn2: ['espn 2', 'espn2'], espnu: ['espnu', 'espn u'],
  espnews: ['espnews'], secn: ['sec network'], 'sec network': ['sec network'], accn: ['acc network'], 'acc network': ['acc network'],
  btn: ['big ten network', 'btn'], 'big ten network': ['big ten network', 'btn'],
  cbssn: ['cbs sports network', 'cbssn'], 'cbs sports network': ['cbs sports network', 'cbssn'],
  'nfl net': ['nfl network'], nfln: ['nfl network'], 'nfl network': ['nfl network'],
  'mlb net': ['mlb network'], mlbn: ['mlb network'], 'mlb network': ['mlb network'],
  'nhl net': ['nhl network'], nhln: ['nhl network'], 'nhl network': ['nhl network'],
  'nba tv': ['nba tv'], 'usa net': ['usa network'], usa: ['usa network'], 'usa network': ['usa network'],
  trutv: ['trutv', 'tru tv'], golf: ['golf channel'], tnt: ['tnt'], tbs: ['tbs'], abc: ['abc'],
  cbs: ['cbs'], nbc: ['nbc'], fox: ['fox'], espn: ['espn'], 'espn deportes': ['espn deportes'], univision: ['univision'],
  telemundo: ['telemundo'], 'fox deportes': ['fox deportes'], tudn: ['tudn'], unimas: ['unimas'],
  // Regional sports networks go by several names.
  'bally sports': ['bally sports', 'fanduel sports', 'fanduel sn'], 'fanduel sn': ['fanduel sports', 'fanduel sn', 'bally sports'],
  'fanduel sports': ['fanduel sports', 'fanduel sn', 'bally sports'],
  msg: ['msg'], 'msg sn': ['msg sportsnet', 'msg sn'], nesn: ['nesn'], yes: ['yes network', 'yes'], sny: ['sny'],
  'marquee sports network': ['marquee'], marquee: ['marquee'], 'spectrum sportsnet': ['spectrum sportsnet', 'spectrum sn'],
  'nbc sports': ['nbc sports'], 'root sports': ['root sports'], altitude: ['altitude'], 'monumental sports': ['monumental'],
  sportsnet: ['sportsnet'], tsn: ['tsn'],
};
/** Streaming-only services no line carries as a channel. */
const STREAMING_ONLY = /(espn\+|\bpeacock\b|prime video|\bprime\b|paramount\+|apple tv|\bmax\b|netflix|youtube|dazn app|nfl\+|mlb\.?tv|nba league pass|nhl\.?tv|nhl power play|mls season pass|espn app|\bstreaming\b|\b\w+\.tv\b)/i;

export const isStreamingOnly = (network: string): boolean => STREAMING_ONLY.test(network);

const aliasesFor = (network: string): string[] => {
  const k = normalizeSpeech(network).replace(/\s+/g, ' ');
  if (NETWORK_ALIASES[k]) return NETWORK_ALIASES[k];
  // "Bally Sports Detroit", "FanDuel SN Ohio": the exact name, then the
  // same station under the family's other names.
  for (const [fam, names] of Object.entries(NETWORK_ALIASES)) {
    if (k.startsWith(`${fam} `)) return [k, ...names.map((n) => `${n}${k.slice(fam.length)}`)];
  }
  return [k];
};

interface Alias { text: string; words: string[]; head: string }
/** A game's networks' names as providers write them, split once. */
const aliasList = (networks: string[]): Alias[] => networks
  .filter((n) => !isStreamingOnly(n))
  .flatMap(aliasesFor)
  .filter(Boolean)
  .map((text) => {
    const words = text.split(' ');
    return { text, words, head: `${words[0]} ` };
  });

/** Channels that start with a network's name but are another network:
 *  "FOX" is not "FOX Sports 1" or "FOX News". */
const OTHER_NETWORK = new Set(['sports', 'sport', 'news', 'business', 'deportes', 'soccer', 'life', 'kids', 'family', 'movies', 'classics', 'weather', 'nation', 'reelz', 'xtra', 'plus', 'u', 'soul', 'nuestra']);

/** How many of a channel's first words an alias covers, when each alias word
 *  is that word or (from three letters) the start of it: ESPN writes "NBC
 *  Sports Phil" for "NBC Sports Philadelphia". 0 when it doesn't. */
const aliasWords = (a: string[], c: string[]): number => {
  if (a.length > c.length) return 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === c[i]) continue;
    if (a[i].length >= 3 && i === a.length - 1 && i > 0 && c[i].startsWith(a[i])) continue;
    return 0;
  }
  return a.length;
};

/** How well a channel name is a network: 90 exactly, 75 a feed of it
 *  ("FOX 32 Chicago", "ESPN HD"), 0 otherwise. */
const networkScore = (a: Alias, channel: string, words: string[]): number => {
  if (channel === a.text) return 90;
  const n = aliasWords(a.words, words);
  if (!n) return 0;
  if (n === words.length) return 90;
  const rest = words.slice(n);
  // "ESPN 2" is ESPN2; "FOX 5 New York" is a FOX station.
  if (rest.length === 1 && /^\d$/.test(rest[0])) return 0;
  return OTHER_NETWORK.has(rest[0]) ? 0 : 75;
};

/** The best of a game's networks a channel is (0: none). */
const bestNetwork = (aliases: Alias[], channel: string): number => {
  let best = 0;
  let words: string[] | null = null;
  for (const a of aliases) {
    // Most channels start with another word: no need to look closer.
    if (channel !== a.words[0] && !channel.startsWith(a.head)) continue;
    if (!words) words = channel.split(' ');
    best = Math.max(best, networkScore(a, channel, words));
  }
  return best;
};

// ── teams, fight cards and the day ─────────────────────────────────────────

/** Words as they sit in a spaced text: " red sox ". */
const spaced = (ws: string[]): string[] => ws.map((w) => ` ${w} `);
/** Whether a spaced text has one of some spaced words. */
const has = (text: string, words: string[]): boolean => words.some((w) => text.includes(w));

/** Names providers use for a team besides ESPN's. */
const TEAM_NICKNAMES: Record<string, string[]> = {
  '76ers': ['sixers'], 'trail blazers': ['blazers'], timberwolves: ['wolves', 'twolves'], cavaliers: ['cavs'], mavericks: ['mavs'],
  diamondbacks: ['d backs', 'dbacks'], 'red sox': ['redsox'], 'white sox': ['whitesox'], 'blue jays': ['jays', 'bluejays'],
  'maple leafs': ['leafs'], canadiens: ['habs'], 'golden knights': ['knights'], '49ers': ['niners'], buccaneers: ['bucs'],
  'manchester united': ['man utd', 'man united'], 'manchester city': ['man city'], 'tottenham hotspur': ['spurs'],
  'wolverhampton wanderers': ['wolves'],
};
/** Short codes that are also words ("NO" for New Orleans). */
const NOT_A_CODE = new Set(['no', 'at', 'vs', 'in', 'on', 'or', 'is', 'it', 'as', 'of', 'to', 'tv', 'hd', 'sd', 'us', 'uk', 'the']);

/** A team's words, spaced: its own names ("Packers", "Green Bay Packers",
 *  "Sixers"), its place ("Green Bay") and its short code ("GB"). A place
 *  alone names half the local channels in a city, so it only counts next to
 *  the other team. College teams go by their school ("Florida", "Miami"),
 *  which is a place too: `shortPlace`, which names the team only next to the
 *  other one ("Tennessee vs Florida"), never alone ("FanDuel Sports Florida",
 *  "NBC 6 Miami"). */
interface TeamWords { own: string[]; shortPlace: string[]; place: string[]; code: string[] }
const teamWords = (t: GameTeam | null): TeamWords => {
  if (!t) return { own: [], shortPlace: [], place: [], code: [] };
  const clean = (ws: string[]) => [...new Set(ws.map((w) => normalizeSpeech(String(w ?? ''))).filter((w) => w.length >= 3))];
  const loc = clean([t.location]);
  const shortPlace = clean([t.short]).filter((w) => loc.some((l) => l === w || ` ${l} `.includes(` ${w} `) || ` ${w} `.includes(` ${l} `)));
  const names = clean([t.short, t.name]);
  const own = [...new Set([...names, ...names.flatMap((w) => TEAM_NICKNAMES[w] ?? [])])].filter((w) => !shortPlace.includes(w));
  const code = normalizeSpeech(String(t.abbr ?? ''));
  return {
    own: spaced(own),
    shortPlace: spaced(shortPlace),
    place: spaced(loc.filter((w) => !own.includes(w) && !shortPlace.includes(w))),
    code: /^[a-z0-9]{2,4}$/.test(code) && !NOT_A_CODE.has(code) ? spaced([code]) : [],
  };
};

interface Side { strong: boolean; weak: boolean }
/** How a spaced text names a team: by its own name, its school or (on a
 *  channel of its league) its short code — strongly; by its city — weakly. */
const sideIn = (text: string, w: TeamWords, codes: boolean): Side => ({
  strong: has(text, w.own) || has(text, w.shortPlace) || (codes && has(text, w.code)),
  weak: has(text, w.place),
});

interface Card { event: string[]; fighters: string[] }
/** A fight card's words: its number ("ufc 320") and its two headliners. */
const cardWords = (g: Game): Card => {
  const n = normalizeSpeech(String(g.name ?? ''));
  const num = /\bufc \d{2,3}\b/.exec(n)?.[0];
  const vs = /([a-z]+)(?: \d+)? vs ([a-z]+)/.exec(n);
  const fighters = vs ? [vs[1], vs[2]].filter((w) => w.length >= 3) : [];
  return { event: num ? spaced([num]) : [], fighters: fighters.length === 2 ? spaced(fighters) : [] };
};
const cardIn = (text: string, c: Card): boolean =>
  has(text, c.event) || (c.fighters.length === 2 && c.fighters.every((f) => text.includes(f)));

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = `(${Object.keys(MONTHS).join('|')})`;

/** The dates written in a channel name, as month × 100 + day. Numbers alone
 *  are read both ways round: providers write 09/24 and 24/09. Never "24/7",
 *  and never two single digits ("1/2"): too likely something else. */
export function nameDates(raw: string): number[] {
  const s = ` ${String(raw ?? '').toLowerCase()} `;
  const out: number[] = [];
  const put = (m: number, d: number) => { if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push(m * 100 + d); };
  let x: RegExpExecArray | null;
  const iso = /\b20\d\d-(\d{1,2})-(\d{1,2})\b/g;
  while ((x = iso.exec(s))) put(Number(x[1]), Number(x[2]));
  const nums = /(^|[^\d/:.])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;
  while ((x = nums.exec(s))) {
    const a = Number(x[2]), b = Number(x[3]);
    if ((a === 24 && b === 7) || (x[2].length === 1 && x[3].length === 1 && !x[4])) continue;
    put(a, b);
    put(b, a);
  }
  const monthDay = new RegExp(`\\b${MONTH}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?![\\d:])`, 'g');
  while ((x = monthDay.exec(s))) put(MONTHS[x[1]], Number(x[2]));
  const dayMonth = new RegExp(`(^|[^\\d:])(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH}\\b`, 'g');
  while ((x = dayMonth.exec(s))) put(MONTHS[x[3]], Number(x[2]));
  return out;
}

const ZONES: Record<string, string> = {
  et: 'America/New_York', est: 'America/New_York', edt: 'America/New_York',
  ct: 'America/Chicago', cst: 'America/Chicago', cdt: 'America/Chicago',
  mt: 'America/Denver', mst: 'America/Denver', mdt: 'America/Denver',
  pt: 'America/Los_Angeles', pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles',
  uk: 'Europe/London', bst: 'Europe/London', gmt: 'Europe/London', utc: 'UTC', cet: 'Europe/Paris', cest: 'Europe/Paris',
};
const ZONE = `(${Object.keys(ZONES).join('|')})`;
/** With no zone written, a time may be on any of these clocks (or the box's). */
const ANY_ZONE: Array<string | undefined> = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'UTC', undefined];

export interface NameTime { mins: number[]; zone?: string }
/** The times written in a channel name ("7:05 PM ET", "19:05", "7pm"), as
 *  minutes after midnight: both ways for a 12-hour time without am or pm. */
export function nameTimes(raw: string): NameTime[] {
  const s = ` ${String(raw ?? '').toLowerCase().replace(/([ap])\.m\.?/g, '$1m')} `;
  const out: NameTime[] = [];
  const put = (h: number, m: number, ap: string | undefined, zone: string | undefined) => {
    if (h > 23 || m > 59) return;
    let mins: number[];
    if (ap) {
      if (h < 1 || h > 12) return;
      mins = [((h % 12) + (ap[0] === 'p' ? 12 : 0)) * 60 + m];
    } else {
      mins = h === 0 || h > 12 ? [h * 60 + m] : [(h % 12) * 60 + m, ((h % 12) + 12) * 60 + m];
    }
    out.push({ mins, zone: zone ? ZONES[zone] : undefined });
  };
  let x: RegExpExecArray | null;
  const clock = new RegExp(`(^|[^\\d:/.])(\\d{1,2}):(\\d{2})(?!\\d)\\s*(am|pm|a|p)?(?:\\s*${ZONE})?\\b`, 'g');
  while ((x = clock.exec(s))) put(Number(x[2]), Number(x[3]), x[4], x[5]);
  const hour = new RegExp(`(^|[^\\d:/.])(\\d{1,2})(?:\\.(\\d{2}))?\\s*(am|pm)(?:\\s*${ZONE})?\\b`, 'g');
  while ((x = hour.exec(s))) put(Number(x[2]), x[3] ? Number(x[3]) : 0, x[4], x[5]);
  return out;
}

const clocks = new Map<string, Intl.DateTimeFormat | null>();
/** Minutes after midnight of an instant on a zone's clock (the box's own
 *  when none is given); NaN when the zone is unknown here. */
const clockMinutes = (at: Date, zone?: string): number => {
  const k = zone ?? '';
  let f = clocks.get(k);
  if (f === undefined) {
    try { f = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: zone }); } catch { f = null; }
    clocks.set(k, f);
  }
  if (!f) return NaN;
  let h = NaN, m = NaN;
  for (const p of f.formatToParts(at)) {
    if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') m = Number(p.value);
  }
  return h * 60 + m;
};

/** Whether a name's times include the kickoff, 20 minutes either way. */
const timeMatches = (times: NameTime[], at: Date): boolean => times.some((t) =>
  (t.zone ? [t.zone] : ANY_ZONE).some((z) => {
    const kick = clockMinutes(at, z);
    return t.mins.some((m) => {
      const d = Math.abs(m - kick) % 1440;
      return Math.min(d, 1440 - d) <= 20;
    });
  }));

interface When { at: Date; days: Set<number> }
/** The kickoff, and the dates it falls on from Hawaii to Moscow: a UK
 *  line-up dates a 7 PM Eastern game the next day. */
const gameWhen = (start: string): When | null => {
  const t = Date.parse(start);
  if (!Number.isFinite(t)) return null;
  const days = new Set<number>();
  for (const h of [-10, 3]) {
    const d = new Date(t + h * 3_600_000);
    days.add((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
  }
  return { at: new Date(t), days };
};

interface GameWords { home: TeamWords; away: TeamWords; card: Card | null; when: When | null }
const gameWords = (g: Game): GameWords => {
  const home = teamWords(g.home), away = teamWords(g.away);
  // A city both teams share tells neither apart (Yankees vs Mets).
  const shared = home.place.filter((p) => away.place.includes(p));
  if (shared.length) {
    home.place = home.place.filter((p) => !shared.includes(p));
    away.place = away.place.filter((p) => !shared.includes(p));
  }
  return { home, away, card: !g.home && !g.away ? cardWords(g) : null, when: gameWhen(g.start) };
};

/** How well an event channel's name has the game: 100 by the teams' names
 *  (or a card's number or headliners), 90 by their cities alone on a channel
 *  of the league; 12 less when it gives another kickoff time (the other game
 *  of a doubleheader). 0 when it doesn't have the game; -1 when it has it on
 *  another day (a name not yet changed from yesterday's game): then the
 *  channel is nothing to this game. */
const eventScore = (c: SportsChannel, w: GameWords, inLeague: boolean): number => {
  let score = 0;
  if (w.card) {
    if (cardIn(c.full, w.card)) score = 100;
  } else {
    const h = sideIn(c.full, w.home, inLeague), a = sideIn(c.full, w.away, inLeague);
    if ((h.strong || h.weak) && (a.strong || a.weak)) score = h.strong || a.strong ? 100 : inLeague ? 90 : 0;
  }
  if (!score || !w.when) return score;
  const raw = String(c.stream?.name ?? '');
  const days = nameDates(raw);
  if (days.length && !days.some((d) => w.when!.days.has(d))) return -1;
  const times = nameTimes(raw);
  return times.length && !timeMatches(times, w.when.at) ? score - 12 : score;
};

// ── a game's channels ──────────────────────────────────────────────────────

const SOCCER = new Set(['mls', 'epl', 'ucl']);
/** A channel of another league: never this game's ("Kings", "Rangers",
 *  "Giants" and "Cardinals" play in two leagues each). A "Football" channel
 *  that names no league is soccer as often as not. */
const otherLeague = (c: SportsChannel, league: string): boolean => {
  if (!c.leagues.length || c.leagues.includes(league)) return false;
  if (SOCCER.has(league)) {
    const text = `${c.cat} ${c.full}`;
    if (/\bfootball\b/.test(text) && !namedLeagues(text).length) return false;
  }
  return true;
};

/** A league's own channel: "MLB Zone", "NFL RedZone", "NBA TV", "NHL Network". */
const LEAGUE_CHANNEL = /\b(zone|redzone|network|tv|extra innings|center ice|league pass|sunday ticket|season pass|multi ?view|mix|channel)\b/;

/** A numbered channel of a league with no game in its name ("MLB 05",
 *  "NBA Event 3"; for a fight card, "PPV 05" too). */
const isNumberedEvent = (c: SportsChannel, league: string): boolean =>
  (c.leagues.includes(league) || (league === 'ufc' && EVENTS.test(`${c.cat} ${c.name}`)))
  && /\b\d{1,3}\b/.test(c.name) && !LEAGUE_CHANNEL.test(c.name);

const linkKey = (l: { line: XtreamCreds; stream: XtreamLiveStream }): string => `${l.line.host}|${l.line.username}|${l.stream.stream_id}`;

/** This box's channels for a game, best first (at most `limit`). */
export function channelsForGame(game: Game, channels: SportsChannel[], limit = 12): GameChannel[] {
  const w = gameWords(game);
  const nets = aliasList(game.networks);
  const locals = aliasList((game.locals ?? []).map((l) => l.name));
  const places = [...w.home.place, ...w.away.place, ...w.home.own, ...w.away.own, ...w.home.shortPlace, ...w.away.shortPlace];
  const found: GameChannel[] = [];
  let leagueLinks = 0;
  for (const c of channels) {
    const inLeague = c.leagues.includes(game.league);
    const other = !inLeague && otherLeague(c, game.league);
    if (!other) {
      const s = eventScore(c, w, inLeague);
      if (s < 0) continue;
      if (s > 0) { found.push({ line: c.line, stream: c.stream, score: s, via: 'game' }); continue; }
    }
    // Otherwise the best of what it is for this game.
    let score = 0;
    let via: LinkKind = 'team';
    if (!other && (has(c.full, w.home.own) || has(c.full, w.away.own))) score = inLeague ? 60 : 45;
    const net = bestNetwork(nets, c.name);
    if (net > 0) {
      // A local station of a national network: the teams' own cities first.
      const s = net === 90 ? 70 : has(` ${c.name} `, places) ? 62 : 52;
      if (s > score) { score = s; via = 'network'; }
    }
    const local = bestNetwork(locals, c.name);
    if (local > 0) {
      const s = local === 90 ? 66 : 58;
      if (s > score) { score = s; via = 'local'; }
    }
    if (!score && leagueLinks < 4 && inLeague && LEAGUE_CHANNEL.test(c.name) && !isNumberedEvent(c, game.league)) {
      leagueLinks += 1;
      score = 30;
      via = 'league';
    }
    if (score > 0) found.push({ line: c.line, stream: c.stream, score, via });
  }
  found.sort((x, y) => y.score - x.score);
  const seen = new Set<string>();
  const out: GameChannel[] = [];
  for (const f of found) {
    const k = linkKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/** The categories of the game's league on this box (for a fight card, the
 *  PPV and event ones too), for "Browse in Live TV". */
export function leagueCategories(game: Game, channels: SportsChannel[], limit = 3): Array<{ line: XtreamCreds; categoryId: string; name: string }> {
  const out: Array<{ line: XtreamCreds; categoryId: string; name: string }> = [];
  const seen = new Set<string>();
  for (const c of channels) {
    if (!leaguesIn(c.cat).includes(game.league) && !(game.league === 'ufc' && EVENTS.test(c.cat))) continue;
    const id = String(c.stream.category_id ?? '');
    const k = `${c.line.host}|${c.line.username}|${id}`;
    if (!id || seen.has(k)) continue;
    seen.add(k);
    out.push({ line: c.line, categoryId: id, name: c.cat.toUpperCase() });
    if (out.length >= limit) break;
  }
  return out;
}

// ── the guide ──────────────────────────────────────────────────────────────

/** Guide lookups for one game's list, at most, four at a time. */
const GUIDE_MAX = { found: 10, city: 8, numbered: 8 };
/** A game further off than this is past what a short guide covers. */
const GUIDE_AHEAD_MS = 6 * 60 * 60_000;
const guideCache = new Map<string, { at: number; from: SportsChannel[]; links: GameChannel[] }>();

interface Listing { title: string; description: string; start: number; end: number }
const readGuide = (entries: XtreamEpgEntry[]): Listing[] => entries
  .map((e) => ({
    title: decodeEpgText(e.title),
    description: decodeEpgText(e.description),
    start: parseEpgTime(e.start_timestamp || e.start),
    end: parseEpgTime(e.stop_timestamp || e.end),
  }))
  .filter((e) => e.start > 0 && e.end > e.start);

/** Whether a guide listing (spaced words) is a game: both teams, one of them
 *  by name (short codes are not enough here: "no" and "ne" are words), or a
 *  card's number or headliners. */
const listingHas = (text: string, g: Game): boolean => {
  if (!g.home && !g.away) return cardIn(text, cardWords(g));
  const w = gameWords(g);
  const h = sideIn(text, w.home, false), a = sideIn(text, w.away, false);
  return (h.strong && (a.strong || a.weak)) || (a.strong && h.weak);
};
const listingText = (e: Listing): string => ` ${normalizeSpeech(`${e.title} ${e.description}`)} `;
const guideNote = (e: Listing, g: Game): string => {
  const title = e.title.trim();
  const more = listingHas(` ${normalizeSpeech(title)} `, g) ? '' : e.description.trim();
  const s = more ? `${title} — ${more}` : title;
  return `Guide: ${s.length > 140 ? `${s.slice(0, 139)}…` : s}`;
};

/** What the guide says about a game's channels, as links to lay over the
 *  list: the networks and locals found by name that the guide shows with this
 *  game (first) or with another of today's games (last); the teams' cities'
 *  channels the guide shows with it; and, when no channel's name has the
 *  game, the league's numbered channels the guide shows with it. Looked at
 *  around kickoff (now, for a game under way); kept ten minutes. */
export async function checkGuides(game: Game, channels: SportsChannel[], found: GameChannel[], games: Game[] = [], now = Date.now()): Promise<GameChannel[]> {
  const hit = guideCache.get(game.id);
  if (hit && hit.from === channels && now - hit.at < CHANNELS_TTL_MS) return hit.links;
  const start = Date.parse(game.start);
  const live = game.state === 'in';
  if (!live && !(start - now < GUIDE_AHEAD_MS)) return [];
  const at = live || !Number.isFinite(start) ? now : Math.max(now, start + 10 * 60_000);

  const seen = new Set<string>();
  const cands: Array<{ line: XtreamCreds; stream: XtreamLiveStream; via: LinkKind; was?: GameChannel }> = [];
  for (const f of found) {
    if (f.via !== 'network' && f.via !== 'local') continue;
    if (cands.length >= GUIDE_MAX.found) break;
    seen.add(linkKey(f));
    cands.push({ line: f.line, stream: f.stream, via: f.via, was: f });
  }
  if (game.home || game.away) {
    const w = gameWords(game);
    const city = [...w.home.place, ...w.away.place, ...w.home.shortPlace, ...w.away.shortPlace, ...w.home.own, ...w.away.own];
    let n = 0;
    for (const c of channels) {
      if (n >= GUIDE_MAX.city) break;
      if (c.leagues.length || seen.has(linkKey(c)) || !has(` ${c.name} `, city)) continue;
      seen.add(linkKey(c));
      cands.push({ line: c.line, stream: c.stream, via: 'local' });
      n += 1;
    }
  }
  if (!found.some((f) => f.via === 'game')) {
    let n = 0;
    for (const c of channels) {
      if (n >= GUIDE_MAX.numbered) break;
      if (!isNumberedEvent(c, game.league) || seen.has(linkKey(c))) continue;
      seen.add(linkKey(c));
      cands.push({ line: c.line, stream: c.stream, via: 'game' });
      n += 1;
    }
  }

  const others = games.filter((g) => g.id !== game.id && g.league === game.league);
  const links: GameChannel[] = [];
  for (let i = 0; i < cands.length; i += 4) {
    const batch = await Promise.all(cands.slice(i, i + 4).map(async (cand): Promise<GameChannel | null> => {
      let around: Listing[];
      try {
        const { epg_listings } = await getShortEpg(cand.line, cand.stream.stream_id, 12);
        // What is on at kickoff, or starts within 45 minutes of it.
        around = readGuide(epg_listings ?? []).filter((e) => e.start <= at + 45 * 60_000 && e.end > at);
      } catch { return null; }
      for (const e of around) {
        if (listingHas(listingText(e), game)) {
          return { line: cand.line, stream: cand.stream, score: 95, via: cand.via, note: guideNote(e, game) };
        }
      }
      if (!cand.was) return null;
      for (const e of around) {
        const text = listingText(e);
        const other = others.find((g) => listingHas(text, g));
        if (other) return { ...cand.was, score: 20, note: `Guide: another game — ${other.name}` };
      }
      return null;
    }));
    for (const l of batch) if (l) links.push(l);
  }
  guideCache.set(game.id, { at: now, from: channels, links });
  return links;
}

// ── kickoff ────────────────────────────────────────────────────────────────

/** The day ('' for today, "Tomorrow", "Sat") and the time, apart: a narrow
 *  column shows them on two lines. */
export function kickoffParts(start: string, now = new Date()): { day: string; time: string } {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return { day: '', time };
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return { day: day(d) === day(tomorrow) ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short' }), time };
}

/** "7:30 PM", or "Tomorrow 1:00 PM". */
export function kickoffLabel(start: string, now = new Date()): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return time;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (day(d) === day(tomorrow)) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

/** Tests only. */
export function __resetGameDayForTests(): void { gamesCache = null; channelsCache = null; guideCache.clear(); }
