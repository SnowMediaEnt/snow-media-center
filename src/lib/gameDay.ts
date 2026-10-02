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
// which of them has this game (and which shows something else), and finds
// the teams' cities' channels that have it (checkGuides). The guide has the
// last word (arrangeLinks): a channel it shows with something else is
// dropped, and a network only its name matched is listed apart, as not
// confirmed. In the playoffs (national TV only) the zone channels are
// dropped, and the teams', the locals' and the league's channels, and the
// league's numbered feeds ("MLB 05"), are listed only when their guide has
// the game.
// Every sport the game-day function lists works the same way: the team
// sports, fight cards, and events without teams (races, golf and tennis
// tournaments), found by their name or their circuit, course or venue.
// PPV channels carry fights, festivals and small races, never a league's
// games: they are only ever a fight card's. What is on them comes from their
// own names ("PPV EVENT 02: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)"), as
// Game Day's PPV list (ppvGames).
// Streaming services (Peacock, ESPN+, Prime Video …) are never a game's
// channel by name alone. A line may carry them as numbered feeds ("US|
// PEACOCK 02", "ESPN+ 07") whose names don't say what is on, but whose guide
// does: the feeds of the game's own services, and of its networks' streaming
// partners (NBC's Peacock, ESPN's ESPN+ …), are read as its list opens, and
// listed only when their guide has the game (gameServices, checkGuides).
//
// Conferences and services providers file games under (B1G+ / BIG10+, SEC+,
// ACCNX, PAC-12, NCAA, UEFA, Flo …) are "families" (FAMILIES): a category or
// name in one is a channel of its leagues (the college ones, UEFA's), so it
// is loaded on every box and its short codes count; their numbered feeds
// ("B1G+ 03") are read by their guide like a streaming service's. A
// conference network is every college sport's, not football's alone.
// An event channel's name is split once, as the list loads, into its two
// sides ("B1G+ | #11 Boston vs Michigan" → "boston" (ranked 11), "michigan"):
// a game is on it when one side is each team, by name, school, alias,
// mascot or code (a mascot or code only next to a name, or on a channel of
// the game's league or service), or by city — never a school inside another
// ("Michigan" in "Michigan State"), never a team ranked otherwise ("#5
// Boston" is not #11 BU). Names are read with their accents folded
// ("Atlético" is "Atletico").
// What a search of the line-up found (the game-day-match function's daily
// scan per provider) is listed apart, "Found by search", once the box sees
// the same channel still loaded under that name or one with the teams'
// words (aiLinks); the guide still has the last word on it (arrangeLinks).
//
// The owner's picks: the Snow Media admin app can, for one game, add a channel
// (first in its list, "Picked by Snow Media"), hide one, or mark one down
// (last, ⚠️). They are rows of the public game_day_channel_edits table, read
// with the games (fetchGameEdits) and laid over whatever the matching found,
// last of all (applyChannelEdits), so no matching rule can drop a pick. A read
// that fails leaves every list exactly as the matching made it.
import { supabase } from '@/integrations/supabase/client';
import {
  decodeEpgText, getLiveCategories, getLiveStreams, getShortEpg, parseEpgTime,
  type XtreamCategory, type XtreamCreds, type XtreamEpgEntry, type XtreamLiveStream,
} from '@/lib/xtream';
import { cleanChannelName, normalizeSpeech } from '@/lib/voiceCommands';
import i18n from '@/i18n';
import { formatTime } from '@/i18n/format';

export interface GameTeam {
  name: string; short: string; abbr: string; location: string; logo: string | null; score: string | null;
  /** The poll rank (1–25) of a college team, when it has one. */
  rank?: number;
}
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
  /** A playoff game (older lists from the function never say): national TV
   *  only, so the teams' and the league's own channels rarely have it.
   *  `round`: ESPN's name for it ("AL Wild Card - Game 1"). */
  postseason?: boolean; round?: string;
}

export type LinkKind = 'game' | 'network' | 'local' | 'team' | 'league' | 'zone';
// English names; the screen shows the translated ones by kind (gameDay.link.<kind>).
export const LINK_LABELS: Record<LinkKind, string> = {
  game: 'Game channel', network: 'National TV', local: 'Local & regional', team: 'Team channel', league: 'League channel',
  // A whip-around channel ("NFL RedZone", "MLB Zone"): every game of the
  // league at once, never just this one. Never a team link.
  zone: 'Zone channel',
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
  /** The streaming service it is a numbered feed of ("US| PEACOCK 02" →
   *  'peacock'), worked out once, as the channel is read. */
  service?: string;
  /** An event channel's two sides, worked out once as the channel is read
   *  ("#11 Boston vs Michigan" → " boston ", " michigan "): plain words with
   *  a space at each end, the labels, ranks, times and dates gone. */
  sides?: [string, string];
  /** The ranks the sides gave ("#11 Boston" → 11; 0 for none). */
  ranks?: [number, number];
  /** The conference and service families its category or label names
   *  ('b1g', 'sec', 'uefa' …): FAMILIES. */
  fam?: string[];
}

/** Categories a provider was seen to carry a league's games in (from the
 *  game-day-match function), by category name (normalised here) → leagues. */
export type LearnedCats = ReadonlyMap<string, string[]>;

/** What a search of the line-up found for a game: a stream, under the name
 *  it had then. */
export interface AiMatch { stream_id: number; name: string; confidence: 'high' | 'medium'; source: 'ai' | 'crowd' }

/** A channel sent to the line-up search: its id, name and category, nothing else. */
export interface ScanCandidate { id: number; name: string; cat: string }

/** What a game's guide check says about a link (checkGuides): 'yes' a
 *  listing around kickoff has the game; 'other' the listings there show
 *  something else; 'none' it can't tell (no listing, a failed lookup, or a
 *  listing of the league that names no teams: "MLB Baseball"). */
export type GuideVerdict = 'yes' | 'other' | 'none';

/** A link for one game. `picked`: the owner added it for this game;
 *  `ownerDown`: the owner marked it down for this game (applyChannelEdits);
 *  `guide`: what its guide said, when it was read. */
export interface GameChannel {
  line: XtreamCreds; stream: XtreamLiveStream; score: number; via: LinkKind; note?: string; picked?: boolean; ownerDown?: boolean;
  guide?: GuideVerdict;
  /** Found by the line-up search (aiLinks), with its confidence. */
  search?: 'high' | 'medium';
}

/** English for the label on a link the search found (the screen translates it). */
export const SEARCH_LABEL = 'Found by search';

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
// A bare "friendly" is also "family friendly": only the soccer word for it counts.
const FRIENDLY = /\b((?:international|intl|fifa|soccer|football|national team)s? friendl(?:y|ies)|friendl(?:y|ies) (?:match|game)s?)\b/;
const NATIONS_LEAGUE = /\b(nations league)\b/;
const LEAGUE_WORDS: Record<string, RegExp> = {
  nfl: /\b(nfl|red ?zone|sunday ticket)\b/,
  // The conference networks are every college sport's: FAMILIES.
  ncaaf: /\b(ncaaf|ncaa football|college football|cfb)\b/,
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
  // National teams and the rest of the soccer calendar. Words shared by
  // several competitions name all of them ("Friendly" is the men's and the
  // women's; "Nations League" the UEFA and the CONCACAF one).
  friendly: FRIENDLY,
  friendlyw: FRIENDLY,
  wcq: /\b(wcq|world cup qualif\w*|wc qualif\w*)\b/,
  unl: NATIONS_LEAGUE,
  cnl: NATIONS_LEAGUE,
  euroq: /\b(euro qualif\w*|euros? 20\d\d qualif\w*)\b/,
  euro: /\b(uefa euro|euro 20\d\d|european championship)\b/,
  weuro: /\b(womens euro|weuro)\b/,
  wc: /\b(fifa world cup|world cup)\b/,
  wwc: /\b(womens world cup|wwc)\b/,
  copa: /\b(copa america)\b/,
  gold: /\b(gold cup)\b/,
  uecl: /\b(uecl|conference league)\b/,
  facup: /\b(fa cup)\b/,
  efl: /\b(carabao|efl cup|league cup)\b/,
  champ: /\b(efl championship|english championship)\b/,
  wsl: /\b(wsl|womens super league)\b/,
  delrey: /\b(copa del rey)\b/,
  coppa: /\b(coppa italia)\b/,
  dfb: /\b(dfb ?pokal)\b/,
  ned: /\b(eredivisie)\b/,
  por: /\b(primeira liga|liga portugal)\b/,
  sco: /\b(scottish premiership|scottish premier league|spfl)\b/,
  bra: /\b(brasileirao|brasileiro)\b/,
  leaguescup: /\b(leagues cup)\b/,
  cccl: /\b(concacaf champions)\b/,
  cwc: /\b(club world cup|cwc)\b/,
  liberta: /\b(libertadores)\b/,
  sudamer: /\b(sudamericana)\b/,
  wncaab: /\b(wncaab|womens college basketball|ncaa womens basketball)\b/,
  ncaah: /\b(ncaah|college hockey|ncaa hockey)\b/,
  ufc: /\b(ufc|fight night)\b/,
  f1: /\b(f1|formula ?1|formula one)\b/,
  nascar: /\b(nascar)\b/,
  indycar: /\b(indy ?car|indy 500)\b/,
  pga: /\b(pga)\b/,
  lpga: /\b(lpga)\b/,
  atp: /\b(atp)\b/,
  wta: /\b(wta)\b/,
};
/** National-team competitions: the teams are countries ("USA", "CZE"). */
const INTERNATIONAL_LEAGUES = ['friendly', 'friendlyw', 'wcq', 'unl', 'cnl', 'euroq', 'euro', 'weuro', 'wc', 'wwc', 'copa', 'gold'];
/** Club competitions besides the big leagues' chips. */
const MORE_SOCCER_LEAGUES = [
  'uecl', 'facup', 'efl', 'champ', 'wsl', 'delrey', 'coppa', 'dfb', 'ned', 'por', 'sco', 'bra', 'leaguescup', 'cccl', 'cwc', 'liberta', 'sudamer',
];
const SOCCER_LEAGUES = [
  'mls', 'nwsl', 'ligamx', 'epl', 'laliga', 'seriea', 'bundesliga', 'ligue1', 'ucl', 'uel', ...INTERNATIONAL_LEAGUES, ...MORE_SOCCER_LEAGUES,
];

/** The chip a league is filed under in Game Day. The big leagues have their
 *  own; national teams share "International" and the other soccer
 *  competitions "More Soccer", so the chip row stays short. `labelKey` is the
 *  translated name of a shared chip; a league of its own has its `label`. */
