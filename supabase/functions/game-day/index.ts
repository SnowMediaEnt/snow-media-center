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
//
// Sports without two teams are events: a fight card (UFC), a race session
// (F1, NASCAR, IndyCar: the race, qualifying and sprint, not practice), a golf
// tournament, a tennis tournament. They carry no teams; `event` is their
// name ("Italian GP"), `session` the race session, and `places` the circuit,
// course or venue and its city — what providers put in a channel's name.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** How a league's scoreboard reads: two teams a game (by date), a fight card
 *  (by date), or events whose sessions or rounds run over several days (the
 *  current ones, no date). */
type Kind = 'teams' | 'card' | 'racing' | 'golf' | 'tennis';
const LEAGUES: Array<{ id: string; label: string; path: string; kind: Kind }> = [
  { id: 'nfl', label: 'NFL', path: 'football/nfl', kind: 'teams' },
  { id: 'ncaaf', label: 'College Football', path: 'football/college-football', kind: 'teams' },
  { id: 'ufl', label: 'UFL', path: 'football/ufl', kind: 'teams' },
  { id: 'nba', label: 'NBA', path: 'basketball/nba', kind: 'teams' },
  { id: 'wnba', label: 'WNBA', path: 'basketball/wnba', kind: 'teams' },
  { id: 'ncaab', label: 'College Basketball', path: 'basketball/mens-college-basketball', kind: 'teams' },
  { id: 'mlb', label: 'MLB', path: 'baseball/mlb', kind: 'teams' },
  { id: 'nhl', label: 'NHL', path: 'hockey/nhl', kind: 'teams' },
  { id: 'mls', label: 'MLS', path: 'soccer/usa.1', kind: 'teams' },
  { id: 'nwsl', label: 'NWSL', path: 'soccer/usa.nwsl', kind: 'teams' },
  { id: 'ligamx', label: 'Liga MX', path: 'soccer/mex.1', kind: 'teams' },
  { id: 'epl', label: 'Premier League', path: 'soccer/eng.1', kind: 'teams' },
  { id: 'laliga', label: 'La Liga', path: 'soccer/esp.1', kind: 'teams' },
  { id: 'seriea', label: 'Serie A', path: 'soccer/ita.1', kind: 'teams' },
  { id: 'bundesliga', label: 'Bundesliga', path: 'soccer/ger.1', kind: 'teams' },
  { id: 'ligue1', label: 'Ligue 1', path: 'soccer/fra.1', kind: 'teams' },
  { id: 'ucl', label: 'Champions League', path: 'soccer/uefa.champions', kind: 'teams' },
  { id: 'uel', label: 'Europa League', path: 'soccer/uefa.europa', kind: 'teams' },
  { id: 'ufc', label: 'UFC', path: 'mma/ufc', kind: 'card' },
  { id: 'f1', label: 'F1', path: 'racing/f1', kind: 'racing' },
  { id: 'nascar', label: 'NASCAR', path: 'racing/nascar-premier', kind: 'racing' },
  { id: 'indycar', label: 'IndyCar', path: 'racing/irl', kind: 'racing' },
  { id: 'pga', label: 'PGA Tour', path: 'golf/pga', kind: 'golf' },
  { id: 'lpga', label: 'LPGA', path: 'golf/lpga', kind: 'golf' },
  { id: 'atp', label: 'ATP Tennis', path: 'tennis/atp', kind: 'tennis' },
  { id: 'wta', label: 'WTA Tennis', path: 'tennis/wta', kind: 'tennis' },
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
/** ESPN requests in flight at once, per build. */
const MAX_PARALLEL = 8;

interface Team { name: string; short: string; abbr: string; location: string; logo: string | null; score: string | null }
interface Game {
  id: string; league: string; leagueLabel: string; name: string; start: string;
  state: 'pre' | 'in'; detail: string; home: Team | null; away: Team | null; networks: string[];
  locals: Array<{ name: string; market: 'home' | 'away' }>;
  /** Events only (no teams): the event's own name, the race session, and the
   *  circuit, course or venue with its city. */
  event?: string; session?: string; places?: string[];
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

/** One league's scoreboard for a day (or, with no day, its current events),
 *  from ESPN's main host or, failing that, its second one. Failures are
 *  logged (status and host only). */
async function fetchScoreboard(l: { id: string; path: string }, date?: string): Promise<Any | null> {
  const query = date ? `?dates=${date}&limit=200` : '';
  for (const host of ESPN_HOSTS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${host}/apis/site/v2/sports/${l.path}/scoreboard${query}`, { signal: ctl.signal, headers: ESPN_HEADERS });
      if (res.ok) return await res.json();
      console.error(`[game-day] ${l.id} ${date ?? 'current'} ${host}: HTTP ${res.status}`);
      await res.body?.cancel();
    } catch (e) {
      console.error(`[game-day] ${l.id} ${date ?? 'current'} ${host}: ${(e as Error).name} ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function fetchLeague(l: { id: string; label: string; path: string; kind: Kind }, date: string): Promise<Game[]> {
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
      const isCard = l.kind === 'card';
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
        ...(isCard ? { event: String(e.name ?? '') } : {}),
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

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const stateOf = (st: Any): string => String(st?.type?.state ?? '');

/** Where an event is, as providers may name it: the circuit, course or venue
 *  and its city (never the country alone: "USA" names half the line-up). */
const placesOf = (...things: Any[]): string[] => {
  const out = new Set<string>();
  for (const t of things) {
    if (!t) continue;
    for (const v of [t.fullName, t.name, t.shortName, t.address?.city]) {
      const s = text(v);
      if (s && s.length <= 60) out.add(s);
    }
  }
  return [...out].slice(0, 6);
};

/** A race weekend's session by its type: Race, Qualifying, Sprint (and its
 *  qualifying), Practice; '' when ESPN doesn't say. */
const sessionOf = (c: Any): string => {
  const t = `${text(c?.type?.abbreviation)} ${text(c?.type?.text)} ${text(c?.type?.name)}`.toLowerCase().trim();
  if (!t) return '';
  if (/sprint/.test(t) && /qual|shootout/.test(t)) return 'Sprint Qualifying';
  if (/\bss\b/.test(t)) return 'Sprint Qualifying';
  if (/sprint|\bsr\b/.test(t)) return 'Sprint';
  if (/qual|\bq\d?\b/.test(t)) return 'Qualifying';
  if (/practice|\bfp\d|\bp\d\b|warm/.test(t)) return 'Practice';
  if (/race|\br\b/.test(t)) return 'Race';
  return '';
};

/** A league of events: its current events (no date), each session, round or
 *  day still to come or under way. */
async function fetchEvents(l: { id: string; label: string; path: string; kind: Kind }): Promise<Game[]> {
  try {
    const data = await fetchScoreboard(l);
    if (!data) return [];
    const out: Game[] = [];
    for (const e of data?.events ?? []) {
      const name = text(e.shortName) || text(e.name);
      if (!name) continue;
      const comps: Any[] = e.competitions ?? [];
      const base = { league: l.id, leagueLabel: l.label, home: null, away: null, event: name };
      if (l.kind === 'racing') {
        const places = placesOf(e.circuit, e.venue, comps[0]?.venue, comps[0]?.circuit);
        for (const c of comps) {
          const state = stateOf(c.status);
          const session = sessionOf(c);
          if ((state !== 'pre' && state !== 'in') || session === 'Practice') continue;
          const tv = broadcastsOf(c);
          out.push({
            ...base,
            id: `${l.id}:${e.id}:${c.id ?? session}`,
            name: session ? `${name} · ${session}` : name,
            start: String(c.date ?? e.date ?? ''),
            state: state as 'pre' | 'in',
            detail: String(c.status?.type?.shortDetail ?? ''),
            ...(tv.networks.length || tv.locals.length ? tv : broadcastsOf(e)),
            ...(session ? { session } : {}),
            places,
          });
        }
        if (!comps.length) {
          const state = stateOf(e.status);
          if (state === 'pre' || state === 'in') {
            out.push({ ...base, id: `${l.id}:${e.id}`, name, start: String(e.date ?? ''), state, detail: String(e.status?.type?.shortDetail ?? ''), ...broadcastsOf(e), places });
          }
        }
        continue;
      }
      if (l.kind === 'golf') {
        const c = comps[0];
        const st = c?.status ?? e.status;
        const state = stateOf(st);
        if (state !== 'pre' && state !== 'in') continue;
        const tv = broadcastsOf(c);
        out.push({
          ...base,
          id: `${l.id}:${e.id}`,
          name,
          start: String(c?.date ?? e.date ?? ''),
          state: state as 'pre' | 'in',
          detail: String(st?.type?.shortDetail ?? ''),
          ...(tv.networks.length || tv.locals.length ? tv : broadcastsOf(e)),
          places: placesOf(c?.venue, e.venue, ...(e.courses ?? [])),
        });
        continue;
      }
      // Tennis: a tournament is a day of matches. Listed while it has one
      // under way or still to come, with every match's TV.
      const matches: Any[] = [...comps, ...(e.groupings ?? []).flatMap((g: Any) => g?.competitions ?? [])];
      const live = matches.filter((m) => stateOf(m.status) === 'in');
      const next = matches
        .filter((m) => stateOf(m.status) === 'pre')
        .map((m) => Date.parse(String(m.date ?? '')))
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b)[0];
      if (!live.length && next == null) continue;
      const networks = new Set<string>();
      for (const m of [...live, ...matches.filter((x) => stateOf(x.status) === 'pre')]) for (const n of broadcastsOf(m).networks) networks.add(n);
      const firstLive = live.map((m) => Date.parse(String(m.date ?? ''))).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)[0];
      out.push({
        ...base,
        id: `${l.id}:${e.id}`,
        name,
        start: new Date(live.length ? (firstLive ?? Date.now()) : next).toISOString(),
        state: live.length ? 'in' : 'pre',
        detail: live.length ? `${live.length} match${live.length === 1 ? '' : 'es'} on` : '',
        networks: [...networks].slice(0, 6),
        locals: [],
        places: placesOf(e.venue, comps[0]?.venue),
      });
    }
    return out.slice(0, MAX_PER_LEAGUE);
  } catch (e) {
    console.error(`[game-day] ${l.id} current: ${(e as Error).message}`);
    return [];
  }
}

/** Runs jobs a few at a time: two dozen scoreboards at once is a burst ESPN
 *  may turn away. */
async function inTurn<T>(jobs: Array<() => Promise<T>>, width = MAX_PARALLEL): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, lane));
  return out;
}

async function build(): Promise<Game[]> {
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const dates = [ymd(now), ymd(new Date(now.getTime() + day))];
  // Until 5 AM Eastern, yesterday's late games (West Coast night games) may
  // still be on: yesterday's list too, keeping only what is live.
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }).format(now)) % 24;
  const yesterday = etHour < 5 ? ymd(new Date(now.getTime() - day)) : null;
  const lists = await inTurn(LEAGUES.flatMap((l): Array<() => Promise<Game[]>> => (
    l.kind === 'racing' || l.kind === 'golf' || l.kind === 'tennis'
      ? [() => fetchEvents(l)]
      : [
        ...dates.map((d) => () => fetchLeague(l, d)),
        ...(yesterday ? [() => fetchLeague(l, yesterday).then((gs) => gs.filter((g) => g.state === 'in'))] : []),
      ])));
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
