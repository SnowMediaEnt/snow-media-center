import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
const epg: Record<number, string> = {};
vi.mock('@/lib/xtream', () => ({
  getLiveCategories: vi.fn(), getLiveStreams: vi.fn(),
  getShortEpg: async (_l: unknown, id: number) => ({ epg_listings: epg[id] ? [{ title: epg[id] }] : [] }),
  pickNowNext: (l: Array<{ title: string }>) => ({ now: l[0] }),
}));

import type { Game, GameTeam, SportsChannel } from './gameDay';

const line = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p' } as never;
const team = (short: string, location: string, name: string): GameTeam => ({ short, location, name, abbr: '', logo: null, score: null });
const game = (over: Partial<Game>): Game => ({
  id: 'g', league: 'nfl', leagueLabel: 'NFL', name: '', start: '', state: 'pre', detail: '', home: null, away: null, networks: [], ...over,
});

let chans: (id: number, name: string, cat?: string) => SportsChannel;
beforeEach(async () => {
  const m = await import('./gameDay');
  m.__resetGameDayForTests();
  chans = (id, name, cat = '') => m.sportsChannel(line, { stream_id: id, name } as never, cat)!;
  for (const k of Object.keys(epg)) delete epg[Number(k)];
});

describe('gameDay', () => {
  it('puts the event channel first, then the networks, and ignores the city on its own', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({ home: team('Packers', 'Green Bay', 'Green Bay Packers'), away: team('Bears', 'Chicago', 'Chicago Bears'), networks: ['FOX', 'NFL Net', 'Peacock'] });
    const list = [
      chans(1, 'US| FOX 32 Chicago HD', 'US| LOCALS'),
      chans(2, 'NFL 03: Chicago Bears vs Green Bay Packers', 'NFL GAME PASS'),
      chans(3, 'US| NFL Network FHD', 'US| SPORTS'),
      chans(4, 'US| Chicago News', 'US| NEWS'),
      chans(5, 'US| Fox Sports 1', 'US| SPORTS'),
      chans(6, 'US| FOX 5 New York', 'US| LOCALS'),
    ];
    const got = channelsForGame(g, list);
    const ids = got.map((c) => c.stream.stream_id);
    expect(ids[0]).toBe(2);
    expect(got[0].via).toBe('game');
    expect(ids).toEqual(expect.arrayContaining([3, 1, 6]));
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(5);
    // The teams' own city's FOX station comes before another city's.
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(6));
  });

  it('finds ESPN wherever it sits, never a guess, and MLB.tv is not a channel', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({
      league: 'mlb', leagueLabel: 'MLB',
      home: team('Orioles', 'Baltimore', 'Baltimore Orioles'), away: team('Blue Jays', 'Toronto', 'Toronto Blue Jays'),
      networks: ['ESPN', 'MLB.tv'],
    });
    const list = [chans(10, 'USA | A&E', 'USA'), chans(11, 'USA | ESPN HD', 'USA')];
    const got = channelsForGame(g, list);
    expect(got.map((c) => c.stream.stream_id)).toEqual([11]);
    expect(got[0].via).toBe('network');
    // Only MLB.tv: nothing, rather than the first channel of the list.
    expect(channelsForGame({ ...g, networks: ['MLB.tv'] }, list)).toEqual([]);
  });

  it('lists the league and team channels, and the local and regional networks', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({
      league: 'mlb', leagueLabel: 'MLB',
      home: team('Yankees', 'New York', 'New York Yankees'), away: team('Red Sox', 'Boston', 'Boston Red Sox'),
      networks: [], locals: [{ name: 'YES', market: 'home' }, { name: 'NESN', market: 'away' }],
    });
    const list = [
      chans(20, 'MLB Zone', 'MLB ZONE'),
      chans(21, 'MLB: New York Yankees', 'MLB TEAMS'),
      chans(22, 'MLB: Boston Red Sox', 'MLB TEAMS'),
      chans(23, 'US| YES Network', 'US| SPORTS'),
      chans(24, 'US| NESN HD', 'US| SPORTS'),
      chans(25, 'NHL: New York Rangers', 'NHL TEAMS'),
    ];
    const got = channelsForGame(g, list);
    const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
    expect(by).toMatchObject({ 20: 'league', 21: 'team', 22: 'team', 23: 'local', 24: 'local' });
    // Another league's New York team is not this game's.
    expect(by[25]).toBeUndefined();
  });

  it("matches ESPN's short regional names and skips team apps", async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({
      league: 'mlb', leagueLabel: 'MLB',
      home: team('Phillies', 'Philadelphia', 'Philadelphia Phillies'), away: team('Brewers', 'Milwaukee', 'Milwaukee Brewers'),
      networks: ['MLB.TV'], locals: [{ name: 'Brewers.TV', market: 'away' }, { name: 'NBC Sports Phil', market: 'home' }, { name: 'MASN', market: 'home' }],
    });
    const list = [chans(50, 'US| NBC Sports Philadelphia HD', 'US| SPORTS'), chans(51, 'US| NBC Sports Boston', 'US| SPORTS'), chans(52, 'US| MASN HD', 'US| SPORTS'), chans(54, 'US| MASN 2', 'US| SPORTS'), chans(53, 'US| NBC', 'US| LOCALS')];
    const got = channelsForGame(g, list);
    expect(got.map((c) => c.stream.stream_id)).toEqual([50, 52]);
    expect(got.every((c) => c.via === 'local')).toBe(true);
  });

  it('a college team named after a place never picks a regional network on its own', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({
      league: 'ncaaf', leagueLabel: 'College Football',
      home: team('Florida', 'Florida', 'Florida Gators'), away: team('Tennessee', 'Tennessee', 'Tennessee Volunteers'),
      networks: ['ESPN'],
    });
    const list = [chans(30, 'US| FanDuel Sports Florida', 'US| SPORTS'), chans(31, 'US| ESPN FHD', 'US| SPORTS'), chans(32, 'CFB 04: Tennessee vs Florida', 'NCAAF')];
    const ids = channelsForGame(g, list).map((c) => c.stream.stream_id);
    expect(ids).toEqual([32, 31]);
  });

  it("reads a numbered league channel's guide to find the game", async () => {
    const { scanEventChannels } = await import('./gameDay');
    const g = game({ id: 'mlb:1', league: 'mlb', home: team('Orioles', 'Baltimore', 'Baltimore Orioles'), away: team('Blue Jays', 'Toronto', 'Toronto Blue Jays') });
    epg[40] = 'Toronto Blue Jays at Baltimore Orioles';
    epg[41] = 'Mets at Braves';
    const got = await scanEventChannels(g, [chans(40, 'MLB 01', 'MLB EXTRA INNINGS'), chans(41, 'MLB 02', 'MLB EXTRA INNINGS')]);
    expect(got.map((c) => c.stream.stream_id)).toEqual([40]);
    expect(got[0].note).toMatch(/Blue Jays/);
  });

  it('weighs categories: leagues and sports first, networks and US next, the rest never', async () => {
    const { categoryWeight } = await import('./gameDay');
    expect(categoryWeight('US| NFL SUNDAY TICKET')).toBe(2);
    expect(categoryWeight('MLB TEAMS')).toBe(2);
    expect(categoryWeight('PPV EVENTS')).toBe(2);
    expect(categoryWeight('US| LOCALS')).toBe(1);
    expect(categoryWeight('USA')).toBe(1);
    expect(categoryWeight('US| KIDS')).toBe(0);
  });

  it('labels kickoff times for today and tomorrow', async () => {
    const { kickoffLabel } = await import('./gameDay');
    const now = new Date(2026, 8, 27, 10, 0);
    expect(kickoffLabel(new Date(2026, 8, 27, 13, 0).toISOString(), now)).not.toMatch(/Tomorrow/);
    expect(kickoffLabel(new Date(2026, 8, 28, 13, 0).toISOString(), now)).toMatch(/^Tomorrow /);
  });
});
