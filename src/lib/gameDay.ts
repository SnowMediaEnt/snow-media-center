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
//            Red Sox 7:05 PM", "NBA ZONE 3: Lakers @ Celtics", "PPV 3: NYY @
//            BOS", "UFC 320: Ankalaev vs Pereira", "F1: Italian GP Race",
//            "NASCAR: Kansas". These mostly have no guide; the name is what
//            changes with each day's games. A numbered league channel ("MLB
//            07") whose guide has the game counts too: both are checked.
//   network  the national networks showing it (ESPN, FS1, FOX and its locals)
//   local    the local and regional networks showing it (YES, NESN, Bally …)
//   team     a channel named after one of the teams, in that league
//   league   the league's own channels ("MLB Zone", "NFL RedZone", "NBA TV")
// The networks and locals do have a guide: as a game's list opens, it says
// which of them has this game (and which has another one), and finds the
// teams' cities' channels that have it (checkGuides).
// Every sport the game-day function lists works the same way: the team
// sports, fight cards, and events without teams (races, golf and tennis
// tournaments), found by their name or their circuit, course or venue.
// PPV channels carry fights, festivals and small races, never a league's
// games: they are only ever a fight card's. What is on them comes from their
// own names ("PPV EVENT 02: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)"), as
// Game Day's PPV list (ppvGames).
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
  /** Events without teams (fight cards, races, golf and tennis): the event's
   *  own name ("Italian GP"), the race session ("Race", "Qualifying"), and
   *  the circuit, course or venue with its city ("Monza"). */
  event?: string; session?: string; places?: string[];
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
  ufl: /\b(ufl)\b/,
  nba: /\b(nba|league pass)\b/,
  wnba: /\b(wnba)\b/,
  ncaab: /\b(ncaab|ncaa basketball|college basketball|march madness)\b/,
  mlb: /\b(mlb|extra innings)\b/,
  nhl: /\b(nhl|center ice)\b/,
  mls: /\b(mls|season pass)\b/,
  nwsl: /\b(nwsl)\b/,
  ligamx: /\b(liga ?mx)\b/,
  epl: /\b(epl|premier league)\b/,
  laliga: /\b(la ?liga)\b/,
  seriea: /\b(serie a)\b/,
  bundesliga: /\b(bundesliga)\b/,
  ligue1: /\b(ligue 1|ligue1)\b/,
  ucl: /\b(ucl|champions league)\b/,
  uel: /\b(uel|europa league)\b/,
  ufc: /\b(ufc|fight night)\b/,
  f1: /\b(f1|formula ?1|formula one)\b/,
  nascar: /\b(nascar)\b/,
  indycar: /\b(indy ?car|indy 500)\b/,
  pga: /\b(pga)\b/,
  lpga: /\b(lpga)\b/,
  atp: /\b(atp)\b/,
  wta: /\b(wta)\b/,
};
const SOCCER_LEAGUES = ['mls', 'nwsl', 'ligamx', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'uel'];
/** A sport's word stands for its leagues ("Baseball" → MLB). */
const SPORT_LEAGUES: Array<[RegExp, string[]]> = [
  [/\bbaseball\b/, ['mlb']],
  [/\bhockey\b/, ['nhl']],
  [/\bbasketball\b/, ['nba', 'wnba', 'ncaab']],
  [/\bfootball\b/, ['nfl', 'ncaaf', 'ufl']],
  [/\b(soccer|futbol|futebol)\b/, SOCCER_LEAGUES],
  [/\b(mma|boxing|fights?)\b/, ['ufc']],
  [/\b(racing|motorsports?|motor sports?|speedway)\b/, ['f1', 'nascar', 'indycar']],
  [/\bgolf\b/, ['pga', 'lpga']],
  [/\btennis\b/, ['atp', 'wta']],
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
/** PPV and event categories: fight cards and events. */
const EVENTS = /\b(ppv|pay per view|events?)\b/;
/** Pay-per-view: fights, festivals and small races, never a league's games. */
const PPV = /\b(ppv|pay ?per ?view)\b/;

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

/** Words that say what kind of event it is, not which one: never enough on
 *  their own ("Grand Prix", "Championship", "Speedway", "Open"). */
const EVENT_GENERIC = new Set([
  'grand', 'prix', 'race', 'racing', 'formula', 'series', 'nascar', 'indycar', 'indy', 'championship', 'championships',
  'open', 'tour', 'pga', 'lpga', 'atp', 'wta', 'masters', 'international', 'classic', 'invitational', 'presented', 'world',
  'final', 'finals', 'round', 'session', 'qualifying', 'practice', 'sprint', 'live', 'tournament', 'event', 'stage', 'gran',
  'premio', 'club', 'golf', 'tennis', 'fight', 'night', 'main', 'card', 'prelims', 'early', 'speedway', 'motor', 'raceway',
  'autodromo', 'circuit', 'national', 'nazionale', 'park', 'country', 'stadium', 'arena', 'center', 'centre', 'street',
  'city', 'united', 'states', 'north', 'south', 'east', 'west', 'lake', 'beach', 'saint', 'santa', 'grande', 'royal',
  'cup', 'series', 'league', 'motorsports', 'international', 'course', 'links', 'resort', 'hills', 'springs', 'valley',
  'pres', 'presents', 'powered', 'sponsored',
]);
/** Title sponsors in race names ("Qatar Airways Azerbaijan GP"): the same
 *  sponsor names several races, so its words never name one. */
const EVENT_SPONSORS = /\b(qatar airways|singapore airlines|etihad airways|gulf air|emirates|heineken|aramco|pirelli|lenovo|msc cruises|aws|crypto ?com|rolex|louis vuitton|moet (?:&|and)? ?chandon|liqui moly|tag heuer|stc|salesforce|mastercard|dhl)\b/g;

/** An event's words: phrases one whole piece of which names it ("us open",
 *  "italian gp", "ufc 320", "kansas speedway"), single words that do alone
 *  ("italian", "monza", "kansas"), and for a fight card its two headliners,
 *  both needed ("ankalaev", "pereira"). */
interface Card { phrases: string[]; words: string[]; pair: string[] }
const cardWords = (g: Game): Card => {
  const name = normalizeSpeech(String(g.event || g.name || '').split(' · ')[0]);
  if (g.league === 'ufc') {
    const num = /\bufc \d{2,3}\b/.exec(name)?.[0];
    const vs = /([a-z]+)(?: \d+)? vs ([a-z]+)/.exec(name);
    const fighters = vs ? [vs[1], vs[2]].filter((w) => w.length >= 3) : [];
    return { phrases: num ? spaced([num]) : [], words: [], pair: fighters.length === 2 ? spaced(fighters) : [] };
  }
  const places = (g.places ?? []).map((p) => normalizeSpeech(String(p ?? ''))).filter(Boolean);
  const bare = name.replace(EVENT_SPONSORS, ' ').replace(/\s+/g, ' ').trim();
  const phrases = [name, bare, ...places].filter((p) => p.length >= 5 && (p.includes(' ') || !EVENT_GENERIC.has(p)));
  const words = [bare, ...places]
    .flatMap((p) => p.split(' '))
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !EVENT_GENERIC.has(w));
  return { phrases: spaced([...new Set(phrases)]), words: spaced([...new Set(words)]), pair: [] };
};
const cardIn = (text: string, c: Card): boolean =>
  has(text, c.phrases) || has(text, c.words) || (c.pair.length === 2 && c.pair.every((f) => text.includes(f)));

