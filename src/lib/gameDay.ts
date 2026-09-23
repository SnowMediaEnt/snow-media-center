// Game Day: today's big games and the channel on this box that carries each.
//
// The games come from the game-day edge function — one shared list, a few
// minutes old at most. The channels are this box's own: the Live TV
// categories that look like sports or networks, a limited number per line,
// read once and kept for ten minutes. A game's channels are, best first:
// event channels named after both teams ("NFL 03: Bears vs Packers"), then
// ones naming one team, then the networks showing it (ESPN, FS1, CBS …).
import { supabase } from '@/integrations/supabase/client';
import { getLiveCategories, getLiveStreams, type XtreamCategory, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';
import { cleanChannelName, normalizeSpeech } from '@/lib/voiceCommands';

export interface GameTeam { name: string; short: string; abbr: string; location: string; logo: string | null; score: string | null }
export interface Game {
  id: string; league: string; leagueLabel: string; name: string; start: string;
  state: 'pre' | 'in'; detail: string; home: GameTeam | null; away: GameTeam | null; networks: string[];
}

/** A channel on one of the box's lines. */
export interface GameChannel { line: XtreamCreds; stream: XtreamLiveStream; score: number; via: 'event' | 'network' }

const GAMES_TTL_MS = 3 * 60_000;
const CHANNELS_TTL_MS = 10 * 60_000;
const MAX_CATEGORIES_PER_LINE = 14;

let gamesCache: { at: number; games: Game[] } | null = null;

export async function fetchGames(force = false): Promise<Game[]> {
  if (!force && gamesCache && Date.now() - gamesCache.at < GAMES_TTL_MS) return gamesCache.games;
  const { data, error } = await supabase.functions.invoke('game-day', { body: { op: 'list' } });
  if (error) throw error;
  const games = Array.isArray((data as { games?: unknown })?.games) ? (data as { games: Game[] }).games : [];
  gamesCache = { at: Date.now(), games };
  return games;
}

// ── the box's sports channels ──────────────────────────────────────────────

const SPORT = /\b(sports?|nfl|nba|wnba|mlb|nhl|mls|ncaa[fb]?|college|espn|ppv|pay per view|ufc|mma|boxing|fights?|soccer|futbol|football|basketball|baseball|hockey|premier league|epl|champions|laliga|serie a|bundesliga|league|zone|game ?day|events?|live events?|wrestling|wwe|aew|golf|tennis|racing|f1|nascar|dazn|fubo|bein|tsn|sky sports)\b/;
const NETWORK = /\b(networks?|locals?|abc|cbs|nbc|fox|tnt|tbs|entertainment)\b/;

/** How sports-like a category is: 2 for sport words, 1 for networks/locals. */
export const categoryWeight = (name: string): number => {
  const n = normalizeSpeech(String(name ?? '').replace(/[|:_/-]+/g, ' '));
  return SPORT.test(n) ? 2 : NETWORK.test(n) ? 1 : 0;
};

let channelsCache: { key: string; at: number; list: Array<{ line: XtreamCreds; stream: XtreamLiveStream }> } | null = null;

/** The sports and network channels on these lines. */
export async function loadSportsChannels(lines: XtreamCreds[]): Promise<Array<{ line: XtreamCreds; stream: XtreamLiveStream }>> {
  const key = lines.map((l) => `${l.host}|${l.username}`).join(',');
  if (channelsCache && channelsCache.key === key && Date.now() - channelsCache.at < CHANNELS_TTL_MS) return channelsCache.list;
  const out: Array<{ line: XtreamCreds; stream: XtreamLiveStream }> = [];
  for (const line of lines) {
    let cats: XtreamCategory[] = [];
    try { cats = await getLiveCategories(line); } catch { continue; }
    const picked = cats
      .map((c) => ({ c, w: categoryWeight(c.category_name) }))
      .filter((x) => x.w > 0)
      .sort((a, b) => b.w - a.w)
      .slice(0, MAX_CATEGORIES_PER_LINE);
    // Three at a time: the panel sees a short burst, not fourteen at once.
    for (let i = 0; i < picked.length; i += 3) {
      const lists = await Promise.all(picked.slice(i, i + 3).map(({ c }) => getLiveStreams(line, String(c.category_id)).catch(() => [])));
      for (const list of lists) for (const stream of list) out.push({ line, stream });
    }
  }
  channelsCache = { key, at: Date.now(), list: out };
  return out;
}

// ── matching ───────────────────────────────────────────────────────────────

/** What ESPN calls a network → what providers call the channel. */
const NETWORK_ALIASES: Record<string, string[]> = {
  fs1: ['fox sports 1', 'fs1'], fs2: ['fox sports 2', 'fs2'], espn2: ['espn 2', 'espn2'], espnu: ['espnu', 'espn u'],
  espnews: ['espnews'], secn: ['sec network'], accn: ['acc network'], btn: ['big ten network', 'btn'],
  cbssn: ['cbs sports network', 'cbssn'], 'nfl net': ['nfl network'], nfln: ['nfl network'], 'mlb net': ['mlb network'],
  mlbn: ['mlb network'], 'nhl net': ['nhl network'], nhln: ['nhl network'], 'nba tv': ['nba tv'], 'usa net': ['usa network'],
  usa: ['usa network'], trutv: ['trutv', 'tru tv'], 'golf': ['golf channel'], tnt: ['tnt'], tbs: ['tbs'], abc: ['abc'],
  cbs: ['cbs'], nbc: ['nbc'], fox: ['fox'], espn: ['espn'], 'espn deportes': ['espn deportes'], univision: ['univision'],
  telemundo: ['telemundo'], 'fox deportes': ['fox deportes'], 'tudn': ['tudn'], 'unimás': ['unimas'],
};
/** Streaming-only services no line carries as a channel. */
const STREAMING_ONLY = /\b(espn\+|peacock|prime video|paramount\+|apple tv|max|netflix|youtube|dazn app|nfl\+|mlb\.tv|nba league pass)\b/i;

const aliasesFor = (network: string): string[] => {
  const k = normalizeSpeech(network).replace(/\s+/g, ' ');
  return NETWORK_ALIASES[k] ?? [k];
};

/** A team's own names ("Packers", "Green Bay Packers") and its place name
 *  ("Green Bay"). A place alone names half the local channels in a city, so
 *  it only counts next to the other team. */
const teamWords = (t: GameTeam | null): { own: string[]; place: string[] } => {
  if (!t) return { own: [], place: [] };
  const clean = (ws: string[]) => [...new Set(ws.map((w) => normalizeSpeech(w)).filter((w) => w.length >= 3))];
  return { own: clean([t.short, t.name]), place: clean([t.location]).filter((w) => !clean([t.short]).includes(w)) };
};

const mentions = (channel: string, words: string[]): boolean =>
  words.some((w) => ` ${channel} `.includes(` ${w} `));

/** Channels that start with a network's name but are another network:
 *  "FOX" is not "FOX Sports 1" or "FOX News". */
const OTHER_NETWORK = new Set(['sports', 'sport', 'news', 'business', 'deportes', 'soccer', 'life', 'kids', 'family', 'movies', 'classics', 'weather', 'nation', 'reelz', 'xtra', 'plus', 'u', 'deportes']);

/** How well a channel name is a network: 90 exactly, 75 a feed of it
 *  ("FOX 32 Chicago", "ESPN HD"), 0 otherwise. */
const networkScore = (alias: string, channel: string): number => {
  if (channel === alias) return 90;
  if (!channel.startsWith(`${alias} `)) return 0;
  const rest = channel.slice(alias.length + 1).split(' ');
  // "ESPN 2" is ESPN2; "FOX 5 New York" is a FOX station.
  if (rest.length === 1 && /^\d$/.test(rest[0])) return 0;
  return OTHER_NETWORK.has(rest[0]) ? 0 : 75;
};

/** This box's channels for a game, best first (at most `limit`). */
export function channelsForGame(game: Game, channels: Array<{ line: XtreamCreds; stream: XtreamLiveStream }>, limit = 5): GameChannel[] {
  const home = teamWords(game.home);
  const away = teamWords(game.away);
  const nets = game.networks.filter((n) => !STREAMING_ONLY.test(n)).flatMap(aliasesFor);
  const found: GameChannel[] = [];
  for (const c of channels) {
    const name = cleanChannelName(c.stream.name);
    if (!name) continue;
    const hOwn = mentions(name, home.own), aOwn = mentions(name, away.own);
    const h = hOwn || mentions(name, home.place);
    const a = aOwn || mentions(name, away.place);
    if (h && a && (hOwn || aOwn)) { found.push({ ...c, score: 100, via: 'event' }); continue; }
    if (hOwn || aOwn) { found.push({ ...c, score: 60, via: 'event' }); continue; }
    let best = 0;
    for (const n of nets) best = Math.max(best, networkScore(n, name));
    if (best > 0) found.push({ ...c, score: 20 + best / 5, via: 'network' });
  }
  found.sort((x, y) => y.score - x.score);
  const seen = new Set<string>();
  const out: GameChannel[] = [];
  for (const f of found) {
    const k = `${f.line.host}|${f.stream.stream_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
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
export function __resetGameDayForTests(): void { gamesCache = null; channelsCache = null; }