export function chipOf(g: { league: string; leagueLabel: string }): { id: string; label: string; labelKey?: string } {
  if (INTERNATIONAL_LEAGUES.includes(g.league)) return { id: 'chip:intl', label: 'International', labelKey: 'gameDay.chipIntl' };
  if (MORE_SOCCER_LEAGUES.includes(g.league)) return { id: 'chip:soccer', label: 'More Soccer', labelKey: 'gameDay.chipSoccer' };
  return { id: g.league, label: g.leagueLabel };
}
/** A sport's word stands for its leagues ("Baseball" → MLB). */
const SPORT_LEAGUES: Array<[RegExp, string[]]> = [
  [/\bbaseball\b/, ['mlb']],
  [/\bhockey\b/, ['nhl', 'ncaah']],
  [/\bbasketball\b/, ['nba', 'wnba', 'ncaab', 'wncaab']],
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

const COLLEGE_LEAGUES = ['ncaaf', 'ncaab', 'wncaab', 'ncaah'];
const UEFA_LEAGUES = ['ucl', 'uel', 'uecl', 'unl', 'euroq', 'euro', 'wcq'];
/** Conferences and services providers file games under, on normalised words:
 *  a category or label in one is a channel of its leagues. A sport's own
 *  name stays that sport's ("College Football" is football only). */
const FAMILIES: Array<{ id: string; re: RegExp; leagues: string[] }> = [
  { id: 'b1g', re: /\b(?:b1g|big ?10|big ten|btn)(?: ?\+| plus| network)?(?![a-z0-9])/, leagues: COLLEGE_LEAGUES },
  { id: 'sec', re: /\b(?:sec(?: ?\+| plus| network(?: ?\+| plus)?)|secn)(?![a-z0-9])/, leagues: COLLEGE_LEAGUES },
  { id: 'acc', re: /\b(?:acc ?nx|acc network(?: ?\+| extra)?|acc extra|accn)(?![a-z0-9])/, leagues: COLLEGE_LEAGUES },
  { id: 'pac12', re: /\bpac ?12(?![0-9])/, leagues: COLLEGE_LEAGUES },
  { id: 'bigeast', re: /\bbig east\b/, leagues: COLLEGE_LEAGUES },
  { id: 'big12', re: /\bbig ?12(?![0-9])/, leagues: COLLEGE_LEAGUES },
  {
    id: 'ncaa',
    re: /\b(?:ncaa|college|collegiate)\b(?!(?: [a-z]+)? (?:football|basketball|hockey|baseball|softball|volleyball|soccer|lacrosse|wrestling|hoops)\b)/,
    leagues: COLLEGE_LEAGUES,
  },
  { id: 'uefa', re: /\buefa\b/, leagues: UEFA_LEAGUES },
  { id: 'flo', re: /\bflo ?(?:sports?|hockey|college|football|hoops|basketball)\b|\bflo(?= \d)/, leagues: ['ncaah', 'ncaab', 'ncaaf'] },
];
/** The families some normalised words name. */
const familiesIn = (text: string): typeof FAMILIES => FAMILIES.filter((f) => f.re.test(text));

/** Leagues some words name: outright, by a sport's word, or by a family. */
const baseLeagues = (text: string): Set<string> => {
  const out = new Set(namedLeagues(text));
  for (const [re, ids] of SPORT_LEAGUES) if (re.test(text)) for (const id of ids) out.add(id);
  return out;
};

export function leaguesIn(text: string): string[] {
  const out = baseLeagues(text);
  for (const f of familiesIn(text)) for (const id of f.leagues) out.add(id);
  return [...out];
}

const SPORT = /\b(sports?|espn|ppv|pay per view|events?|live events?|game ?day|match ?day|game ?pass|zone|dazn|fubo|bein|tsn|sky sports|golf|tennis|racing|f1|nascar|wrestling|wwe|aew)\b/;
const NETWORK = /\b(networks?|locals?|regionals?|rsn|abc|cbs|nbc|fox|tnt|tbs|usa|us|united states|america|american|entertainment)\b/;
const NOT_SPORTS = /\b(kids?|children|cartoons?|music|radio|religious|faith|adult|xxx|movies?|cinema|vod|series)\b/;
/** PPV and event categories: fight cards and events. */
const EVENTS = /\b(ppv|pay per view|events?)\b/;
/** Pay-per-view: fights, festivals and small races, never a league's games. */
const PPV = /\b(ppv|pay ?per ?view)\b/;

/** Streaming services, by id: `head`, how its name starts (normalised
 *  words); `bare`, a name that is the service only right before a number
 *  ("Prime 03", "Max 04"; never "Prime Ticket", "Cinemax" or "ActionMAX"). */
const SERVICES: Array<{ id: string; head: string; bare?: string }> = [
  { id: 'peacock', head: 'peacock(?: tv)?' },
  { id: 'espnplus', head: 'espn ?\\+|espn plus' },
  { id: 'prime', head: 'prime video|amazon prime(?: video)?|amazon', bare: 'prime' },
  { id: 'apple', head: 'apple tv ?\\+|apple tv|apple' },
  { id: 'netflix', head: 'netflix' },
  { id: 'max', head: 'hbo max', bare: 'max' },
  { id: 'paramount', head: 'paramount ?\\+|paramount plus' },
  { id: 'dazn', head: 'dazn' },
  { id: 'fubo', head: 'fubo ?tv|fubo' },
  { id: 'foxone', head: 'fox ?one' },
  { id: 'youtube', head: 'youtube(?: tv)?' },
  { id: 'nflplus', head: 'nfl ?\\+|nfl plus' },
  // The leagues' own passes.
  { id: 'mlbtv', head: 'mlb ?tv|mlb extra innings|extra innings' },
  { id: 'nbaleaguepass', head: 'nba league pass' },
  { id: 'nhlcenterice', head: 'nhl center ice|center ice' },
  { id: 'mlsseasonpass', head: 'mls season pass|season pass' },
  { id: 'sundayticket', head: 'nfl sunday ticket|sunday ticket' },
  // The conferences' and services' own feeds ("B1G+ 03", "SEC+ 12", "FLO 02").
  { id: 'b1gplus', head: 'b1g ?\\+|b1g plus|big ?10 ?\\+|big ten ?\\+|big ten plus|btn ?\\+|btn plus' },
  { id: 'secplus', head: 'sec ?\\+|sec plus|sec network ?\\+|sec network plus' },
  { id: 'accnx', head: 'acc ?nx|acc network extra|acc extra' },
  { id: 'flo', head: 'flo ?sports|flo ?hockey|flo ?college|flo ?football|flo ?hoops', bare: 'flo' },
  { id: 'ncaa', head: 'ncaa' },
  { id: 'uefa', head: 'uefa(?: tv)?' },
];
const COUNTRY = '(?:(?:us|usa|uk|ca) )?';
/** A word some feeds carry before their number: "PEACOCK EVENT 02". */
const FEED_WORD = '(?: (?:events?|sports?|live|ppv|ch|channel|feed|premium))?';
/** A numbered feed of each service, on a cleaned channel name ("peacock 02",
 *  "espn+ event 07"); ESPN's own name only with a leading-zero number or an
 *  event word ("ESPN 01", "ESPN EVENT 05": ESPN+ feeds, where "ESPN 2" is
 *  ESPN2). */
const SERVICE_FEEDS: Array<[string, RegExp]> = [
  ...SERVICES.map((s): [string, RegExp] => [s.id, new RegExp(`^${COUNTRY}(?:(?:${s.head})${FEED_WORD}${s.bare ? `|${s.bare}` : ''}) \\d{1,3}(?: |$)`)]),
  ['espnplus', new RegExp(`^${COUNTRY}espn (?:0\\d{1,2}|(?:events?|ppv) \\d{1,3})(?: |$)`)],
];
/** Each service as a game's networks name it ("Peacock", "ESPN+ PPV", "MLB.tv"). */
const SERVICE_NAMES: Array<[string, RegExp]> = SERVICES.map((s): [string, RegExp] =>
  [s.id, new RegExp(`^(?:${s.head})(?: |$)${s.bare ? `|^(?:${s.bare})$` : ''}`)]);
/** A service named anywhere in some words: a category of its feeds ("US|
 *  PEACOCK"), or a channel worth a closer look. */
const SERVICE_WORD = new RegExp(`(?:^| )(?:${SERVICES.flatMap((s) => (s.bare ? [s.head, s.bare] : [s.head])).join('|')})(?= |$)`);
/** A "24/7" channel loops one show: never a live feed. */
const LOOP = /\b24\s*[/x-]\s*7\b/i;

/** The streaming service a channel is a numbered feed of (none: undefined).
 *  `name` is the cleaned name, `raw` the name as the line gives it. */
const feedService = (raw: string, name: string): string | undefined => {
  if (!/\d/.test(name) || LOOP.test(raw)) return undefined;
  for (const [id, re] of SERVICE_FEEDS) if (re.test(name)) return id;
  return undefined;
};

/** Letters with their accents taken off ("Atlético München" → "Atletico
 *  Munchen"), and the few that have no accent to take off. */
const FOLD_MORE: Record<string, string> = { ø: 'o', Ø: 'O', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ß: 'ss', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ı: 'i' };
const fold = (s: string): string => {
  const t = String(s ?? '');
  // Plain ASCII (most names): nothing to do.
  if (!/[^\x20-\x7e]/.test(t)) return t;
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[øØæÆœŒßłŁđĐı]/g, (c) => FOLD_MORE[c] ?? c);
};
/** Plain words, accents folded: "Atlético Madrid" → "atletico madrid". */
const plain = (s: string): string => normalizeSpeech(fold(s));

const normalise = (s: string): string => normalizeSpeech(fold(s).replace(/[|:_/-]+/g, ' '));

/** How much a category matters to Game Day: 3 for a league's ("MLB ZONE"),
 *  2 for sports, events and streaming services ("US| SPORTS", "PPV", "US|
 *  PEACOCK"), 1 for networks, locals and general US categories (where ESPN
 *  and FOX often live), 0 for the rest ("NETFLIX MOVIES" too). */
export const categoryWeight = (name: string): number => {
  const n = normalise(name);
  if (NOT_SPORTS.test(n)) return 0;
  if (leaguesIn(n).length) return 3;
  return SPORT.test(n) || (SERVICE_WORD.test(n) && !LOOP.test(name)) ? 2 : NETWORK.test(n) ? 1 : 0;
};

const lowMemory = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

/** Learned categories by their normalised name (however they came). */
const learnedMap = (learned?: LearnedCats | null): Map<string, string[]> | null => {
  if (!learned || !learned.size) return null;
  const out = new Map<string, string[]>();
  try {
    for (const [cat, leagues] of learned) {
      const k = normalise(cat);
      if (k && Array.isArray(leagues)) out.set(k, [...(out.get(k) ?? []), ...leagues.map(String)]);
    }
  } catch { return null; }
  return out.size ? out : null;
};

/** One channel as Game Day reads it (null for a nameless one). Its sides
 *  and families are worked out here, once per channel list: never per game
 *  or per key press. `learned`: categories learned as a league's. */