/** A race weekend's sessions, as a game or a channel's name says them. */
const SESSION_WORDS: Array<[string, RegExp]> = [
  ['qualifying', /\b(qualifying|quali|qual)\b/],
  ['sprint', /\bsprint\b/],
  ['practice', /\b(practice|fp ?\d)\b/],
  ['race', /\brace\b/],
];
const sessionsIn = (text: string): string[] => SESSION_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
/** A name or listing for another session of the weekend (qualifying, for
 *  the race). A name that says no session is any of them. */
const otherSession = (text: string, g: Game): boolean => {
  if (!g.session) return false;
  const want = sessionsIn(normalizeSpeech(g.session));
  const said = sessionsIn(text);
  return want.length > 0 && said.length > 0 && !said.some((k) => want.includes(k));
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = `(${Object.keys(MONTHS).join('|')})`;

/** The dates written in a channel name, as month × 100 + day. Numbers alone
 *  are read both ways round: providers write 09/24, 24/09 and 9.24. Never
 *  "24/7", a time ("7.05pm"), or two single digits ("1/2", "5.1"): too
 *  likely something else. */
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
  const dots = /(^|[^\d.])(\d{1,2})\.(\d{1,2})(?![\d.]|\s*[ap]\.?m\b)/g;
  while ((x = dots.exec(s))) {
    if (x[2].length === 1 && x[3].length === 1) continue;
    put(Number(x[2]), Number(x[3]));
    put(Number(x[3]), Number(x[2]));
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
 *  (or an event's name, place or headliners, on a channel of its sport or a
 *  PPV / event one), 90 by the teams' cities alone on a channel of the
 *  league; 12 less when it gives another kickoff time (the other game of a
 *  doubleheader). 0 when it doesn't have the game; -1 when it has it on
 *  another day (a name not yet changed from yesterday's game) or another
 *  session (yesterday's qualifying): then the channel is nothing to it. */
const eventScore = (c: SportsChannel, g: Game, w: GameWords, inLeague: boolean): number => {
  let score = 0;
  if (w.card) {
    const ofSport = inLeague || (!c.leagues.length && EVENTS.test(`${c.cat} ${c.full}`));
    if (ofSport && cardIn(c.full, w.card)) {
      if (otherSession(c.full, g)) return -1;
      score = 100;
    }
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

const SOCCER = new Set(SOCCER_LEAGUES);
/** A channel of another league: never this game's ("Kings", "Rangers",
 *  "Giants" and "Cardinals" play in two leagues each). A "Football" channel
 *  that names no league is soccer as often as not. */
const otherLeague = (c: SportsChannel, league: string): boolean => {
  if (!c.leagues.length || c.leagues.includes(league)) return false;
  if (SOCCER.has(league)) {
    const text = `${c.cat} ${c.full}`;
    if (/\bfootball\b/.test(text) && !namedLeagues(text).some((l) => !SOCCER.has(l))) return false;
  }
  return true;
};

/** Words a channel's name carries besides what is on it. */
const CHANNEL_WORDS = new Set(['sky', 'sports', 'sport', 'tv', 'channel', 'network', 'hd', 'fhd', 'uhd', 'plus', 'live', 'us', 'uk', 'usa', 'ca', 'extra', 'pass', 'zone', 'hub', 'main', 'feed', 'official', 'en', 'es', 'espanol']);
/** A channel named for a league and nothing else. */
const leagueOnly = (name: string, league: string): boolean => {
  const re = LEAGUE_WORDS[league];
  if (!re || !re.test(name)) return false;
  return name.replace(new RegExp(re.source, 'g'), ' ').split(' ')
    .every((w) => !w || CHANNEL_WORDS.has(w) || EVENT_GENERIC.has(w));
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
    // PPV carries fights, festivals and small races, never a league's games
    // or the scoreboards' races and tournaments: only a fight card is ever on
    // one. A league's own PPV category ("NHL PPV") is that league's.
    if (!inLeague && game.league !== 'ufc' && PPV.test(`${c.cat} ${c.full}`)) continue;
    const other = !inLeague && otherLeague(c, game.league);
    if (!other) {
      const s = eventScore(c, game, w, inLeague);
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
    // A league's own channels; for an event, also a channel named for the
    // league and nothing else ("Sky Sports F1", "UFC Fight Pass"), not one
    // named for another event ("NASCAR Cup: Talladega").
    const leagueOwn = LEAGUE_CHANNEL.test(c.name) || (!!w.card && leagueOnly(c.name, game.league));
    if (!score && leagueLinks < 4 && inLeague && leagueOwn && !isNumberedEvent(c, game.league)) {
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
 *  PPV and event ones too), for "Browse in Live TV". For a PPV event, the
 *  categories of its own channels (`only`: their link keys). */
export function leagueCategories(game: Game, channels: SportsChannel[], limit = 3, only?: Set<string>): Array<{ line: XtreamCreds; categoryId: string; name: string }> {
  const out: Array<{ line: XtreamCreds; categoryId: string; name: string }> = [];
  const seen = new Set<string>();
  for (const c of channels) {
    if (only ? !only.has(linkKey(c)) : !leaguesIn(c.cat).includes(game.league) && !(game.league === 'ufc' && EVENTS.test(c.cat))) continue;
    const id = String(c.stream.category_id ?? '');
    const k = `${c.line.host}|${c.line.username}|${id}`;
    if (!id || seen.has(k)) continue;
    seen.add(k);
    out.push({ line: c.line, categoryId: id, name: c.cat.toUpperCase() });
    if (out.length >= limit) break;
  }
  return out;
}

// ── PPV, from the channels' own names ──────────────────────────────────────

const HOUR = 60 * 60_000;
/** A PPV event is listed until this long after its start. */
const PPV_LASTS_MS = 5 * HOUR;

const wallFormats = new Map<string, Intl.DateTimeFormat | null>();
/** A zone's calendar and clock at an instant (null: zone unknown here). */
const wallParts = (at: number, zone: string): { y: number; mo: number; d: number; mins: number } | null => {
  let f = wallFormats.get(zone);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false });
    } catch { f = null; }
    wallFormats.set(zone, f);
  }
  if (!f) return null;
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(at))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, mins: ((p.hour ?? 0) % 24) * 60 + (p.minute ?? 0) };
};
/** The instant a zone's clock shows a date and time. */
const zonedAt = (y: number, mo: number, d: number, mins: number, zone: string): number | null => {
  const want = Date.UTC(y, mo - 1, d, Math.floor(mins / 60), mins % 60);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const w = wallParts(t, zone);
    if (!w) return null;
    const diff = Date.UTC(w.y, w.mo - 1, w.d, Math.floor(w.mins / 60), w.mins % 60) - want;
    if (!diff) return t;
    t -= diff;
  }
  return t;
};

/** "PPV EVENT 01: ", "PAY-PER-VIEW 3 - ", "UFC EVENT 05 | " before the title. */
const PPV_LABEL = /^(?:(?:ppv|pay[- ]?per[- ]?view|special|events?|ufc|boxing|live|main|fight|card|channel|ch)\s*)+#?\s*\d{1,3}\s*[:|\u2013\u2014-]\s*/i;
const NO_EVENT = /^(no events?|no games?|off ?air|offline|tba|tbd|coming soon|events?|ppv|n\/?a|none|closed|to be announced)$/i;
/** A name that is only its label ("PPV EVENT 15"): nothing on. */
const LABEL_ONLY = /^(?:(?:ppv|pay[- ]?per[- ]?view|special|events?|ufc|boxing|live|main|fight|card|channel|ch)\s*)+#?\s*\d{0,3}$/i;
const TIME_TAIL = `\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\s*(?:${Object.keys(ZONES).join('|')})?`;

/** The event in a PPV channel's name, and when it starts: "PPV EVENT 02: STSS
 *  Fonda 200 at Fonda (9.18 6:00 PM ET)" → "STSS Fonda 200 at Fonda", Sep 18
 *  at 6 PM Eastern. A time with no zone is Eastern, a time with no date
 *  today's. null for a channel with nothing on ("PPV 05", "No Event"); start
 *  null when the name gives no time. */
export function ppvEvent(raw: string, now = Date.now()): { title: string; start: number | null } | null {
  let s = String(raw ?? '').trim().replace(/^[a-z]{2,3}\s*[|:]\s*/i, '');
  s = s.replace(PPV_LABEL, '');
  // The schedule at the end: "(9.18 6:00 PM ET)" (or cut short: "(9.18"),
  // "- 9/18 6:00 PM ET", "@ 7:00 PM".
  s = s.replace(/\s*[([][^)\]]*\d[^)\]]*[)\]]?\s*$/, '');
  s = s.replace(new RegExp(`\\s*(?:[-|@\\u2013\\u2014]\\s*)?\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?(?:\\s+${TIME_TAIL})?\\s*$`, 'i'), '');
  s = s.replace(new RegExp(`\\s*(?:[-|@\\u2013\\u2014]\\s*)?${TIME_TAIL}\\s*$`, 'i'), '');
  const title = s.replace(/\s+/g, ' ').replace(/[\s:|\u2013\u2014-]+$/, '').trim();
  if (title.length < 3 || NO_EVENT.test(title) || LABEL_ONLY.test(title)) return null;

  const time = nameTimes(raw)[0];
  if (!time) return { title, start: null };
  const zone = time.zone ?? 'America/New_York';
  const today = wallParts(now, zone);
  if (!today) return { title, start: null };
  const days = nameDates(raw);
  const cands: number[] = [];
  const dates: Array<[number, number, number]> = days.length
    ? days.flatMap((md) => [today.y - 1, today.y, today.y + 1].map((y): [number, number, number] => [y, Math.floor(md / 100), md % 100]))
    : [[today.y, today.mo, today.d]];
  for (const [y, mo, d] of dates) for (const m of time.mins) {
    const t = zonedAt(y, mo, d, m, zone);
    if (t != null) cands.push(t);
  }
  if (!cands.length) return { title, start: null };
  // The reading nearest now: "7:00" is the evening's when that is closer.
  cands.sort((a, b) => Math.abs(a - now) - Math.abs(b - now));
  return { title, start: cands[0] };
}

