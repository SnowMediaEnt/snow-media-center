// Game Day: today's and tomorrow's big games, for the Player's Game Day
// screen. One list for every box, built here from the public ESPN scoreboards
// and kept for a few minutes, so a box asks once instead of reading the TV
// Guide of hundreds of sports channels. The box matches each game to its own
// channels (src/lib/gameDay.ts).
//
//   POST {} (or {op:'list'})   anyone (verify_jwt=false)
//   → { ok, games: Game[], at }
//   POST {op:'check'}          games per league in the last build (from the
//                              cache: it never calls ESPN itself)
//
// A game: league, teams (names, short names, logos sized for a TV row),
// start time, state (pre | in), the live detail ("Q3 5:32") and score, the TV
// networks carrying it nationally, and the local / regional ones (RSNs) with
// the team whose market they serve. Finished games are left out.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const LEAGUES: Array<{ id: string; label: string; path: string }> = [
  { id: 'nfl', label: 'NFL', path: 'football/nfl' },
  { id: 'ncaaf', label: 'College Football', path: 'football/college-football' },
  { id: 'nba', label: 'NBA', path: 'basketball/nba' },
  { id: 'wnba', label: 'WNBA', path: 'basketball/wnba' },
  { id: 'ncaab', label: 'College Basketball', path: 'basketball/mens-college-basketball' },
  { id: 'mlb', label: 'MLB', path: 'baseball/mlb' },
  { id: 'nhl', label: 'NHL', path: 'hockey/nhl' },
  { id: 'mls', label: 'MLS', path: 'soccer/usa.1' },
  { id: 'epl', label: 'Premier League', path: 'soccer/eng.1' },
  { id: 'ucl', label: 'Champions League', path: 'soccer/uefa.champions' },
  { id: 'ufc', label: 'UFC', path: 'mma/ufc' },
];

const CACHE_MS = 4 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
/** ESPN turns away requests that don't look like a browser's. */
const ESPN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};
const ESPN_HOSTS = ['https://site.api.espn.com', 'https://site.web.api.espn.com'];
/** College scoreboards list dozens of small games; keep the televised ones. */
const MAX_PER_LEAGUE = 40;

interface Team { name: string; short: string; abbr: string; location: string; logo: string | null; score: string | null }
interface Game {
  id: string; league: string; leagueLabel: string; name: string; start: string;
  state: 'pre' | 'in'; detail: string; home: Team | null; away: Team | null; networks: string[];
  locals: Array<{ name: string; market: 'home' | 'away' }>;
}

let cache: { at: number; games: Game[] } | null = null;
let building: Promise<Game[]> | null = null;

