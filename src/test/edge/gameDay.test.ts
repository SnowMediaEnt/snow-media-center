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
  });

  it('counts every league in its check', async () => {
    const out = await call({ op: 'check' });
    expect(out.counts).toMatchObject({ f1: 1, nascar: 0, indycar: 0, pga: 1, lpga: 0, atp: 1, wta: 0, laliga: 1, seriea: 0, ufl: 0, mlb: 0 });
  });
});