/** A PPV fight ("Covington vs. Muhammad"): listed with the day's games. */
export const isPpvFight = (g: Game): boolean => g.league === 'ppv' && /\bvs?\.?\s/i.test(g.name);

/** Today's PPV events on this box, from its PPV channels' names: the fights,
 *  festivals and small races no scoreboard lists. One entry per event (the
 *  same event on two lines is one, with both channels); from its start until
 *  five hours after, or up to 30 hours ahead. `taken`: channels a listed game
 *  already has (a UFC card's). */
export function ppvGames(channels: SportsChannel[], taken: Set<string> = new Set(), now = Date.now()): Array<{ game: Game; links: GameChannel[] }> {
  const byEvent = new Map<string, { game: Game; links: GameChannel[] }>();
  for (const c of channels) {
    if (!PPV.test(`${c.cat} ${c.full}`) || taken.has(linkKey(c))) continue;
    const ev = ppvEvent(String(c.stream?.name ?? ''), now);
    if (!ev || ev.start == null) continue;
    if (now - ev.start > PPV_LASTS_MS || ev.start - now > 30 * HOUR) continue;
    const link: GameChannel = { line: c.line, stream: c.stream, score: 100, via: 'game' };
    const k = `${normalizeSpeech(ev.title)}|${ev.start}`;
    const hit = byEvent.get(k);
    if (hit) { hit.links.push(link); continue; }
    byEvent.set(k, {
      game: {
        id: `ppv:${linkKey(c)}`, league: 'ppv', leagueLabel: 'PPV', name: ev.title, event: ev.title,
        start: new Date(ev.start).toISOString(), state: ev.start <= now ? 'in' : 'pre', detail: '',
        home: null, away: null, networks: [],
      },
      links: [link],
    });
  }
  return [...byEvent.values()].sort((a, b) => Date.parse(a.game.start) - Date.parse(b.game.start));
}