export function sportsChannel(line: XtreamCreds, stream: XtreamLiveStream, catName = '', learned?: LearnedCats | null): SportsChannel | null {
  return readChannel(line, stream, catName, learnedMap(learned));
}

const readChannel = (line: XtreamCreds, stream: XtreamLiveStream, catName: string, learned: Map<string, string[]> | null): SportsChannel | null => {
  const raw = String(stream?.name ?? '');
  const name = cleanChannelName(fold(raw));
  if (!name) return null;
  const cat = normalise(catName);
  const words = normalise(raw);
  const m = matchup(raw);
  const leagues = baseLeagues(`${cat} ${words}`);
  // A family by its category or the name's label, never by a team ("Boston
  // College vs Maine" is not the NCAA's channel; "NCAA 03: …" is).
  const fams = familiesIn(m ? `${cat} ${m.label}` : `${cat} ${words}`);
  for (const f of fams) for (const id of f.leagues) leagues.add(id);
  for (const id of learned?.get(cat) ?? []) leagues.add(id);
  const c: SportsChannel = { line, stream, name, full: ` ${words} `, cat, leagues: [...leagues], service: feedService(raw, name) };
  if (m) {
    c.sides = m.sides;
    if (m.ranks) c.ranks = m.ranks;
  }
  if (fams.length) c.fam = fams.map((f) => f.id);
  return c;
};

let channelsCache: { key: string; at: number; list: SportsChannel[] } | null = null;

/** This box's channels Game Day can use, across its lines, at most ten
 *  minutes old (a kept list older than that is asked for again).
 *  `learned`: categories the provider was seen to carry a league's games in,
 *  read (on a box short of memory too) as that league's. */
