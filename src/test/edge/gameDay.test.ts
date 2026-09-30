// game-day: every league on the list, and the sports without two teams read
// as events — a race's sessions (not practice), a golf tournament under way,
// a tennis tournament with matches on — with their circuit, course or venue.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction } from './fakeSupabase';

const NOW = Date.parse('2026-09-27T12:00:00Z');
const H = 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** ESPN's scoreboards, as much of them as the function reads. */
const BOARDS: Record<string, unknown> = {
  'racing/f1': {
    events: [{
      id: 'e1', name: "Formula 1 Pirelli Gran Premio d'Italia 2026", shortName: 'Italian GP', date: iso(NOW - 48 * H),
      circuit: { fullName: 'Autodromo Nazionale Monza', address: { city: 'Monza', country: 'Italy' } },
      competitions: [
        { id: 'c1', date: iso(NOW - 45 * H), type: { abbreviation: 'FP1' }, status: { type: { state: 'post' } } },
        { id: 'c2', date: iso(NOW - 20 * H), type: { abbreviation: 'Qual' }, status: { type: { state: 'post' } } },
        { id: 'c3', date: iso(NOW - 2 * H), type: { abbreviation: 'FP3' }, status: { type: { state: 'pre' } } },
        { id: 'c4', date: iso(NOW + H), type: { abbreviation: 'Race' }, status: { type: { state: 'pre', shortDetail: 'Sun 9:00 AM' } }, broadcasts: [{ market: 'national', names: ['ESPN'] }] },
      ],
    }],
  },
  'golf/pga': {
    events: [{
      id: 'g1', name: 'TOUR Championship', date: iso(NOW - 72 * H),
      competitions: [{
        id: 'gc', date: iso(NOW - 72 * H), status: { type: { state: 'in', shortDetail: 'Round 4 - In Progress' } },
        broadcasts: [{ market: 'national', names: ['Golf Channel', 'NBC'] }],
        venue: { fullName: 'East Lake Golf Club', address: { city: 'Atlanta' } },
      }],
    }],
  },
  'tennis/atp': {
    events: [{
      // A small tournament of the week: left out.
      id: 't0', name: 'Chengdu Open', date: iso(NOW - 48 * H),
      groupings: [{ competitions: [{ id: 'm0', date: iso(NOW - H), status: { type: { state: 'in' } } }] }],
    }, {
      id: 't1', name: 'Laver Cup', date: iso(NOW - 48 * H),
      groupings: [{
        competitions: [
          { id: 'm1', date: iso(NOW - H), status: { type: { state: 'in' } }, broadcasts: [{ market: 'national', names: ['Tennis Channel'] }] },
          { id: 'm2', date: iso(NOW + 3 * H), status: { type: { state: 'pre' } }, broadcasts: [{ market: 'national', names: ['Tennis Channel'] }] },
          { id: 'm3', date: iso(NOW - 5 * H), status: { type: { state: 'post' } } },
        ],
      }],
    }],
  },
  'soccer/esp.1': {
    events: [{
      id: 's1', date: iso(NOW + 2 * H), status: { type: { state: 'pre', shortDetail: '10:00 AM' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'Barcelona', shortDisplayName: 'Barcelona', abbreviation: 'BAR', location: 'Barcelona' } },
          { homeAway: 'away', team: { displayName: 'Real Madrid', shortDisplayName: 'Real Madrid', abbreviation: 'RMA', location: 'Real Madrid' } },
        ],
        broadcasts: [{ market: 'national', names: ['ESPN+'] }],
      }],
    }],
  },
  // National teams: an international window's friendlies (one on TV, the
  // USA's, and a small one not) and a Nations League night.
  'soccer/fifa.friendly': {
    events: [{
      id: 'f0', date: iso(NOW + 3 * H), status: { type: { state: 'pre', shortDetail: '11:00 AM' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'Andorra', shortDisplayName: 'Andorra', abbreviation: 'AND', location: 'Andorra' } },
          { homeAway: 'away', team: { displayName: 'Malta', shortDisplayName: 'Malta', abbreviation: 'MLT', location: 'Malta' } },
        ],
      }],
    }, {
      id: 'f1', date: iso(NOW + 5 * H), status: { type: { state: 'pre', shortDetail: '1:00 PM' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'United States', shortDisplayName: 'USA', abbreviation: 'USA', location: 'United States' } },
          { homeAway: 'away', team: { displayName: 'Chile', shortDisplayName: 'Chile', abbreviation: 'CHI', location: 'Chile' } },
        ],
        broadcasts: [{ market: 'national', names: ['TNT', 'truTV'] }, { market: 'national', names: ['Universo'] }],
      }],
    }],
  },
  'soccer/uefa.nations': {
    events: [{
      id: 'n1', date: iso(NOW + 8 * H), status: { type: { state: 'pre', shortDetail: '3:45 PM' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'Czechia', shortDisplayName: 'Czechia', abbreviation: 'CZE', location: 'Czechia' } },
          { homeAway: 'away', team: { displayName: 'England', shortDisplayName: 'England', abbreviation: 'ENG', location: 'England' } },
        ],
        broadcasts: [{ market: 'national', names: ['FS1'] }, { market: 'national', names: ['Fox One'] }],
      }],
    }],
  },
  // Thirty small games with no TV, the USA's (no TV yet) and one on TV, last.
  'soccer/fifa.friendly.w': {
    events: [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `s${i}`, date: iso(NOW + (2 + i * 0.1) * H), status: { type: { state: 'pre', shortDetail: '' } },
        competitions: [{ competitors: [
          { homeAway: 'home', team: { displayName: `Home ${i}`, shortDisplayName: `Home ${i}`, abbreviation: `H${i}` } },
          { homeAway: 'away', team: { displayName: `Away ${i}`, shortDisplayName: `Away ${i}`, abbreviation: `A${i}` } },
        ] }],
      })),
      {
        id: 'usa', date: iso(NOW + 9 * H), status: { type: { state: 'pre', shortDetail: '' } },
        competitions: [{ competitors: [
          { homeAway: 'home', team: { displayName: 'United States', shortDisplayName: 'USA', abbreviation: 'USA' } },
          { homeAway: 'away', team: { displayName: 'Japan', shortDisplayName: 'Japan', abbreviation: 'JPN' } },
        ] }],
      },
      {
        id: 'tv', date: iso(NOW + 10 * H), status: { type: { state: 'pre', shortDetail: '' } },
        competitions: [{ competitors: [
          { homeAway: 'home', team: { displayName: 'England', shortDisplayName: 'England', abbreviation: 'ENG' } },
          { homeAway: 'away', team: { displayName: 'Spain', shortDisplayName: 'Spain', abbreviation: 'ESP' } },
        ], broadcasts: [{ market: 'national', names: ['ESPN2'] }] }],
      },
    ],
  },
  // A game that should have started hours ago and never did: not listed.
  'soccer/eng.fa': {
    events: [{
      id: 'x1', date: iso(NOW - 6 * H), status: { type: { state: 'pre', shortDetail: '6:00 AM' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: 'Leeds United', shortDisplayName: 'Leeds', abbreviation: 'LEE', location: 'Leeds' } },
        { homeAway: 'away', team: { displayName: 'Derby County', shortDisplayName: 'Derby', abbreviation: 'DER', location: 'Derby' } },
      ] }],
    }, {
      id: 'x2', date: iso(NOW + 6 * H), status: { type: { state: 'pre', shortDetail: '2:00 PM' } },
      competitions: [{ competitors: [
        { homeAway: 'home', team: { displayName: 'Leeds United', shortDisplayName: 'Leeds', abbreviation: 'LEE', location: 'Leeds' } },
        { homeAway: 'away', team: { displayName: 'Derby County', shortDisplayName: 'Derby', abbreviation: 'DER', location: 'Derby' } },
      ], broadcasts: [{ market: 'national', names: ['ESPN+'] }] }],
    }],
  },
  'baseball/mlb': {
    events: [{
      // A playoff game: ESPN's season type 3, with the round in the notes.
      id: 'b1', date: iso(NOW + 4 * H), season: { type: 3, slug: 'post-season' },
      status: { type: { state: 'pre', shortDetail: '4:08 PM' } },
      competitions: [{
        notes: [{ type: 'event', headline: 'AL Wild Card - Game 1' }],
        competitors: [
          { homeAway: 'home', team: { displayName: 'Chicago White Sox', shortDisplayName: 'White Sox', abbreviation: 'CHW', location: 'Chicago' } },
          { homeAway: 'away', team: { displayName: 'Boston Red Sox', shortDisplayName: 'Red Sox', abbreviation: 'BOS', location: 'Boston' } },
        ],
        broadcasts: [{ market: 'national', names: ['NBC', 'Peacock'] }],
      }],
    }, {
      // A regular-season game.
      id: 'b2', date: iso(NOW + 2 * H), season: { type: 2, slug: 'regular-season' },
      status: { type: { state: 'pre', shortDetail: '2:05 PM' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'New York Yankees', shortDisplayName: 'Yankees', abbreviation: 'NYY', location: 'New York' } },
          { homeAway: 'away', team: { displayName: 'Baltimore Orioles', shortDisplayName: 'Orioles', abbreviation: 'BAL', location: 'Baltimore' } },
        ],
        broadcasts: [{ market: 'national', names: ['FS1'] }],
      }],
    }],
  },
};
const EVENT_BOARDS = ['racing/f1', 'racing/nascar-premier', 'racing/irl', 'golf/pga', 'golf/lpga', 'tennis/atp', 'tennis/wta'];