/** The channels a scoreboard's fight cards have by name (so the PPV list
 *  does not show them a second time). */
export function cardChannels(games: Game[], channels: SportsChannel[]): Set<string> {
  const out = new Set<string>();
  for (const g of games) {
    if (g.league !== 'ufc') continue;
    for (const l of channelsForGame(g, channels)) if (l.via === 'game') out.add(linkKey(l));
  }
  return out;
}

export const channelKey = linkKey;

// ── the guide ──────────────────────────────────────────────────────────────

/** Guide lookups for one game's list, four at a time: the networks and
 *  locals found, the league's numbered channels, the league's and teams' own
 *  channels found, and the teams' cities' channels. */
const GUIDE_MAX = { found: 10, numbered: 8, league: 4, city: 6 };
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
  if (!g.home && !g.away) return cardIn(text, cardWords(g)) && !otherSession(text, g);
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
 *  game (first) or with another of today's games (last); the league's
 *  numbered channels ("MLB 07"), and the league's and teams' own channels,
 *  the guide shows with it (names are read too, by channelsForGame: a game
 *  may be in either); and the teams' cities' channels the guide shows with
 *  it. Looked at around kickoff (now, for a game under way); kept ten
 *  minutes. `onPartial` hears the links so far after each few lookups, so
 *  the list fills in as the answers come. */