export async function loadSportsChannels(lines: XtreamCreds[], learned?: LearnedCats | null): Promise<SportsChannel[]> {
  const known = learnedMap(learned);
  const key = `${lines.map((l) => `${l.host}|${l.username}`).join(',')}#${known ? [...known.keys()].sort().join(',') : ''}`;
  if (channelsCache && channelsCache.key === key && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.list;
  const fresh = { maxAgeMs: CHANNELS_TTL_MS };
  const out: SportsChannel[] = [];
  let failed = false;
  const add = (line: XtreamCreds, stream: XtreamLiveStream, catName: string) => {
    const c = readChannel(line, stream, catName, known);
    if (c) out.push(c);
  };
  const weightOf = (name: string): number => (known?.has(normalise(name)) ? 3 : categoryWeight(name));
  for (const line of lines) {
    let cats: XtreamCategory[] = [];
    // A line that will not answer leaves the others' channels as they are.
    try { cats = await getLiveCategories(line); } catch { failed = true; continue; }
    const catName = new Map(cats.map((c) => [String(c.category_id), String(c.category_name ?? '')]));
    const weight = new Map(cats.map((c) => [String(c.category_id), weightOf(c.category_name)]));
    if (!lowMemory()) {
      // The whole line-up: the list Live TV search keeps (one request, shared).
      let all: XtreamLiveStream[] = [];
      try { all = await getLiveStreams(line, undefined, fresh); } catch { all = []; }
      if (all.length) {
        // Kids, music, film … categories: never an event channel's.
        const notSports = new Set(cats.filter((c) => NOT_SPORTS.test(normalise(String(c.category_name ?? '')))).map((c) => String(c.category_id)));
        for (const s of all) {
          const id = String(s.category_id ?? '');
          const rawName = String(s.name ?? '');
          const n = normalise(rawName);
          if ((weight.get(id) ?? 0) > 0 || SPORT.test(n) || leaguesIn(n).length) add(line, s, catName.get(id) ?? '');
          else if (!notSports.has(id) && QUICK_SIDES.test(fold(rawName).toLowerCase())) {
            // A matchup ("#11 Boston vs Michigan"), whatever its category
            // ("B1G+" is no sports word): kept when it splits in two.
            const c = readChannel(line, s, catName.get(id) ?? '', known);
            if (c?.sides || c?.service) out.push(c);
          } else if (/\d/.test(n) && SERVICE_WORD.test(n)) {
            // A streaming service's numbered feed ("PEACOCK 02"), whatever
            // its category ("STREAMING"): kept when it is one.
            const c = readChannel(line, s, catName.get(id) ?? '', known);
            if (c?.service) out.push(c);
          }
        }
        continue;
      }
    }
    // A box short of memory (or a line-up that would not load whole): the
    // best categories, the leagues' (and families', and learned ones) first,
    // three at a time so the panel sees a short burst.
    const picked = cats
      .map((c) => ({ c, w: weightOf(c.category_name) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_CATEGORIES_PER_LINE);
    for (let i = 0; i < picked.length; i += 3) {
      const lists = await Promise.all(picked.slice(i, i + 3).map(({ c }) =>
        getLiveStreams(line, String(c.category_id), fresh).then((l) => ({ c, l })).catch(() => ({ c, l: [] as XtreamLiveStream[] }))));
      for (const { c, l } of lists) for (const s of l) add(line, s, String(c.category_name ?? ''));
    }
  }
  // A list missing a line is not kept: the next read asks that line again.
  if (!failed) channelsCache = { key, at: Date.now(), list: out };
  return out;
}

// ── networks ───────────────────────────────────────────────────────────────

/** What ESPN calls a network → what providers call the channel. */
const NETWORK_ALIASES: Record<string, string[]> = {
  fs1: ['fox sports 1', 'fs1'], fs2: ['fox sports 2', 'fs2'], espn2: ['espn 2', 'espn2'], espnu: ['espnu', 'espn u'],
  espnews: ['espnews'], secn: ['sec network'], 'sec network': ['sec network'], accn: ['acc network'], 'acc network': ['acc network'],
  btn: ['big ten network', 'btn'], 'big ten network': ['big ten network', 'btn'],
  cbssn: ['cbs sports network', 'cbssn'], 'cbs sports network': ['cbs sports network', 'cbssn'],
  nbcsn: ['nbcsn', 'nbc sports network'],
  'nfl net': ['nfl network'], nfln: ['nfl network'], 'nfl network': ['nfl network'],
  'mlb net': ['mlb network'], mlbn: ['mlb network'], 'mlb network': ['mlb network'],
  'nhl net': ['nhl network'], nhln: ['nhl network'], 'nhl network': ['nhl network'],
  'nba tv': ['nba tv'], 'usa net': ['usa network'], usa: ['usa network'], 'usa network': ['usa network'],
  trutv: ['trutv', 'tru tv'], golf: ['golf channel'], tnt: ['tnt'], tbs: ['tbs'], abc: ['abc'],
  cbs: ['cbs'], nbc: ['nbc'], fox: ['fox'], espn: ['espn'], 'espn deportes': ['espn deportes'], univision: ['univision'],
  telemundo: ['telemundo'], 'fox deportes': ['fox deportes'], tudn: ['tudn'], unimas: ['unimas'],
  // Soccer's other homes.
  universo: ['universo', 'nbc universo'], 'nbc universo': ['nbc universo', 'universo'],
  'cbs golazo network': ['cbs golazo network', 'cbs sports golazo network', 'golazo network', 'cbs golazo', 'golazo'],
  'cbs sports golazo network': ['cbs sports golazo network', 'cbs golazo network', 'golazo network', 'cbs golazo', 'golazo'],
  golazo: ['golazo network', 'cbs golazo network', 'golazo'],
  'tnt sports': ['tnt sports', 'tnt'], 'bein sports': ['bein sports', 'bein'], 'fox soccer plus': ['fox soccer plus'],
  // Regional sports networks go by several names.
  'bally sports': ['bally sports', 'fanduel sports', 'fanduel sn'], 'fanduel sn': ['fanduel sports', 'fanduel sn', 'bally sports'],
  'fanduel sports': ['fanduel sports', 'fanduel sn', 'bally sports'],
  msg: ['msg'], 'msg sn': ['msg sportsnet', 'msg sn'], nesn: ['nesn'], yes: ['yes network', 'yes'], sny: ['sny'],
  'marquee sports network': ['marquee'], marquee: ['marquee'], 'spectrum sportsnet': ['spectrum sportsnet', 'spectrum sn'],
  'nbc sports': ['nbc sports'], 'root sports': ['root sports'], altitude: ['altitude'], 'monumental sports': ['monumental'],
  sportsnet: ['sportsnet'], tsn: ['tsn'],
};
/** Streaming services, never a channel by name: a line carries them, if at
 *  all, as numbered feeds (found by their guide: gameServices). */
const STREAMING_ONLY = /(espn\+|\bpeacock\b|prime video|\bprime\b|paramount\+|apple tv|\bmax\b|netflix|youtube|dazn app|nfl\+|mlb\.?tv|nba league pass|nhl\.?tv|nhl power play|mls season pass|espn app|fox one|\bvix\b|espn unlimited|\bstreaming\b|\b\w+\.tv\b)/i;

export const isStreamingOnly = (network: string): boolean => STREAMING_ONLY.test(network);

/** The streaming service a TV network's games are on too: NBC's on Peacock,
 *  ESPN's on ESPN+ … */
const PARTNERS: Record<string, string> = {
  nbc: 'peacock', nbcsn: 'peacock', 'nbc sports network': 'peacock', usa: 'peacock', 'usa net': 'peacock', 'usa network': 'peacock', telemundo: 'peacock',
  universo: 'peacock', 'nbc universo': 'peacock',
  'cbs golazo network': 'paramount', 'cbs sports golazo network': 'paramount', golazo: 'paramount',
  abc: 'espnplus', espn: 'espnplus', espn2: 'espnplus', 'espn 2': 'espnplus', espnu: 'espnplus', secn: 'espnplus', 'sec network': 'espnplus',
  accn: 'espnplus', 'acc network': 'espnplus',
  cbs: 'paramount', cbssn: 'paramount', 'cbs sports network': 'paramount',
  tnt: 'max', tbs: 'max', trutv: 'max', 'tru tv': 'max',
  fox: 'foxone', fs1: 'foxone', 'fox sports 1': 'foxone', fs2: 'foxone', 'fox sports 2': 'foxone', btn: 'foxone', 'big ten network': 'foxone',
};

/** The streaming service a game's network is ("Peacock", "ESPN+ PPV"), or
 *  undefined for a TV network. */
const networkService = (network: string): string | undefined => {
  const n = normalizeSpeech(String(network ?? ''));
  for (const [id, re] of SERVICE_NAMES) if (re.test(n)) return id;
  return undefined;
};

/** The feeds a league's games are on whatever its networks: a college
 *  game on the conferences' (B1G+, SEC+, ACCNX), Flo's, the NCAA's and
 *  ESPN+; a UEFA one on UEFA's and Paramount+. */
const LEAGUE_FEEDS: Record<string, string[]> = {};
for (const l of COLLEGE_LEAGUES) LEAGUE_FEEDS[l] = ['b1gplus', 'secplus', 'accnx', 'flo', 'ncaa', 'espnplus'];
for (const l of ['ucl', 'uel', 'uecl', 'unl', 'euroq', 'euro']) LEAGUE_FEEDS[l] = ['uefa', 'paramount'];

/** The streaming services whose numbered feeds may have a game, in the order
 *  to look: its own ("Peacock" in its networks), then its TV networks'
 *  partners (NBC → Peacock, ESPN → ESPN+), then its league's (LEAGUE_FEEDS). */
export function gameServices(game: Game): string[] {
  const out: string[] = [];
  const put = (s: string | undefined) => { if (s && !out.includes(s)) out.push(s); };
  const nets = Array.isArray(game?.networks) ? game.networks : [];
  for (const n of nets) put(networkService(n));
  for (const n of nets) put(PARTNERS[normalizeSpeech(String(n ?? ''))]);
  for (const s of LEAGUE_FEEDS[game?.league] ?? []) put(s);
  return out;
}

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

/** The word before a numbered feed's number: "ESPN EVENT 05", "FOX EVENT 2". */
const FEED_EVENT = /^(events?|ppv)$/;

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
  // A numbered feed is not the network: "ESPN 01", "ESPN EVENT 05".
  if (rest.length === 1 && /^0\d{1,2}$/.test(rest[0])) return 0;
  if (rest.length === 2 && FEED_EVENT.test(rest[0]) && /^\d{1,3}$/.test(rest[1])) return 0;
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
/** National teams as providers write them (by ESPN's name, normalised): more
 *  names for the team alone ("usmnt", the Spanish-language name) — and `duo`,
 *  names that count only next to the other team, never alone: "USA" is also
 *  "USA Network". A national team's ESPN code ("CZE") is a duo name too. */
const NATIONAL_TEAMS: Record<string, { own?: string[]; duo?: string[] }> = {
  'united states': { own: ['usmnt', 'uswnt', 'united states of america', 'estados unidos', 'ee uu', 'eeuu'], duo: ['usa', 'u s a', 'team usa'] },
  usa: { own: ['usmnt', 'uswnt', 'united states', 'estados unidos'] },
  czechia: { own: ['czech republic', 'czech', 'chequia', 'republica checa'] },
  'czech republic': { own: ['czechia', 'czech', 'chequia', 'republica checa'] },
  england: { own: ['inglaterra', 'three lions'] },
  'south korea': { own: ['korea republic', 'korea', 'corea del sur'] },
  'korea republic': { own: ['south korea', 'korea', 'corea del sur'] },
  'ivory coast': { own: ['cote d ivoire'] },
  'ir iran': { own: ['iran'] },
  turkiye: { own: ['turkey', 'turquia'] },
  turkey: { own: ['turkiye', 'turquia'] },
  netherlands: { own: ['holland', 'paises bajos', 'oranje'] },
  'united arab emirates': { duo: ['uae'] },
  ireland: { own: ['republic of ireland', 'irlanda'] },
  'republic of ireland': { own: ['ireland', 'irlanda'] },
  'bosnia and herzegovina': { own: ['bosnia', 'bosnia herzegovina'] },
  'north macedonia': { own: ['macedonia'] },
  'cape verde': { own: ['cabo verde'] },
  'dr congo': { own: ['congo dr', 'congo'] },
  'china pr': { own: ['china'] },
  mexico: { own: ['el tri'] },
  brazil: { own: ['brasil', 'selecao'] },
  germany: { own: ['deutschland', 'alemania'] },
  spain: { own: ['espana'] },
  italy: { own: ['italia', 'azzurri'] },
  france: { own: ['francia'] },
  japan: { own: ['japon'] },
  belgium: { own: ['belgica'] },
  switzerland: { own: ['suiza'] },
  croatia: { own: ['croacia'] },
  morocco: { own: ['marruecos'] },
  scotland: { own: ['escocia'] },
  wales: { own: ['gales'] },
  denmark: { own: ['dinamarca'] },
  sweden: { own: ['suecia'] },
  norway: { own: ['noruega'] },
  poland: { own: ['polonia'] },
  greece: { own: ['grecia'] },
  'south africa': { own: ['sudafrica'] },
  'saudi arabia': { own: ['arabia saudita', 'arabia saudi'] },
};
/** Short codes that are also words ("NO" for New Orleans). */
const NOT_A_CODE = new Set(['no', 'at', 'vs', 'in', 'on', 'or', 'is', 'it', 'as', 'of', 'to', 'tv', 'hd', 'sd', 'us', 'uk', 'the']);

/** College teams as providers write them, by ESPN's school (its location
 *  or name, normalised): `strong`, another name for the school ("UMass",
 *  "Pitt"); `code`, a short form many schools share ("BU", "OSU", "MSU"),
 *  which counts only next to the other team's name or on a channel of the
 *  game's league or service. */
const COLLEGE_ALIASES: Record<string, { strong?: string[]; code?: string[] }> = {
  'boston university': { strong: ['boston u'], code: ['bu'] },
  'boston college': { code: ['bc'] },
  massachusetts: { strong: ['umass'] },
  umass: { strong: ['massachusetts'] },
  'umass lowell': { strong: ['mass lowell'], code: ['uml'] },
  connecticut: { strong: ['uconn'] },
  uconn: { strong: ['connecticut'] },
  'minnesota duluth': { strong: ['minn duluth', 'mn duluth'], code: ['umd'] },
  minnesota: { code: ['umn'] },
  'north dakota': { code: ['und'] },
  michigan: { strong: ['umich'] },
  'michigan state': { code: ['msu'] },
  'michigan tech': { code: ['mtu'] },
  'western michigan': { code: ['wmu'] },
  'ohio state': { code: ['osu', 'tosu'] },
  'penn state': { code: ['psu'] },
  'new hampshire': { code: ['unh'] },
  vermont: { code: ['uvm'] },
  rensselaer: { strong: ['rpi'] },
  rpi: { strong: ['rensselaer'] },
  'notre dame': { code: ['nd'] },
  pittsburgh: { strong: ['pitt'] },
  pitt: { strong: ['pittsburgh'] },
  'ole miss': { strong: ['mississippi'] },
  mississippi: { strong: ['ole miss'] },
  'mississippi state': { code: ['msst', 'miss st'] },
  lsu: { strong: ['louisiana state'] },
  usc: { strong: ['southern california', 'southern cal'] },
  ucla: { strong: ['california los angeles'] },
  byu: { strong: ['brigham young'] },
  smu: { strong: ['southern methodist'] },
  tcu: { strong: ['texas christian'] },
  ucf: { strong: ['central florida'] },
  unlv: { strong: ['nevada las vegas'] },
  'north carolina': { code: ['unc'] },
  'nc state': { strong: ['north carolina state'], code: ['ncsu'] },
  'miami oh': { strong: ['miami ohio', 'miami of ohio'] },
  miami: { strong: ['miami fl', 'miami florida'] },
  'texas a&m': { code: ['tamu'] },
  'virginia tech': { code: ['vt'] },
  'georgia tech': { code: ['gt'] },
  'florida state': { code: ['fsu'] },
  'oklahoma state': { code: ['okst', 'osu'] },
  'oregon state': { code: ['osu'] },
  'arizona state': { code: ['asu'] },
  'iowa state': { code: ['isu'] },
  'kansas state': { code: ['ksu', 'k state'] },
  'st cloud state': { strong: ['st cloud'], code: ['scsu'] },
  denver: { code: ['du'] },
  'colorado college': { code: ['cc'] },
  northeastern: { code: ['neu'] },
  providence: { code: ['pc'] },
  wisconsin: { code: ['uw', 'wisc'] },
  'bowling green': { code: ['bgsu'] },
  'lake superior state': { code: ['lssu'] },
  alabama: { code: ['bama'] },
};
/** Clubs as providers write them, by ESPN's name (normalised), in every
 *  league: `strong` alone, `code` like a short code. */
const CLUB_ALIASES: Record<string, { strong?: string[]; code?: string[] }> = {
  internazionale: { strong: ['inter milan'], code: ['inter'] },
  'inter milan': { strong: ['internazionale'], code: ['inter'] },
  'bayern munich': { strong: ['bayern munchen', 'fc bayern'], code: ['bayern'] },
  'atletico madrid': { strong: ['atletico de madrid'], code: ['atletico', 'atleti'] },
  'paris saint germain': { strong: ['paris sg', 'psg'] },
  'borussia dortmund': { code: ['dortmund', 'bvb'] },
  'bayer leverkusen': { code: ['leverkusen'] },
  'ac milan': { code: ['milan'] },
  juventus: { code: ['juve'] },
  'sporting cp': { strong: ['sporting lisbon'], code: ['sporting'] },
};

/** A word right after a school's name that makes it another school
 *  ("Michigan State", "Texas A&M", "Miami (OH)"). */
const QUAL_AFTER = new Set(['state', 'st', 'tech', 'college', 'university', 'a&m', 'southern', 'christian', 'oh', 'ohio', 'fl', 'florida']);
/** A word right before one that does ("Central Michigan", "North Texas",
 *  "New Mexico"). */
const QUAL_BEFORE = new Set(['north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western', 'central', 'new']);

/** The other forms of a school's name: "Boston University" ↔ "Boston U",
 *  "University of X" → "X", "Saint" ↔ "St", "State" → "St". */
const schoolForms = (n: string): string[] => {
  const out: string[] = [];
  if (n.endsWith(' university')) out.push(`${n.slice(0, -' university'.length)} u`);
  if (n.endsWith(' u')) out.push(`${n.slice(0, -2)} university`);
  if (n.startsWith('university of ')) out.push(n.slice('university of '.length));
  if (n.startsWith('saint ')) out.push(`st ${n.slice(6)}`);
  if (n.startsWith('st ')) out.push(`saint ${n.slice(3)}`);
  if (/ state\b/.test(n)) out.push(n.replace(/ state\b/, ' st'));
  return out;
};

/** A team's words, spaced: its own names ("Packers", "Green Bay Packers",
 *  "Sixers"), its place ("Green Bay") and its short code ("GB"). A place
 *  alone names half the local channels in a city, so it only counts next to
 *  the other team. College teams go by their school ("Florida", "Miami",
 *  "Boston University", "UMass"), which is a place too: `shortPlace`, which
 *  names the team only next to the other one ("Tennessee vs Florida"), never
 *  alone ("FanDuel Sports Florida", "NBC 6 Miami"); and by their mascot
 *  ("Terriers") and short forms ("BU"), with the codes; and, weakly, by the
 *  city of a "<City> University / College" ("Boston"). `mine`: every name
 *  of the team (and the first two words of each), which tells "Michigan
 *  State" (another school) from this one's own long name. `rank`: its poll
 *  rank. */
interface TeamWords { own: string[]; shortPlace: string[]; place: string[]; code: string[]; duo: string[]; mine: Set<string>; rank: number }
const NO_TEAM: TeamWords = { own: [], shortPlace: [], place: [], code: [], duo: [], mine: new Set(), rank: 0 };
const teamWords = (t: GameTeam | null, national = false, college = false): TeamWords => {
  if (!t) return { ...NO_TEAM, mine: new Set() };
  const clean = (ws: string[]) => [...new Set(ws.map((w) => plain(String(w ?? ''))).filter((w) => w.length >= 3))];
  const loc = clean([t.location]);
  const shortPlace = clean([t.short]).filter((w) => loc.some((l) => l === w || ` ${l} `.includes(` ${w} `) || ` ${w} `.includes(` ${l} `)));
  const names = clean([t.short, t.name]);
  const known = national ? clean([t.name, t.short, t.location]).map((n) => NATIONAL_TEAMS[n]).filter(Boolean) : [];
  const duo = [...new Set([...known.flatMap((k) => k.duo ?? [])])];
  const ownAll = [...new Set([...names, ...names.flatMap((w) => TEAM_NICKNAMES[w] ?? []), ...known.flatMap((k) => k.own ?? [])])];
  // "USA" (a name ESPN may give as the short one) is a team next to the other
  // team only.
  const own = ownAll.filter((w) => !shortPlace.includes(w) && !(national && duo.includes(w)) && !(national && w === 'usa'));
  if (national && ownAll.includes('usa')) duo.push('usa');
  const code = plain(String(t.abbr ?? ''));
  const okCode = /^[a-z0-9]{2,4}$/.test(code) && !NOT_A_CODE.has(code);
  // A country's code ("CZE vs ENG") is enough next to the other country's.
  if (national && okCode) duo.push(code);
  const codes = okCode ? [code] : [];
  const keys = [...new Set([...loc, ...names])];
  const aliases = keys.map((k) => CLUB_ALIASES[k]).filter(Boolean);
  const extra: string[] = aliases.flatMap((a) => a.strong ?? []);
  codes.push(...aliases.flatMap((a) => a.code ?? []));
  const heads: string[] = [];
  if (college) {
    // The school by its name, and its other forms, is the team's name.
    const school = keys.map((k) => COLLEGE_ALIASES[k]).filter(Boolean);
    extra.push(...loc, ...school.flatMap((a) => a.strong ?? []), ...keys.flatMap(schoolForms));
    codes.push(...school.flatMap((a) => a.code ?? []));
    // The mascot: its name without the school ("Terriers").
    for (const n of names) for (const l of loc) {
      if (n.startsWith(`${l} `) && n.length - l.length > 3) codes.push(n.slice(l.length + 1));
    }
    // "Boston University", "Boston College": "Boston", weakly.
    for (const l of [...loc, ...clean([t.short])]) {
      const ws = l.split(' ');
      if (ws.length === 2 && /^(university|college|u)$/.test(ws[1]) && ws[0].length >= 4 && !QUAL_BEFORE.has(ws[0])) heads.push(ws[0]);
    }
  }
  const strongMore = [...new Set(extra.filter((w) => w.length >= 2 && !own.includes(w)))];
  const short = [...new Set([...shortPlace, ...strongMore])];
  const codeList = [...new Set(codes.filter((w) => w.length >= 2 && !own.includes(w) && !short.includes(w)))];
  const place = [...new Set([...loc, ...heads])].filter((w) => !own.includes(w) && !short.includes(w));
  const mine = new Set<string>();
  for (const w of [...own, ...short, ...place, ...codeList, ...duo, ...loc, ...names]) {
    mine.add(w);
    const ws = w.split(' ');
    if (ws.length > 2) mine.add(`${ws[0]} ${ws[1]}`);
  }
  const rank = Number(t.rank);
  return {
    own: spaced(own),
    shortPlace: spaced(short),
    place: spaced(place),
    code: spaced(codeList),
    duo: spaced([...new Set(duo)]),
    mine,
    rank: Number.isInteger(rank) && rank > 0 && rank < 100 ? rank : 0,
  };
};

/** Whether a spaced text has one of some spaced words as this team's: never
 *  inside a longer school's name that is not the team's own ("michigan" in
 *  "michigan state", "texas" in "north texas"). */
const hasOwn = (text: string, words: string[], mine: Set<string>): boolean => {
  for (const w of words) {
    let i = text.indexOf(w);
    while (i >= 0) {
      if (!otherSchool(text, i, w, mine)) return true;
      i = text.indexOf(w, i + 1);
    }
  }
  return false;
};
const otherSchool = (text: string, i: number, w: string, mine: Set<string>): boolean => {
  const core = w.slice(1, -1);
  const after = text.slice(i + w.length);
  const sp = after.indexOf(' ');
  const next = sp < 0 ? after : after.slice(0, sp);
  if (next && QUAL_AFTER.has(next) && !mine.has(`${core} ${next}`)) return true;
  const before = text.slice(0, i);
  const prev = before.slice(before.lastIndexOf(' ') + 1);
  return !!prev && QUAL_BEFORE.has(prev) && !mine.has(`${prev} ${core}`);
};

interface Side { strong: boolean; weak: boolean }
/** How a spaced text names a team: by its own name, its school or (on a
 *  channel of its league or service) its short code — strongly; by its
 *  city — weakly. */
const sideIn = (text: string, w: TeamWords, codes: boolean): Side => ({
  strong: hasOwn(text, w.own, w.mine) || hasOwn(text, w.shortPlace, w.mine) || (codes && hasOwn(text, w.code, w.mine)) || hasOwn(text, w.duo, w.mine),
  weak: hasOwn(text, w.place, w.mine),
});

/** How one side of a matchup names a team: 3 by name, 2 by a code or
 *  mascot (a name only next to a name, or on a channel of the game's
 *  league or service), 1 by its city, 0 not at all; -1 when the side gives
 *  another rank ("#5 Boston" is not #11 BU). Its own rank makes even a city
 *  the team's ("#11 Boston"). */
const sideTier = (side: string, rank: number, w: TeamWords): number => {
  const t = hasOwn(side, w.own, w.mine) || hasOwn(side, w.shortPlace, w.mine) || hasOwn(side, w.duo, w.mine) ? 3
    : hasOwn(side, w.code, w.mine) ? 2
      : hasOwn(side, w.place, w.mine) ? 1 : 0;
  if (!t || !rank || !w.rank) return t;
  return rank === w.rank ? 3 : -1;
};

/** How well a matchup's two sides are the game's two teams, either way
 *  round: both by name (a code or mascot next to a name, or on a channel
 *  of the game) 100, a name and a city 100, both cities 90 on a channel of
 *  the league; 0 when it is not. */
const sideScore = (c: SportsChannel, w: GameWords, ofGame: boolean, inLeague: boolean): number => {
  const [a, b] = c.sides!;
  const [ra, rb] = c.ranks ?? [0, 0];
  const pair = (x: number, y: number): number => {
    if (x <= 0 || y <= 0) return 0;
    const sx = x === 3 || (x === 2 && (ofGame || y === 3));
    const sy = y === 3 || (y === 2 && (ofGame || x === 3));
    if (sx && sy) return 100;
    if ((sx && y === 1) || (sy && x === 1)) return 100;
    return x === 1 && y === 1 && inLeague ? 90 : 0;
  };
  // Most sides name neither team: the other side is read only when this
  // one names one.
  const ah = sideTier(a, ra, w.home);
  const one = ah > 0 ? pair(ah, sideTier(b, rb, w.away)) : 0;
  if (one === 100) return one;
  const aw = sideTier(a, ra, w.away);
  return Math.max(one, aw > 0 ? pair(aw, sideTier(b, rb, w.home)) : 0);
};

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
  const name = plain(String(g.event || g.name || '').split(' · ')[0]);
  if (g.league === 'ufc') {
    const num = /\bufc \d{2,3}\b/.exec(name)?.[0];
    const vs = /([a-z]+)(?: \d+)? vs ([a-z]+)/.exec(name);
    const fighters = vs ? [vs[1], vs[2]].filter((w) => w.length >= 3) : [];
    return { phrases: num ? spaced([num]) : [], words: [], pair: fighters.length === 2 ? spaced(fighters) : [] };
  }
  const places = (g.places ?? []).map((p) => plain(String(p ?? ''))).filter(Boolean);
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

// ── an event channel's two sides ───────────────────────────────────────────

/** Whether a name (lower case) may be a matchup at all: a cheap first look
 *  before splitting it. */
const QUICK_SIDES = /\sv(?:s|\.)?\.?\s|@|\s(?:at|x)\s|\s[-\u2013\u2014]\s/;
/** What stands between the two sides, the surest first: "vs", "v", "@";
 *  then "at", "x" (Brazil's); then, after a label only, a dash. */
const SIDE_SEPS = [/\s(?:vs?\.?)\s|\s?@\s?/, /\s(?:at|x)\s/];
const SIDE_DASH = /\s[-\u2013\u2014]\s/;
/** Where a side's tail of times and dates starts ("7:00 PM ET", "09/24",
 *  "Sep 24", "(9.18"). */
const SIDE_TAIL = new RegExp(`\\s(?:\\d{1,2}[:.]\\d{2}|\\d{1,2}\\s*(?:am|pm)\\b|\\d{1,2}[/.]\\d{1,2}|20\\d\\d-\\d|${MONTH}\\.?\\s*\\d{1,2}\\b|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b)`);
/** A rank before a side's name: "#11 ", "No. 11 ", "11 ". */
const SIDE_RANK = /^\s*(?:#\s*|no\.?\s*)?(\d{1,2})\s+(?=[a-z])/;

const hasSides = (seg: string, dash: boolean): [string, string] | null => {
  for (const re of dash ? [...SIDE_SEPS, SIDE_DASH] : SIDE_SEPS) {
    const m = re.exec(seg);
    if (!m) continue;
    const left = seg.slice(0, m.index), right = seg.slice(m.index + m[0].length);
    if (/[a-z]/.test(left) && /[a-z]/.test(right)) return [left, right];
  }
  return null;
};

/** One side in plain words, with its rank apart (0: none). */
const readSide = (raw: string): { text: string; rank: number } | null => {
  let t = ` ${raw} `;
  const tail = SIDE_TAIL.exec(t);
  if (tail) t = t.slice(0, tail.index);
  let rank = 0;
  const r = SIDE_RANK.exec(t);
  if (r) {
    rank = Number(r[1]);
    t = t.slice(r[0].length);
  }
  const text = normalizeSpeech(t.replace(/[|:_/-]+/g, ' '));
  return /[a-z]/.test(text) ? { text, rank } : null;
};

/** A channel name's matchup: its two sides (spaced plain words, labels,
 *  ranks, times and dates gone), their ranks, and the rest of the name (its
 *  label: "B1G+ 03", "Paramount+ 04 UCL"). null when it is no matchup.
 *  "PPV EVENT 12: Michigan vs Ohio State", "ESPN+ 07 | BU vs MICH", "MLB 07
 *  [Yankees vs Red Sox]", "#11 Boston vs Michigan". */
const matchup = (raw: string): { sides: [string, string]; ranks?: [number, number]; label: string } | null => {
  let s = fold(String(raw ?? '')).toLowerCase();
  if (!QUICK_SIDES.test(s)) return null;
  // "(11) Boston": a rank; "[Yankees vs Red Sox]": the matchup itself;
  // "(9.18 6:00 PM ET)": a schedule; "(OH)": part of the name.
  s = s.replace(/\((\d{1,2})\)\s*(?=[a-z])/g, '#$1 ');
  s = s.replace(/[([]([^)\]]*)[)\]]?/g, (_, inner: string) =>
    (hasSides(` ${inner} `, false) ? ` | ${inner} | ` : /\d/.test(inner) ? ' ' : ` ${inner} `));
  // The label before a ":" or "|" ("Live Event 05:", "ESPN+ 07 |"), and any
  // after one ("| TUDN"); never the ":" of a time ("7:00").
  const segs = s.split(/\s*\|\s*|:(?!\d{2})/);
  for (let i = 0; i < segs.length; i++) {
    const cut = hasSides(` ${segs[i].trim()} `, i > 0);
    if (!cut) continue;
    const a = readSide(cut[0]), b = readSide(cut[1]);
    if (!a || !b) continue;
    const label = normalise(segs.filter((_, j) => j !== i).join(' '));
    return { sides: [` ${a.text} `, ` ${b.text} `], ...(a.rank || b.rank ? { ranks: [a.rank, b.rank] as [number, number] } : {}), label };
  }
  return null;
};

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
  const national = INTERNATIONAL_LEAGUES.includes(g.league);
  const college = COLLEGE_LEAGUES.includes(g.league);
  const home = teamWords(g.home, national, college), away = teamWords(g.away, national, college);
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
 *  session (yesterday's qualifying): then the channel is nothing to it.
 *  A name split in two sides is read side by side (sideScore); short codes
 *  count on a channel of the game (`ofGame`: its league's, family's or one
 *  of its services' feeds). */
const eventScore = (c: SportsChannel, g: Game, w: GameWords, inLeague: boolean, ofGame = inLeague): number => {
  let score = 0;
  if (w.card) {
    const ofSport = inLeague || (!c.leagues.length && EVENTS.test(`${c.cat} ${c.full}`));
    if (ofSport && cardIn(c.full, w.card)) {
      if (otherSession(c.full, g)) return -1;
      score = 100;
    }
  } else if (c.sides) {
    score = sideScore(c, w, ofGame, inLeague);
  } else {
    const h = sideIn(c.full, w.home, ofGame), a = sideIn(c.full, w.away, ofGame);
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
/** A whip-around "zone" channel of `LEAGUE_CHANNEL` (RedZone, "MLB Zone",
 *  "NBA Zone"): cuts between every game of the league, so it is never one
 *  game's own channel — unlike "NFL Network" or "MLB TV", which the rest of
 *  `LEAGUE_CHANNEL` also matches. A channel actually renamed for this game
 *  ("NBA ZONE 3: Lakers @ Celtics") is caught earlier, by `eventScore`,
 *  before this ever runs. */
const ZONE_CHANNEL = /\b(zone|red ?zone)\b/;

/** A numbered channel of a league with no game in its name ("MLB 05",
 *  "NBA Event 3"; for a fight card, "PPV 05" too). */
const isNumberedEvent = (c: SportsChannel, league: string): boolean =>
  (c.leagues.includes(league) || (league === 'ufc' && EVENTS.test(`${c.cat} ${c.name}`)))
  && /\b\d{1,3}\b/.test(c.name) && !LEAGUE_CHANNEL.test(c.name);

const linkKey = (l: { line: XtreamCreds; stream: XtreamLiveStream }): string => `${l.line.host}|${l.line.username}|${l.stream.stream_id}`;

/** This box's channels for a game, best first (at most `limit`).
 *  `learned`: categories learned as a league's (loadSportsChannels). */
export function channelsForGame(game: Game, channels: SportsChannel[], limit = 12, learned?: LearnedCats | null): GameChannel[] {
  const w = gameWords(game);
  const known = learnedMap(learned);
  const services = gameServices(game);
  const nets = aliasList(game.networks);
  const locals = aliasList((game.locals ?? []).map((l) => l.name));
  const places = [...w.home.place, ...w.away.place, ...w.home.own, ...w.away.own, ...w.home.shortPlace, ...w.away.shortPlace];
  // The playoffs are on national TV only: never the league's own channels.
  const post = !!game.postseason;
  const found: GameChannel[] = [];
  let leagueLinks = 0;
  for (const c of channels) {
    const inLeague = c.leagues.includes(game.league) || !!known?.get(c.cat)?.includes(game.league);
    // PPV carries fights, festivals and small races, never a league's games
    // or the scoreboards' races and tournaments: only a fight card is ever on
    // one. A league's own PPV category ("NHL PPV") is that league's.
    if (!inLeague && game.league !== 'ufc' && PPV.test(`${c.cat} ${c.full}`)) continue;
    const other = !inLeague && otherLeague(c, game.league);
    if (!other) {
      // A feed of one of the game's services ("ESPN+ 07: BU vs MICH") is
      // the game's own, like its league's: short codes count there.
      const s = eventScore(c, game, w, inLeague, inLeague || (!!c.service && services.includes(c.service)));
      if (s < 0) continue;
      if (s > 0) { found.push({ line: c.line, stream: c.stream, score: s, via: 'game' }); continue; }
    }
    // Otherwise the best of what it is for this game.
    let score = 0;
    let via: LinkKind = 'team';
    if (!other && (has(c.full, w.home.own) || has(c.full, w.away.own))) score = inLeague ? 60 : 45;
    // A streaming service's numbered feed ("ESPN 01", "FOX ONE 03") is never
    // the network itself: its guide says what is on (checkGuides).
    const net = c.service ? 0 : bestNetwork(nets, c.name);
    if (net > 0) {
      // A local station of a national network: the teams' own cities first.
      const s = net === 90 ? 70 : has(` ${c.name} `, places) ? 62 : 52;
      if (s > score) { score = s; via = 'network'; }
    }
    const local = c.service ? 0 : bestNetwork(locals, c.name);
    if (local > 0) {
      const s = local === 90 ? 66 : 58;
      if (s > score) { score = s; via = 'local'; }
    }
    // A league's own channels; for an event, also a channel named for the
    // league and nothing else ("Sky Sports F1", "UFC Fight Pass"), not one
    // named for another event ("NASCAR Cup: Talladega"). None in the
    // playoffs: "MLB Zone" or "NBA TV" never has a playoff game.
    const leagueOwn = LEAGUE_CHANNEL.test(c.name) || (!!w.card && leagueOnly(c.name, game.league));
    if (!score && !post && leagueLinks < 4 && inLeague && leagueOwn && !isNumberedEvent(c, game.league)) {
      leagueLinks += 1;
      score = 30;
      via = ZONE_CHANNEL.test(c.name) ? 'zone' : 'league';
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

/** Several lists of a game's links (its plain matches, what the guide
 *  confirmed), combined, each channel once, best source first, but always
 *  with its current name from `channels` — never a name a guide check
 *  cached earlier: a channel's line-up entry can be renamed (a provider
 *  reuses an event channel for the next game) between when the guide
 *  confirmed a link and when the list is drawn, while the link keeps
 *  playing the same stream either way. */
export function mergeLinks(sources: GameChannel[][], channels: SportsChannel[]): GameChannel[] {
  const fresh = new Map(channels.map((c) => [linkKey(c), c.stream]));
  const seen = new Set<string>();
  const out: GameChannel[] = [];
  for (const list of sources) {
    for (const l of list) {
      const k = linkKey(l);
      if (seen.has(k)) continue;
      seen.add(k);
      const stream = fresh.get(k);
      out.push(stream && stream !== l.stream ? { ...l, stream } : l);
    }
  }
  return out;
}

// ── what the guide leaves ──────────────────────────────────────────────────

const leagueFeedRes = new Map<string, RegExp | null>();
/** A league's numbered feed ("MLB 05: Tigers @ White Sox", "NBA ZONE 3"): its
 *  out-of-market package (MLB.tv, League Pass …) renamed for the day's games,
 *  which never carries a playoff game. */
export function isLeagueFeed(link: { stream: XtreamLiveStream }, league: string): boolean {
  let re = leagueFeedRes.get(league);
  if (re === undefined) {
    const words = LEAGUE_WORDS[league];
    re = words ? new RegExp(`^(?:${words.source})(?: [a-z]+)? \\d{1,3}(?: |$)`) : null;
    leagueFeedRes.set(league, re);
  }
  return !!re && re.test(cleanChannelName(String(link.stream?.name ?? '')));
}

/** A game's links in the groups its list shows, each in the order given. */
export interface LinkGroups {
  /** Named for the game or confirmed by its guide; in the regular season the
   *  teams', locals' and league's channels too. */
  main: GameChannel[];
  /** Networks only their name matched: "Not confirmed by the guide". */
  unconfirmed: GameChannel[];
  /** Whip-around channels ("MLB Zone"): every game of the league at once. */
  zone: GameChannel[];
  /** What the line-up search found and the guide has not confirmed: "Found
   *  by search — may not be this game". */
  search: GameChannel[];
}

/** A game's links as the guide leaves them. A channel whose guide shows
 *  something else is dropped. A network only its name matched waits for the
 *  guide (hidden while it is read: `scanning`), then is listed apart as not
 *  confirmed. In the playoffs (national TV only) the zone channels are
 *  dropped, and so are the teams', locals' and league's channels and the
 *  league's numbered feeds ("MLB 05: …") unless their guide has the game
 *  (hidden while it is read). What the line-up search found is listed apart
 *  too, unless its guide has the game (then it is one of the game's). Pure:
 *  the owner's picks go over the result. */
export function arrangeLinks(game: Game, links: GameChannel[], scanning: boolean): LinkGroups {
  const post = !!game.postseason;
  const out: LinkGroups = { main: [], unconfirmed: [], zone: [], search: [] };
  for (const l of links) {
    if (l.guide === 'other') continue;
    const yes = l.guide === 'yes';
    if (l.search && !yes) {
      out.search.push(l);
    } else if (l.via === 'zone') {
      if (!post) out.zone.push(l);
    } else if (yes || l.via === 'game') {
      if (yes || !post || !isLeagueFeed(l, game.league)) out.main.push(l);
    } else if (l.via === 'network') {
      if (!scanning) out.unconfirmed.push(l);
    } else if (!post) {
      out.main.push(l);
    }
  }
  return out;
}

// ── the owner's picks ──────────────────────────────────────────────────────

/** One row of the owner's game_day_channel_edits: for the game `game_id`, on
 *  the panel `service` (its hostname alone: "dstreams.xyz"), the channel
 *  `stream_id` is added, hidden or marked down. `sort` orders the added ones. */
export interface GameEdit {
  game_id: string; service: string; stream_id: number; channel_name: string; action: 'add' | 'hide' | 'down'; sort: number;
}

/** English for the label on a channel the owner added (the screen translates it). */
export const PICKED_LABEL = 'Picked by Snow Media';

/** The panel a line is on, by its hostname alone, however the line spells it:
 *  "http://dstreams.xyz:8080" and "dstreams.xyz:2083" are both "dstreams.xyz".
 *  The owner's picks name their service this way (never with a port). */
export function serviceOf(line: string | { host?: string | null } | null | undefined): string {
  const host = typeof line === 'string' ? line : line?.host;
  return String(host ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
}

/** The same login on the same panel, whichever port a line names. */
const loginOf = (line: XtreamCreds): string => `${serviceOf(line)}|${String(line?.username ?? '').trim().toLowerCase()}`;

/** A read that is stuck is given up on after this long: nothing waits for it. */
const EDITS_TIMEOUT_MS = 4_000;
const MAX_EDITS = 1000;
const NO_EDITS: GameEdit[] = [];

let editsCache: { at: number; edits: GameEdit[] } | null = null;
let editsInflight: Promise<GameEdit[]> | null = null;

const wholeNumber = (v: unknown): number => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);

/** A row of the table as an edit (null for one that cannot be used). */
const cleanEdit = (row: unknown): GameEdit | null => {
  const r = (row ?? {}) as Record<string, unknown>;
  const action = r.action;
  if (action !== 'add' && action !== 'hide' && action !== 'down') return null;
  const gameId = typeof r.game_id === 'string' || typeof r.game_id === 'number' ? String(r.game_id).trim() : '';
  const service = serviceOf(typeof r.service === 'string' ? r.service : '');
  const streamId = wholeNumber(r.stream_id);
  if (!gameId || !service || !Number.isInteger(streamId) || streamId <= 0) return null;
  const sort = wholeNumber(r.sort);
  return {
    game_id: gameId, service, stream_id: streamId, action,
    channel_name: typeof r.channel_name === 'string' ? r.channel_name.trim().slice(0, 120) : '',
    sort: Number.isFinite(sort) ? sort : 0,
  };
};

const sameEdits = (a: GameEdit[], b: GameEdit[]): boolean => a.length === b.length && a.every((x, i) => {
  const y = b[i];
  return x.game_id === y.game_id && x.service === y.service && x.stream_id === y.stream_id
    && x.action === y.action && x.sort === y.sort && x.channel_name === y.channel_name;
});

/** The owner's rows, or null when they cannot be had: offline, no such table
 *  on this database, an error, or no answer in a few seconds. Nothing is
 *  logged: an unreadable table is not an outage. */
async function readGameEdits(): Promise<GameEdit[] | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = supabase
      .from('game_day_channel_edits')
      .select('game_id,service,stream_id,channel_name,action,sort')
      .order('sort');
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), EDITS_TIMEOUT_MS); });
    const { data, error } = await Promise.race([query, late]);
    if (error || !Array.isArray(data)) return null;
    const out: GameEdit[] = [];
    for (const row of data.slice(0, MAX_EDITS)) {
      const e = cleanEdit(row);
      if (e) out.push(e);
    }
    return out;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The owner's picks, read with the games and kept as long as they are. Never
 *  throws and never makes anything wait: a read that fails (or is too slow)
 *  gives what the last good read gave, or nothing, and then every list is
 *  just what the matching found. A read that finds the same rows hands back
 *  the same list, so nothing is drawn again. */
export function fetchGameEdits(force = false): Promise<GameEdit[]> {
  if (!force && editsCache && Date.now() - editsCache.at < GAMES_TTL_MS) return Promise.resolve(editsCache.edits);
  if (!editsInflight) {
    editsInflight = (async () => {
      try {
        const fresh = await readGameEdits();
        if (!fresh) return editsCache?.edits ?? NO_EDITS;
        if (editsCache && sameEdits(editsCache.edits, fresh)) editsCache.at = Date.now();
        else editsCache = { at: Date.now(), edits: fresh.length ? fresh : NO_EDITS };
        return editsCache.edits;
      } catch {
        return editsCache?.edits ?? NO_EDITS;
      } finally {
        editsInflight = null;
      }
    })();
  }
  return editsInflight;
}

/** The owner's picks laid over a game's links, last of all — after the
 *  matching, the guide and the ordering — so no rule of theirs can drop one:
 *
 *  - hide: every link to that channel (its panel and stream id) is gone from
 *    this game's list;
 *  - add: the channel goes first, in the owner's `sort` order, on each of the
 *    box's lines on that panel (the stream as that line loaded it, or built
 *    from the pick when it did not load it), once: the pick replaces the
 *    matching's own link to the same channel;
 *  - down: the channel stays but goes last, marked `ownerDown`, as one every
 *    box has reported down.
 *
 *  Only rows for this game count. A hide beats an add or a down of the same
 *  channel. The same list comes back untouched when nothing applies, or when
 *  anything at all goes wrong. */
export function applyChannelEdits(
  game: Game, links: GameChannel[], edits: readonly GameEdit[] | null | undefined,
  lines: readonly XtreamCreds[], channels: readonly SportsChannel[] = [],
): GameChannel[] {
  try {
    const mine = (edits ?? []).filter((e) => e && String(e.game_id ?? '').trim() === game.id);
    if (!mine.length) return links;
    const rows = mine
      .map((e, i) => {
        const sort = Number(e.sort);
        return { i, action: e.action, service: serviceOf(e.service), id: Number(e.stream_id), name: String(e.channel_name ?? '').trim(), sort: Number.isFinite(sort) ? sort : 0 };
      })
      .filter((e) => (e.action === 'add' || e.action === 'hide' || e.action === 'down') && !!e.service && Number.isInteger(e.id) && e.id > 0);
    if (!rows.length) return links;

    const channelAt = (service: string, id: number): string => `${service}|${id}`;
    const setOf = (action: GameEdit['action']) => new Set(rows.filter((e) => e.action === action).map((e) => channelAt(e.service, e.id)));
    const hidden = setOf('hide');
    const down = setOf('down');
    const linkAt = (l: GameChannel): string => channelAt(serviceOf(l.line), Number(l.stream?.stream_id));
    const loginAt = (l: { line: XtreamCreds; stream: XtreamLiveStream }): string => `${loginOf(l.line)}|${Number(l.stream?.stream_id)}`;

    const kept = links.filter((l) => !hidden.has(linkAt(l)));

    // The owner's adds, in the owner's order (the position settles a tie: an
    // old WebView's sort is not stable).
    const adds = rows
      .filter((e) => e.action === 'add' && !hidden.has(channelAt(e.service, e.id)))
      .sort((a, b) => a.sort - b.sort || a.i - b.i);
    const picks: GameChannel[] = [];
    if (adds.length && lines.length) {
      const wanted = new Set(adds.map((e) => channelAt(e.service, e.id)));
      const loaded = new Map<string, XtreamLiveStream>();
      for (const c of channels) {
        if (wanted.has(channelAt(serviceOf(c.line), Number(c.stream?.stream_id)))) loaded.set(loginAt(c), c.stream);
      }
      const matched = new Map<string, GameChannel>(kept.map((l) => [loginAt(l), l]));
      const seen = new Set<string>();
      for (const e of adds) {
        for (const line of lines) {
          if (serviceOf(line) !== e.service) continue;
          const k = `${loginOf(line)}|${e.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const auto = matched.get(k);
          const stream = auto?.stream ?? loaded.get(k) ?? { stream_id: e.id, name: e.name || i18n.t('live.list.channelFallback') };
          picks.push({
            line, stream, score: 100, via: auto?.via ?? 'game', ...(auto?.note ? { note: auto.note } : {}),
            // A pick that is also down is a down channel first.
            ...(down.has(channelAt(e.service, e.id)) ? {} : { picked: true }),
          });
        }
      }
    }
    const picked = new Set(picks.map(loginAt));
    const rest = kept.filter((l) => !picked.has(loginAt(l)));

    const front: GameChannel[] = [];
    const back: GameChannel[] = [];
    for (const l of [...picks, ...rest]) {
      if (down.has(linkAt(l))) back.push({ ...l, ownerDown: true });
      else front.push(l);
    }
    if (kept.length === links.length && !picks.length && !back.length) return links;
    return [...front, ...back];
  } catch {
    return links;
  }
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

// ── the line-up search ─────────────────────────────────────────────────────

/** Words that never tell one team from another. */
const TOKEN_STOP = new Set([
  'the', 'and', 'university', 'college', 'state', 'city', 'united', 'club', 'real', 'sporting', 'saint', 'santa', 'san', 'los', 'las',
  'new', 'north', 'south', 'east', 'west', 'central', 'national', 'team', 'women', 'womens', 'men', 'mens', 'football', 'soccer',
]);

/** The words of a game's teams (or its event) a channel name would have:
 *  names, schools, mascots, cities and codes of three letters or more. */
export function teamTokens(game: Game): string[] {
  const out = new Set<string>();
  const put = (phrases: string[]) => {
    for (const p of phrases) for (const t of p.trim().split(' ')) if (t.length >= 3 && !/^\d+$/.test(t) && !TOKEN_STOP.has(t)) out.add(t);
  };
  if (!game?.home && !game?.away) {
    const c = cardWords(game);
    put([...c.phrases, ...c.words, ...c.pair]);
  } else {
    const w = gameWords(game);
    for (const t of [w.home, w.away]) put([...t.own, ...t.shortPlace, ...t.place, ...t.code, ...t.duo]);
  }
  return [...out];
}

/** The links a line-up search found for a game, on this box's lines on that
 *  provider (`host`: serviceOf a line). Each is checked against the box's
 *  own list first: the stream must be loaded here, under the name the search
 *  saw or one that still has a word of the teams' (a provider renames its
 *  event channels for each day's games: never the next game's channel).
 *  High first: 85, medium 75. */
export function aiLinks(game: Game, channels: SportsChannel[], host: string, matches: AiMatch[]): GameChannel[] {
  try {
    const service = serviceOf(host);
    if (!service || !Array.isArray(matches) || !matches.length) return [];
    const want = new Map<number, AiMatch>();
    for (const m of matches) {
      const id = Number(m?.stream_id);
      if (!Number.isInteger(id) || id <= 0 || (m.confidence !== 'high' && m.confidence !== 'medium')) continue;
      const had = want.get(id);
      if (!had || (had.confidence === 'medium' && m.confidence === 'high')) want.set(id, m);
    }
    if (!want.size) return [];
    let tokens: Set<string> | null = null;
    const out: GameChannel[] = [];
    const seen = new Set<string>();
    for (const c of channels) {
      const m = want.get(Number(c.stream?.stream_id));
      if (!m || serviceOf(c.line) !== service) continue;
      const k = linkKey(c);
      if (seen.has(k)) continue;
      const name = String(c.stream?.name ?? '').trim();
      if (name !== String(m.name ?? '').trim()) {
        tokens ??= new Set(teamTokens(game));
        if (!plain(name).split(' ').some((t) => tokens!.has(t))) continue;
      }
      seen.add(k);
      out.push({ line: c.line, stream: c.stream, score: m.confidence === 'high' ? 85 : 75, via: 'game', search: m.confidence });
    }
    return out.sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}

/** A channel the line-up search may look at: a matchup, a channel of a
 *  conference, service or event family, or a numbered feed of one; never a
 *  24/7 loop, a kids, music or film one, or PPV (fights and shows, never a
 *  team's game). 2 the surest, 0 not one. */
const scanRank = (c: SportsChannel): number => {
  if (NOT_SPORTS.test(c.cat) || LOOP.test(String(c.stream?.name ?? ''))) return 0;
  if (!c.leagues.length && PPV.test(`${c.cat} ${c.full}`)) return 0;
  if (c.sides) return 2;
  if (c.fam?.length || c.service || /\b(events?|live events?)\b/.test(`${c.cat} ${c.name}`)) return 1;
  return c.leagues.length && /\b\d{1,3}\b/.test(c.name) && !LEAGUE_CHANNEL.test(c.name) ? 1 : 0;
};

/** This box's channels on one provider (`host`) a line-up search should
 *  look at, each once, the matchups first, at most `max`: only its id, name
 *  and category (never a login, a password or an address). */
export function scanCandidates(channels: SportsChannel[], host: string, max = 2000): ScanCandidate[] {
  const service = serviceOf(host);
  if (!service) return [];
  const sure: ScanCandidate[] = [];
  const maybe: ScanCandidate[] = [];
  const seen = new Set<number>();
  for (const c of channels) {
    if (serviceOf(c.line) !== service) continue;
    const id = Number(c.stream?.stream_id);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    const r = scanRank(c);
    if (!r) continue;
    seen.add(id);
    (r === 2 ? sure : maybe).push({ id, name: String(c.stream?.name ?? '').trim().slice(0, 80), cat: c.cat.slice(0, 40) });
  }
  return [...sure, ...maybe].slice(0, Math.max(0, max));
}

/** A short fingerprint of a line-up search's channels (their ids and names,
 *  in id order): the same channels give the same one, on any box. */
export function lineupHash(c: ScanCandidate[]): string {
  const rows = (Array.isArray(c) ? c : [])
    .map((x) => ({ id: Number(x?.id) || 0, name: String(x?.name ?? '') }))
    .sort((a, b) => a.id - b.id || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // Two 32-bit FNV-1a hashes with different starts: 64 bits in all.
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  const eat = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193);
      h2 = Math.imul(h2 ^ ch, 0x01000193) ^ (h2 >>> 13);
    }
  };
  for (const r of rows) eat(`${r.id}\u0001${r.name}\u0002`);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}`;
}

// ── the guide ──────────────────────────────────────────────────────────────

/** Guide lookups for one game's list, four at a time: the networks and
 *  locals found, in the playoffs the league's feeds named for the game, the
 *  league's numbered channels, the numbered feeds of the game's streaming
 *  services, the league's and teams' own channels found, and the teams'
 *  cities' channels. */
const GUIDE_MAX = { found: 10, search: 6, leagueFeed: 4, numbered: 8, service: 8, league: 4, city: 6 };
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
 *  card's number or headliners. The game's words are worked out once. */
const listingMatcher = (g: Game): ((text: string) => boolean) => {
  if (!g.home && !g.away) {
    const card = cardWords(g);
    return (text) => cardIn(text, card) && !otherSession(text, g);
  }
  const w = gameWords(g);
  return (text) => {
    const h = sideIn(text, w.home, false), a = sideIn(text, w.away, false);
    return (h.strong && (a.strong || a.weak)) || (a.strong && h.weak);
  };
};
const listingText = (e: Listing): string => ` ${plain(`${e.title} ${e.description}`)} `;
const guideNote = (e: Listing, g: Game): string => {
  const title = e.title.trim();
  const more = listingMatcher(g)(` ${plain(title)} `) ? '' : e.description.trim();
  const s = more ? `${title} — ${more}` : title;
  return i18n.t('gameDay.guide.note', { text: s.length > 140 ? `${s.slice(0, 139)}…` : s });
};

/** What the guide says about a game's channels, as links to lay over the
 *  list (arrangeLinks sorts them out). Each network, local, team and league
 *  channel found by name, and each link the line-up search found
 *  (`search`: 'yes' makes it one of the game's, 'other' drops it), comes back with the guide's verdict on it
 *  (`guide`): 'yes' with score 95 and the listing as its note; 'other' when
 *  the listings around kickoff show another game (of any league) or nothing
 *  of its league, sport or teams ("SportsCenter", "College Football", a
 *  film); 'none' with no listing, a lookup that failed, or a listing of its
 *  league that names no teams ("MLB Baseball"). The channels no name found
 *  come back only when their guide has the game: the league's numbered
 *  channels ("MLB 07"), the numbered feeds of the game's streaming services
 *  ("PEACOCK 02", any category: a feed is never a PPV card's), and the teams'
 *  cities' channels. In the playoffs the league's feeds named for the game
 *  ("MLB 05: …") are read too. Looked at around kickoff (now, for a game
 *  under way); kept ten minutes. `onPartial` hears the links so far after
 *  each few lookups, so the list fills in as the answers come. */
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

  // A channel named for the game says so already; in the playoffs, not a
  // league's feed ("MLB 05: …"): those rarely carry a playoff game. What the
  // line-up search found is never sure: its guide is read too.
  const leagueFeeds = game.postseason ? found.filter((f) => f.via === 'game' && !f.search && isLeagueFeed(f, game.league)) : [];
  const seen = new Set<string>(found.filter((f) => f.via === 'game' && !f.search && !leagueFeeds.includes(f)).map(linkKey));
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
  // The search's links: 'other' drops one, 'yes' makes it the game's own.
  n = 0;
  for (const f of found) {
    if (n >= GUIDE_MAX.search) break;
    if (f.search && add(f, f.via, f)) n += 1;
  }
  n = 0;
  for (const f of leagueFeeds) {
    if (n >= GUIDE_MAX.leagueFeed) break;
    if (add(f, 'game', f)) n += 1;
  }
  n = 0;
  for (const c of channels) {
    if (n >= GUIDE_MAX.numbered) break;
    if (isNumberedEvent(c, game.league) && add(c, 'game')) n += 1;
  }
  // The feeds of the game's streaming services, its own first, then its
  // networks' partners (NBC's Peacock), in one pass over the channels.
  const services = gameServices(game);
  if (services.length) {
    const feeds: SportsChannel[][] = services.map(() => []);
    for (const c of channels) {
      const i = c.service ? services.indexOf(c.service) : -1;
      if (i >= 0 && feeds[i].length < GUIDE_MAX.service) feeds[i].push(c);
    }
    n = 0;
    for (const c of feeds.flat()) {
      if (n >= GUIDE_MAX.service) break;
      if (add(c, 'game')) n += 1;
    }
  }
  n = 0;
  for (const f of found) {
    if (n >= GUIDE_MAX.league) break;
    // Never a 'zone' channel: its guide names every game of the league at
    // once, so "the guide has this game" is never a real signal for it.
    if ((f.via === 'league' || f.via === 'team') && add(f, f.via, f)) n += 1;
  }
  const w = game.home || game.away ? gameWords(game) : null;
  if (w) {
    const city = [...w.home.place, ...w.away.place, ...w.home.shortPlace, ...w.away.shortPlace, ...w.home.own, ...w.away.own];
    n = 0;
    for (const c of channels) {
      if (n >= GUIDE_MAX.city) break;
      if (!c.leagues.length && has(` ${c.name} `, city) && add(c, 'local')) n += 1;
    }
  }

  const mine = listingMatcher(game);
  // Today's other games, of any league: their words are worked out only when
  // a listing needs them.
  const others = games.filter((g) => g.id !== game.id);
  let otherGames: Array<(text: string) => boolean> | null = null;
  const namesOther = (text: string): boolean => (otherGames ??= others.map(listingMatcher)).some((isIt) => isIt(text));
  const teams = w ? [...w.home.own, ...w.away.own, ...w.home.shortPlace, ...w.away.shortPlace] : [];
  const ofThisGame = (text: string): boolean => leaguesIn(text).includes(game.league) || has(text, teams);
  /** The verdict on a found channel whose listings around kickoff don't have the game. */
  const without = (around: Listing[]): GuideVerdict => {
    if (!around.length) return 'none';
    const texts = around.map(listingText);
    if (texts.some(namesOther)) return 'other';
    return texts.some(ofThisGame) ? 'none' : 'other';
  };
  const links: GameChannel[] = [];
  for (let i = 0; i < cands.length; i += 4) {
    const batch = await Promise.all(cands.slice(i, i + 4).map(async (cand): Promise<GameChannel | null> => {
      let around: Listing[];
      try {
        const { epg_listings } = await getShortEpg(cand.line, cand.stream.stream_id, 12);
        // What is on at kickoff, or starts within 45 minutes of it.
        around = readGuide(epg_listings ?? []).filter((e) => e.start <= at + 45 * 60_000 && e.end > at);
      } catch {
        return cand.was ? { ...cand.was, guide: 'none' } : null;
      }
      for (const e of around) {
        if (mine(listingText(e))) {
          return { line: cand.line, stream: cand.stream, score: 95, via: cand.via, note: guideNote(e, game), guide: 'yes' };
        }
      }
      return cand.was ? { ...cand.was, guide: without(around) } : null;
    }));
    for (const l of batch) if (l) links.push(l);
    if (onPartial && i + 4 < cands.length) onPartial(links.slice());
  }
  guideCache.set(game.id, { at: now, from: channels, links });
  return links;
}

// ── kickoff ────────────────────────────────────────────────────────────────

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** "Sat" in the app's language (Intl weekday names are not used: short TV names are set by hand). */
const weekdayShort = (d: Date): string => i18n.t(`gameDay.days.${WEEKDAY_KEYS[d.getDay()]}`);

/** The day ('' for today, "Tomorrow", "Sat") and the time, apart: a narrow
 *  column shows them on two lines. */
export function kickoffParts(start: string, now = new Date()): { day: string; time: string } {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  const time = formatTime(d);
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return { day: '', time };
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return { day: day(d) === day(tomorrow) ? i18n.t('gameDay.tomorrow') : weekdayShort(d), time };
}

/** "7:30 PM", or "Tomorrow 1:00 PM". */
export function kickoffLabel(start: string, now = new Date()): string {
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return '';
  const time = formatTime(d);
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return time;
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (day(d) === day(tomorrow)) return i18n.t('gameDay.tomorrowAt', { time });
  return i18n.t('gameDay.dayAt', { day: weekdayShort(d), time });
}

/** Tests only. */
export function __resetGameDayForTests(): void { gamesCache = null; channelsCache = null; guideCache.clear(); editsCache = null; editsInflight = null; }