const asked: string[] = [];
const fetchMock = vi.fn(async (url: string) => {
  asked.push(url);
  const path = /\/sports\/(.+)\/scoreboard/.exec(url)?.[1] ?? '';
  return new Response(JSON.stringify(BOARDS[path] ?? { events: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

let handler: (req: Request) => Promise<Response> | Response;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('game-day');
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const call = async (body: Record<string, unknown>) => {
  const res = await handler(new Request('http://fn.test/game-day', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return await res.json() as { ok: boolean; games?: Array<Record<string, unknown>>; counts?: Record<string, number> };
};

describe('game-day', () => {
  it('lists races, golf and tennis as events, with their places, next to the team games', async () => {
    const out = await call({ op: 'list' });
    const by = Object.fromEntries((out.games ?? []).map((g) => [g.id, g]));
    // The race, not the practice or the finished qualifying.
    expect(Object.keys(by).filter((id) => id.startsWith('f1:'))).toEqual(['f1:e1:c4']);
    expect(by['f1:e1:c4']).toMatchObject({
      league: 'f1', name: 'Italian GP · Race', event: 'Italian GP', session: 'Race', state: 'pre',
      home: null, away: null, networks: ['ESPN'],
    });
    expect(by['f1:e1:c4'].places).toEqual(expect.arrayContaining(['Autodromo Nazionale Monza', 'Monza']));
    expect(by['pga:g1']).toMatchObject({ name: 'TOUR Championship', state: 'in', detail: 'Round 4 - In Progress', networks: ['Golf Channel', 'NBC'] });
    expect(by['pga:g1'].places).toEqual(expect.arrayContaining(['East Lake Golf Club', 'Atlanta']));
    expect(by['atp:t1']).toMatchObject({ name: 'Laver Cup', state: 'in', detail: '1 match on', networks: ['Tennis Channel'], start: iso(NOW - H) });
    expect(by['atp:t0']).toBeUndefined();
    expect(by['laliga:s1']).toMatchObject({ league: 'laliga', leagueLabel: 'La Liga', name: 'Real Madrid @ Barcelona' });
    // Live first.
    expect((out.games ?? []).slice(0, 2).map((g) => g.state)).toEqual(['in', 'in']);
  });

  it('asks the event leagues for their current events, the others by day', () => {
    for (const path of EVENT_BOARDS) {
      const urls = asked.filter((u) => u.includes(`/sports/${path}/scoreboard`));
      expect(urls.length, path).toBeGreaterThan(0);
      expect(urls.every((u) => !u.includes('dates=')), path).toBe(true);
    }
    const liga = asked.filter((u) => u.includes('/sports/soccer/esp.1/scoreboard'));
    expect(liga.length).toBeGreaterThanOrEqual(2);
    expect(liga.every((u) => u.includes('dates='))).toBe(true);
    // The host that answers the function's servers is asked first.
    expect(asked.every((u) => u.startsWith('https://site.web.api.espn.com/'))).toBe(true);
  });

  it('marks a playoff game, with its round; a regular-season game has neither', async () => {
    const out = await call({ op: 'list' });
    const by = Object.fromEntries((out.games ?? []).map((g) => [g.id, g]));
    expect(by['mlb:b1']).toMatchObject({ league: 'mlb', name: 'Red Sox @ White Sox', postseason: true, round: 'AL Wild Card - Game 1' });
    expect(by['mlb:b1'].networks).toEqual(expect.arrayContaining(['NBC']));
    expect(by['mlb:b2']).toMatchObject({ league: 'mlb', name: 'Orioles @ Yankees' });
    expect(by['mlb:b2']).not.toHaveProperty('postseason');
    expect(by['mlb:b2']).not.toHaveProperty('round');
  });

  it('lists national-team games (USA vs Chile, Czechia vs England) with their networks, TV games first', async () => {
    const out = await call({ op: 'list' });
    const by = Object.fromEntries((out.games ?? []).map((g) => [g.id, g]));
    expect(by['friendly:f1']).toMatchObject({
      league: 'friendly', leagueLabel: 'Friendly', name: 'Chile @ USA', state: 'pre', networks: ['TNT', 'truTV', 'Universo'],
      home: { name: 'United States', short: 'USA', abbr: 'USA' }, away: { name: 'Chile', abbr: 'CHI' },
    });
    expect(by['unl:n1']).toMatchObject({
      league: 'unl', leagueLabel: 'UEFA Nations League', name: 'England @ Czechia', networks: ['FS1', 'Fox One'],
      home: { abbr: 'CZE' }, away: { abbr: 'ENG' },
    });
    // The small game is listed too (by kickoff), while there is room.
    expect((out.games ?? []).filter((g) => g.league === 'friendly').map((g) => g.id)).toEqual(['friendly:f0', 'friendly:f1']);
  });

  it('keeps the televised games and the USA\'s when a window lists more than the cap', async () => {
    const out = await call({ op: 'list' });
    const women = (out.games ?? []).filter((g) => g.league === 'friendlyw').map((g) => g.id);
    expect(women).toHaveLength(24);
    expect(women).toContain('friendlyw:tv');
    expect(women).toContain('friendlyw:usa');
  });

  it('asks an international or cup competition once for the whole window, and drops a game long past its start', async () => {
    const friendly = asked.filter((u) => u.includes('/sports/soccer/fifa.friendly/scoreboard'));
    expect(friendly.length).toBeGreaterThan(0);
    expect(friendly.every((u) => u.includes('dates=20260927-20260928'))).toBe(true);
    const out = await call({ op: 'list' });
    const ids = (out.games ?? []).map((g) => g.id);
    expect(ids).toContain('facup:x2');
    expect(ids).not.toContain('facup:x1');
  });

  it('does not try the second ESPN host for a competition it has no scoreboard for (404)', async () => {
    const before = fetchMock.getMockImplementation();
    const seen: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      seen.push(url);
      return new Response('{}', { status: 404 });
    });
    vi.setSystemTime(NOW + 6 * 60_000); // past the 4-minute cache
    await call({ op: 'list' });
    fetchMock.mockImplementation(before!);
    expect(seen.filter((u) => u.includes('/sports/soccer/uefa.nations/scoreboard'))).toHaveLength(1);
    vi.setSystemTime(NOW);
  });

  it('counts every league in its check', async () => {
    const out = await call({ op: 'check' });
    expect(out.counts).toMatchObject({ f1: 1, nascar: 0, indycar: 0, pga: 1, lpga: 0, atp: 1, wta: 0, laliga: 1, seriea: 0, ufl: 0, mlb: 2, friendly: 2, unl: 1, facup: 1, wcq: 0, wc: 0 });
  });
});
