// Game Day: today's big games and every channel on this box that carries each.
//
// The games come from the game-day edge function — one shared list, a few
// minutes old at most — with the national TV networks and the local and
// regional ones (RSNs) showing each. The channels are this box's own: the
// whole line-up of each line (the same list Live TV search keeps), or on a
// box short of memory the sports, league and network categories only.
//
// A game's channels ("links"), best first:
//   game     an event channel naming both teams ("MLB 05: Yankees vs Red Sox"),
//            or a numbered league channel whose guide says so (scanEventChannels)
//   network  the national networks showing it (ESPN, FS1, FOX and its locals)
//   local    the local and regional networks showing it (YES, NESN, Bally …)
//   team     a channel named after one of the teams, in that league
//   league   the league's own channels ("MLB Zone", "NFL RedZone", "NBA TV")
// Streaming-only services (MLB.tv, ESPN+, Peacock …) are never links: no line
// carries them as a channel.
import { supabase } from '@/integrations/supabase/client';
import {
  getLiveCategories, getLiveStreams, getShortEpg, pickNowNext,
  type XtreamCategory, type XtreamCreds, type XtreamLiveStream,
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
  /** The channel name, cleaned ("us| espn hd" → "espn"). */
  name: string;
  /** Its category's name, normalised. */
  cat: string;
  /** Leagues its name or category mention. */
  leagues: string[];
}

/** A link for one game. */
export interface GameChannel { line: XtreamCreds; stream: XtreamLiveStream; score: number; via: LinkKind; note?: string }

const GAMES_TTL_MS = 3 * 60_000;
const CHANNELS_TTL_MS = 10 * 60_000;
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

/** League words, by league id (as the game-day function names them). */
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
  ufc: /\b(ufc|fight night|ppv|pay per view)\b/,
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

export function leaguesIn(text: string): string[] {
  const out = new Set<string>();
  for (const [id, re] of Object.entries(LEAGUE_WORDS)) if (re.test(text)) out.add(id);
  for (const [re, ids] of SPORT_LEAGUES) if (re.test(text)) for (const id of ids) out.add(id);
  return [...out];
}

const SPORT = /\b(sports?|espn|ppv|pay per view|events?|live events?|game ?day|zone|dazn|fubo|bein|tsn|sky sports|golf|tennis|racing|f1|nascar|wrestling|wwe|aew)\b/;
const NETWORK = /\b(networks?|locals?|regionals?|rsn|abc|cbs|nbc|fox|tnt|tbs|usa|us|united states|america|american|entertainment)\b/;
const NOT_SPORTS = /\b(kids?|children|cartoons?|music|radio|religious|faith|adult|xxx|movies?|cinema|vod|series)\b/;

const normalise = (s: string): string => normalizeSpeech(String(s ?? '').replace(/[|:_/-]+/g, ' '));

/** How sports-like a category is: 2 for leagues and sports, 1 for networks,
 *  locals and general US categories (where ESPN and FOX often live), 0 else. */
export const categoryWeight = (name: string): number => {
  const n = normalise(name);
  if (NOT_SPORTS.test(n)) return 0;
  return leaguesIn(n).length || SPORT.test(n) ? 2 : NETWORK.test(n) ? 1 : 0;
};

const lowMemory = (): boolean => {
  try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; }
};

/** One channel as Game Day reads it (null for a nameless one). */
export function sportsChannel(line: XtreamCreds, stream: XtreamLiveStream, catName = ''): SportsChannel | null {
  const name = cleanChannelName(String(stream?.name ?? ''));
  if (!name) return null;
  const cat = normalise(catName);
  return { line, stream, name, cat, leagues: leaguesIn(`${cat} ${name}`) };
}

let channelsCache: { key: string; at: number; list: SportsChannel[] } | null = null;