export async function checkGuides(
  game: Game, channels: SportsChannel[], found: GameChannel[], games: Game[] = [], now = Date.now(),
  onPartial?: (links: GameChannel[]) => void,
): Promise<GameChannel[]> {
  const hit = guideCache.get(game.id);
  if (hit && hit.from === channels && now - hit.at < CHANNELS_TTL_MS) return hit.links;
  const start = Date.parse(game.start);
  const live = game.state === 'in';
  if (!live && !(start - now < GUIDE_AHEAD_MS)) return [];
  const at = live || !Number.isFinite(start) ? now : Math.max(now, start + 10 * 60_000);

  // A channel named for the game says so already.
  const seen = new Set<string>(found.filter((f) => f.via === 'game').map(linkKey));
  const cands: Array<{ line: XtreamCreds; stream: XtreamLiveStream; via: LinkKind; was?: GameChannel }> = [];
  const add = (c: { line: XtreamCreds; stream: XtreamLiveStream }, via: LinkKind, was?: GameChannel): boolean => {
    const k = linkKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    cands.push({ line: c.line, stream: c.stream, via, was });
    return true;
  };
  let n = 0;
  for (const f of found) {
    if (n >= GUIDE_MAX.found) break;
    if ((f.via === 'network' || f.via === 'local') && add(f, f.via, f)) n += 1;
  }
  n = 0;
  for (const c of channels) {
    if (n >= GUIDE_MAX.numbered) break;
    if (isNumberedEvent(c, game.league) && add(c, 'game')) n += 1;
  }
  n = 0;
  for (const f of found) {
    if (n >= GUIDE_MAX.league) break;
    if ((f.via === 'league' || f.via === 'team') && add(f, f.via, f)) n += 1;
  }
  if (game.home || game.away) {
    const w = gameWords(game);
    const city = [...w.home.place, ...w.away.place, ...w.home.shortPlace, ...w.away.shortPlace, ...w.home.own, ...w.away.own];
    n = 0;
    for (const c of channels) {
      if (n >= GUIDE_MAX.city) break;
      if (!c.leagues.length && has(` ${c.name} `, city) && add(c, 'local')) n += 1;
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
    if (onPartial && i + 4 < cands.length) onPartial(links.slice());
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