/** A TV-row sized logo: ESPN's image service scales its team logos. */
const smallLogo = (url: unknown): string | null => {
  if (typeof url !== 'string' || !url) return null;
  const m = /^https:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)/.exec(url);
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=80&h=80` : url;
};

const ymd = (d: Date): string => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replaceAll('-', '');
};

// deno-lint-ignore no-explicit-any
type Any = any;

const team = (c: Any): Team | null => {
  const t = c?.team ?? c?.athlete;
  if (!t) return null;
  return {
    name: String(t.displayName ?? t.name ?? ''),
    short: String(t.shortDisplayName ?? t.name ?? t.displayName ?? ''),
    abbr: String(t.abbreviation ?? ''),
    location: String(t.location ?? ''),
    logo: smallLogo(t.logo ?? t.logos?.[0]?.href ?? t.flag?.href),
    score: c?.score != null && c.score !== '' ? String(c.score) : null,
  };
};

/** The TV showing a game: national networks, and local / regional ones by
 *  the team market they serve. */
const broadcastsOf = (comp: Any): { networks: string[]; locals: Array<{ name: string; market: 'home' | 'away' }> } => {
  const national = new Set<string>();
  const locals = new Map<string, 'home' | 'away'>();
  const put = (name: unknown, market: string) => {
    if (!name) return;
    const n = String(name);
    if (market === 'home' || market === 'away') { if (!locals.has(n)) locals.set(n, market); }
    else if (!market || market === 'national') national.add(n);
  };
  for (const b of comp?.broadcasts ?? []) {
    const market = String(b?.market ?? 'national').toLowerCase();
    for (const n of b?.names ?? []) put(n, market);
  }
  for (const g of comp?.geoBroadcasts ?? []) {
    const kind = String(g?.type?.shortName ?? '').toLowerCase();
    if (kind && kind !== 'tv') continue;
    put(g?.media?.shortName, String(g?.market?.type ?? '').toLowerCase());
  }
  return {
    networks: [...national].slice(0, 6),
    locals: [...locals].filter(([n]) => !national.has(n)).slice(0, 6).map(([name, market]) => ({ name, market })),
  };
};

/** One league's scoreboard for a day, from ESPN's main host or, failing
 *  that, its second one. Failures are logged (status and host only). */
async function fetchScoreboard(l: { id: string; path: string }, date: string): Promise<Any | null> {
  for (const host of ESPN_HOSTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${host}/apis/site/v2/sports/${l.path}/scoreboard?dates=${date}&limit=200`, { signal: ctl.signal, headers: ESPN_HEADERS });
      if (res.ok) return await res.json();
      console.error(`[game-day] ${l.id} ${date} ${host}: HTTP ${res.status}`);
      await res.body?.cancel();
    } catch (e) {
      console.error(`[game-day] ${l.id} ${date} ${host}: ${(e as Error).name} ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchLeague(l: { id: string; label: string; path: string }, date: string): Promise<Game[]> {
  try {
    const data = await fetchScoreboard(l, date);
    if (!data) return [];
    const out: Game[] = [];
    for (const e of data?.events ?? []) {
      const state = String(e?.status?.type?.state ?? '');
      if (state !== 'pre' && state !== 'in') continue;
      const comp = e?.competitions?.[0];
      const cs = comp?.competitors ?? [];
      const home = team(cs.find((c: Any) => c?.homeAway === 'home') ?? cs[0]);
      const away = team(cs.find((c: Any) => c?.homeAway === 'away') ?? cs[1]);
      // A fight card is one event: its name, not its first bout.
      const isCard = l.id === 'ufc';
      out.push({
        id: `${l.id}:${e.id}`,
        league: l.id,
        leagueLabel: l.label,
        name: String(isCard ? e.name : (away && home ? `${away.short} @ ${home.short}` : e.shortName ?? e.name ?? '')),
        start: String(e.date ?? comp?.date ?? ''),
        state: state as 'pre' | 'in',
        detail: String(e?.status?.type?.shortDetail ?? ''),
        home: isCard ? null : home,
        away: isCard ? null : away,
        ...broadcastsOf(comp),
      });
    }
    // Keep the ones on TV first when a league lists a lot (college).
    out.sort((a, b) => Number(b.networks.length > 0) - Number(a.networks.length > 0));
    return out.slice(0, MAX_PER_LEAGUE);
  } catch (e) {
    console.error(`[game-day] ${l.id} ${date}: ${(e as Error).message}`);
    return [];
  }
}

async function build(): Promise<Game[]> {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const dates = [ymd(now), ymd(new Date(now.getTime() + day))];
  // Until 5 AM Eastern, yesterday's late games (West Coast night games) may
  // still be on: yesterday's list too, keeping only what is live.
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(now)) % 24;
  const yesterday = etHour < 5 ? ymd(new Date(now.getTime() - day)) : null;
  const lists = await Promise.all(LEAGUES.flatMap((l) => [
    ...dates.map((d) => fetchLeague(l, d)),
    ...(yesterday ? [fetchLeague(l, yesterday).then((gs) => gs.filter((g) => g.state === 'in'))] : []),
  ]));
  const seen = new Set<string>();
  const until = now.getTime() + 30 * 60 * 60 * 1000;
  const games = lists.flat().filter((g) => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    const t = Date.parse(g.start);
    return g.state === 'in' || (Number.isFinite(t) && t <= until);
  });
  // Live first, then by kickoff.
  games.sort((a, b) => (a.state === 'in' ? 0 : 1) - (b.state === 'in' ? 0 : 1) || Date.parse(a.start) - Date.parse(b.start));
  return games;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  let op = '';
  try { op = String((await req.clone().json())?.op ?? ''); } catch { /* no body */ }
  // {op:'check'}: games per league in the last build. From the cache only:
  // anyone can call this, and it must never become a way to hammer ESPN.
  if (op === 'check') {
    const counts: Record<string, number> = {};
    for (const l of LEAGUES) counts[l.id] = 0;
    for (const g of cache?.games ?? []) counts[g.league] = (counts[g.league] ?? 0) + 1;
    return json({ ok: true, at: cache ? new Date(cache.at).toISOString() : null, counts });
  }
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      building ??= build().finally(() => { building = null; });
      const games = await building;
      // A failed round (every league empty) keeps the last good list; with
      // none, it's tried again in a minute rather than four.
      cache = games.length
        ? { at: Date.now(), games }
        : { at: Date.now() - CACHE_MS + 60_000, games: cache?.games ?? [] };
    }
    return json({ ok: true, games: cache.games, at: new Date(cache.at).toISOString() });
  } catch (e) {
    console.error('[game-day] error:', (e as Error).message);
    return json({ ok: false, reason: 'error', games: cache?.games ?? [] });
  }
});