/** This box's channels Game Day can use, across its lines. */
export async function loadSportsChannels(lines: XtreamCreds[]): Promise<SportsChannel[]> {
  const key = lines.map((l) => `${l.host}|${l.username}`).join(',');
  if (channelsCache && channelsCache.key === key && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.list;
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
      try { all = await getLiveStreams(line); } catch { all = []; }
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
    // best categories, three at a time so the panel sees a short burst.
    const picked = cats
      .map((c) => ({ c, w: categoryWeight(c.category_name) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_CATEGORIES_PER_LINE);
    for (let i = 0; i < picked.length; i += 3) {
      const lists = await Promise.all(picked.slice(i, i + 3).map(({ c }) =>
        getLiveStreams(line, String(c.category_id)).then((l) => ({ c, l })).catch(() => ({ c, l: [] as XtreamLiveStream[] }))));
      for (const { c, l } of lists) for (const s of l) add(line, s, String(c.category_name ?? ''));
    }
  }
  channelsCache = { key, at: Date.now(), list: out };
  return out;
}

// ── matching ───────────────────────────────────────────────────────────────

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

/** A team's own names ("Packers", "Green Bay Packers") and its place name
 *  ("Green Bay"). A place alone names half the local channels in a city, so
 *  it only counts next to the other team. College teams go by their school
 *  ("Florida", "Miami"), which is a place too: `shortPlace`, which names the
 *  team only next to the other one ("Tennessee vs Florida"), never alone
 *  ("FanDuel Sports Florida", "NBC 6 Miami"). */
const teamWords = (t: GameTeam | null): { own: string[]; place: string[]; shortPlace: string[] } => {
  if (!t) return { own: [], place: [], shortPlace: [] };
  const clean = (ws: string[]) => [...new Set(ws.map((w) => normalizeSpeech(w)).filter((w) => w.length >= 3))];
  const loc = clean([t.location]);
  const shortPlace = clean([t.short]).filter((w) => loc.some((l) => l === w || ` ${l} `.includes(` ${w} `) || ` ${w} `.includes(` ${l} `)));
  const own = clean([t.short, t.name]).filter((w) => !shortPlace.includes(w));
  return { own, shortPlace, place: loc.filter((w) => !own.includes(w) && !shortPlace.includes(w)) };
};

const mentions = (channel: string, words: string[]): boolean =>
  words.some((w) => ` ${channel} `.includes(` ${w} `));

/** Channels that start with a network's name but are another network:
 *  "FOX" is not "FOX Sports 1" or "FOX News". */
const OTHER_NETWORK = new Set(['sports', 'sport', 'news', 'business', 'deportes', 'soccer', 'life', 'kids', 'family', 'movies', 'classics', 'weather', 'nation', 'reelz', 'xtra', 'plus', 'u', 'soul', 'nuestra']);

/** How many of a channel's first words an alias covers, when each alias word
 *  is that word or (from three letters) the start of it: ESPN writes "NBC
 *  Sports Phil" for "NBC Sports Philadelphia". 0 when it doesn't. */
const aliasWords = (alias: string, channel: string): number => {
  const a = alias.split(' '), c = channel.split(' ');
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
const networkScore = (alias: string, channel: string): number => {
  if (channel === alias) return 90;
  const n = aliasWords(alias, channel);
  if (!n) return 0;
  const words = channel.split(' ');
  if (n === words.length) return 90;
  const rest = words.slice(n);
  // "ESPN 2" is ESPN2; "FOX 5 New York" is a FOX station.
  if (rest.length === 1 && /^\d$/.test(rest[0])) return 0;
  return OTHER_NETWORK.has(rest[0]) ? 0 : 75;
};

/** A league's own channel: "MLB Zone", "NFL RedZone", "NBA TV", "NHL Network". */
const LEAGUE_CHANNEL = /\b(zone|redzone|network|tv|extra innings|center ice|league pass|sunday ticket|season pass|multi ?view|mix|channel)\b/;

/** A numbered channel of a league with no teams in its name ("MLB 05",
 *  "NBA Event 3"): its guide says which game it has (scanEventChannels). */
const isNumberedEvent = (c: SportsChannel, league: string): boolean =>
  c.leagues.includes(league) && /\b\d{1,3}\b/.test(c.name) && !LEAGUE_CHANNEL.test(c.name);

/** This box's channels for a game, best first (at most `limit`). */
export function channelsForGame(game: Game, channels: SportsChannel[], limit = 12): GameChannel[] {
  const home = teamWords(game.home);
  const away = teamWords(game.away);
  const nets = game.networks.filter((n) => !isStreamingOnly(n)).flatMap(aliasesFor);
  const locals = (game.locals ?? []).filter((l) => !isStreamingOnly(l.name)).flatMap((l) => aliasesFor(l.name));
  const places = [...home.place, ...away.place, ...home.own, ...away.own, ...home.shortPlace, ...away.shortPlace];
  const found: GameChannel[] = [];
  let leagueLinks = 0;
  for (const c of channels) {
    const { name } = c;
    // A channel that names another league is never this game's ("Kings",
    // "Rangers", "Giants" and "Cardinals" play in two leagues each).
    const otherLeague = c.leagues.length > 0 && !c.leagues.includes(game.league);
    const hOwn = mentions(name, home.own), aOwn = mentions(name, away.own);
    const hSchool = mentions(name, home.shortPlace), aSchool = mentions(name, away.shortPlace);
    const h = hOwn || hSchool || mentions(name, home.place);
    const a = aOwn || aSchool || mentions(name, away.place);
    if (!otherLeague && h && a && (hOwn || aOwn || hSchool || aSchool)) { found.push({ line: c.line, stream: c.stream, score: 100, via: 'game' }); continue; }
    if (!otherLeague && (hOwn || aOwn)) {
      found.push({ line: c.line, stream: c.stream, score: c.leagues.includes(game.league) ? 60 : 45, via: 'team' });
      continue;
    }
    let best = 0;
    for (const n of nets) best = Math.max(best, networkScore(n, name));
    if (best > 0) {
      // A local station of a national network: the teams' own cities first.
      const own = best === 90 || mentions(name, places);
      found.push({ line: c.line, stream: c.stream, score: best === 90 ? 70 : own ? 62 : 52, via: 'network' });
      continue;
    }
    let local = 0;
    for (const n of locals) local = Math.max(local, networkScore(n, name));
    if (local > 0) { found.push({ line: c.line, stream: c.stream, score: local === 90 ? 66 : 58, via: 'local' }); continue; }
    if (leagueLinks < 4 && c.leagues.includes(game.league) && LEAGUE_CHANNEL.test(name) && !isNumberedEvent(c, game.league)) {
      leagueLinks += 1;
      found.push({ line: c.line, stream: c.stream, score: 30, via: 'league' });
    }
  }
  found.sort((x, y) => y.score - x.score);
  const seen = new Set<string>();
  const out: GameChannel[] = [];
  for (const f of found) {
    const k = `${f.line.host}|${f.line.username}|${f.stream.stream_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

/** The categories of the game's league on this box, for "Browse in Live TV"
 *  when no channel names the game. */
export function leagueCategories(game: Game, channels: SportsChannel[], limit = 3): Array<{ line: XtreamCreds; categoryId: string; name: string }> {
  const out: Array<{ line: XtreamCreds; categoryId: string; name: string }> = [];
  const seen = new Set<string>();
  for (const c of channels) {
    if (!leaguesIn(c.cat).includes(game.league)) continue;
    const id = String(c.stream.category_id ?? '');
    const k = `${c.line.host}|${c.line.username}|${id}`;
    if (!id || seen.has(k)) continue;
    seen.add(k);
    out.push({ line: c.line, categoryId: id, name: c.cat.toUpperCase() });
    if (out.length >= limit) break;
  }
  return out;
}

const EPG_SCAN_MAX = 16;
const scanCache = new Map<string, { at: number; links: GameChannel[] }>();

/** Numbered league channels ("MLB 05") whose guide names this game, as game
 *  links. A handful of guide lookups, four at a time, kept ten minutes. */
export async function scanEventChannels(game: Game, channels: SportsChannel[]): Promise<GameChannel[]> {
  const hit = scanCache.get(game.id);
  if (hit && Date.now() - hit.at < CHANNELS_TTL_MS) return hit.links;
  const home = teamWords(game.home);
  const away = teamWords(game.away);
  if (!home.own.length && !away.own.length && !home.shortPlace.length && !away.shortPlace.length) return [];
  const candidates = channels.filter((c) => isNumberedEvent(c, game.league)).slice(0, EPG_SCAN_MAX);
  const links: GameChannel[] = [];
  for (let i = 0; i < candidates.length; i += 4) {
    const batch = await Promise.all(candidates.slice(i, i + 4).map(async (c): Promise<GameChannel | null> => {
      try {
        const { epg_listings } = await getShortEpg(c.line, c.stream.stream_id, 3);
        const { now, next } = pickNowNext(epg_listings ?? []);
        for (const e of [now, next]) {
          const title = normalizeSpeech(String(e?.title ?? ''));
          if (!title) continue;
          const hName = mentions(title, home.own) || mentions(title, home.shortPlace);
          const aName = mentions(title, away.own) || mentions(title, away.shortPlace);
          if ((hName && (aName || mentions(title, away.place))) || (aName && mentions(title, home.place))) {
            return { line: c.line, stream: c.stream, score: 95, via: 'game', note: String(e?.title ?? '') };
          }
        }
      } catch { /* no guide for it */ }
      return null;
    }));
    for (const l of batch) if (l) links.push(l);
  }
  scanCache.set(game.id, { at: Date.now(), links });
  return links;
}

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
export function __resetGameDayForTests(): void { gamesCache = null; channelsCache = null; scanCache.clear(); }
