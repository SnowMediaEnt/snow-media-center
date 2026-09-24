import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
/** Each channel's guide: listings as the panel gives them (text not encoded here). */
const epg: Record<number, Array<{ title: string; description?: string; start: number; end: number }>> = {};
vi.mock('@/lib/xtream', () => ({
  getLiveCategories: vi.fn(), getLiveStreams: vi.fn(),
  getShortEpg: vi.fn(async (_l: unknown, id: number) => ({
    epg_listings: (epg[id] ?? []).map((e) => ({ title: e.title, description: e.description ?? '', start: String(e.start), end: String(e.end) })),
  })),
  decodeEpgText: (s?: string) => s ?? '',
  parseEpgTime: (s?: string) => Number(s ?? 0),
}));

import type { Game, GameTeam, SportsChannel } from './gameDay';
import * as xtream from '@/lib/xtream';

const line = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p' } as never;
const team = (short: string, location: string, name: string, abbr = ''): GameTeam => ({ short, location, name, abbr, logo: null, score: null });
const game = (over: Partial<Game>): Game => ({
  id: 'g', league: 'nfl', leagueLabel: 'NFL', name: '', start: '', state: 'pre', detail: '', home: null, away: null, networks: [], ...over,
});
const YANKEES = team('Yankees', 'New York', 'New York Yankees', 'NYY');
const RED_SOX = team('Red Sox', 'Boston', 'Boston Red Sox', 'BOS');
const mlb = (over: Partial<Game> = {}): Game => game({ id: 'mlb:1', league: 'mlb', leagueLabel: 'MLB', name: 'Yankees @ Red Sox', home: RED_SOX, away: YANKEES, ...over });

let chans: (id: number, name: string, cat?: string) => SportsChannel;
beforeEach(async () => {
  const m = await import('./gameDay');
  m.__resetGameDayForTests();
  chans = (id, name, cat = '') => m.sportsChannel(line, { stream_id: id, name, category_id: cat ? cat.length : undefined } as never, cat)!;
  for (const k of Object.keys(epg)) delete epg[Number(k)];
  vi.mocked(xtream.getShortEpg).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove('native-low-memory');
});

const ids = (l: Array<{ stream: { stream_id: number } }>) => l.map((c) => c.stream.stream_id);

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
    const order = ids(got);
    expect(order[0]).toBe(2);
    expect(got[0].via).toBe('game');
    expect(order).toEqual(expect.arrayContaining([3, 1, 6]));
    expect(order).not.toContain(4);
    expect(order).not.toContain(5);
    // The teams' own city's FOX station comes before another city's.
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(6));
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
    expect(ids(got)).toEqual([11]);
    expect(got[0].via).toBe('network');
    // Only MLB.tv: nothing, rather than the first channel of the list.
    expect(channelsForGame({ ...g, networks: ['MLB.tv'] }, list)).toEqual([]);
  });

  it('lists the league and team channels, and the local and regional networks', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = mlb({ networks: [], locals: [{ name: 'YES', market: 'away' }, { name: 'NESN', market: 'home' }] });
    const list = [
      chans(20, 'MLB Zone', 'MLB ZONE'),
      chans(21, 'MLB: New York Yankees', 'MLB TEAMS'),
      chans(22, 'MLB: Boston Red Sox', 'MLB TEAMS'),
      chans(23, 'US| YES Network', 'US| SPORTS'),
      chans(24, 'US| NESN HD', 'US| SPORTS'),
      chans(25, 'NHL: New York Rangers', 'NHL TEAMS'),
      // A regional network named with its team is still the regional network.
      chans(26, 'US| NESN (Red Sox)', 'US| SPORTS'),
    ];
    const got = channelsForGame(g, list);
    const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
    expect(by).toMatchObject({ 20: 'league', 21: 'team', 22: 'team', 23: 'local', 24: 'local', 26: 'local' });
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
    expect(ids(got)).toEqual([50, 52]);
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
    expect(ids(channelsForGame(g, list))).toEqual([32, 31]);
  });

  describe("event channels: the day's name has the game", () => {
    it("PPV never has a league's game; an events category can, and a league's own PPV is the league's", async () => {
      const { channelsForGame } = await import('./gameDay');
      const got = channelsForGame(mlb(), [
        chans(60, 'PPV 12: Yankees vs Red Sox', 'PPV'),
        chans(61, 'EVENT 03: New York Yankees @ Boston Red Sox', 'US| LIVE EVENTS'),
        chans(62, 'PPV EVENT 04: Yankees vs Red Sox', 'PAY-PER-VIEW 2'),
      ]);
      expect(ids(got)).toEqual([61]);
      expect(got[0]).toMatchObject({ via: 'game', score: 100 });
      const nhl = game({ league: 'nhl', leagueLabel: 'NHL', home: team('Bruins', 'Boston', 'Boston Bruins', 'BOS'), away: team('Rangers', 'New York', 'New York Rangers', 'NYR') });
      expect(ids(channelsForGame(nhl, [chans(63, 'NHL PPV 03: Rangers vs Bruins', 'NHL PPV')]))).toEqual([63]);
    });

    it('reads what is in brackets, and "West" is part of a name there', async () => {
      const { channelsForGame } = await import('./gameDay');
      expect(ids(channelsForGame(mlb(), [chans(63, 'MLB 07 [Yankees vs Red Sox]', 'MLB ZONE'), chans(64, 'MLB 08 (Mets vs Braves)', 'MLB ZONE')]))).toEqual([63]);
      const epl = game({ league: 'epl', leagueLabel: 'Premier League', home: team('West Ham', 'West Ham United', 'West Ham United'), away: team('Chelsea', 'Chelsea', 'Chelsea') });
      expect(ids(channelsForGame(epl, [chans(65, 'EPL 05: West Ham vs Chelsea', 'UK| EPL')]))).toEqual([65]);
    });

    it("short codes and nicknames count on the league's own channels only", async () => {
      const { channelsForGame } = await import('./gameDay');
      expect(ids(channelsForGame(mlb(), [
        chans(70, 'MLB 07: NYY @ BOS 7:05PM', 'MLB ZONE'),
        // No league: "NYY @ BOS" could be anything there.
        chans(71, 'EVENT 03: NYY @ BOS', 'SPORTS EVENTS'),
        // Another league's Boston.
        chans(72, 'NHL 03: BOS vs TOR', 'NHL'),
      ]))).toEqual([70]);
      const nba = game({ league: 'nba', leagueLabel: 'NBA', home: team('Celtics', 'Boston', 'Boston Celtics', 'BOS'), away: team('76ers', 'Philadelphia', 'Philadelphia 76ers', 'PHI') });
      expect(ids(channelsForGame(nba, [chans(73, 'NBA 03: Sixers vs Celtics', 'NBA LEAGUE PASS')]))).toEqual([73]);
    });

    it("the cities alone do on a channel of the league; a city both teams share doesn't", async () => {
      const { channelsForGame } = await import('./gameDay');
      const got = channelsForGame(mlb(), [chans(80, 'MLB 07: New York vs Boston', 'MLB ZONE'), chans(81, 'US| New York vs Boston', 'US| SPORTS')]);
      expect(got.map((c) => [c.stream.stream_id, c.score])).toEqual([[80, 90]]);
      const subway = mlb({ home: team('Mets', 'New York', 'New York Mets', 'NYM') });
      const by = Object.fromEntries(channelsForGame(subway, [chans(82, 'MLB Teams: New York Yankees', 'MLB TEAMS'), chans(83, 'MLB 04: Yankees vs Mets', 'MLB ZONE')]).map((c) => [c.stream.stream_id, c.via]));
      expect(by).toEqual({ 82: 'team', 83: 'game' });
    });

    it("a name for another day is not today's game; today's, either way round, is", async () => {
      const { channelsForGame } = await import('./gameDay');
      // 7:05 PM Eastern on Sep 24: a UK line-up writes the 25th.
      const g = mlb({ start: '2026-09-24T23:05:00Z' });
      const got = channelsForGame(g, [
        chans(90, 'MLB 07: Yankees vs Red Sox 09/23', 'MLB ZONE'),
        chans(91, 'MLB 08: Yankees vs Red Sox 09/24', 'MLB ZONE'),
        chans(92, 'MLB 09: Yankees vs Red Sox 24/09', 'MLB ZONE'),
        chans(93, 'MLB 10: Yankees v Red Sox 25/09 00:05 UK', 'MLB ZONE'),
        chans(94, 'MLB 11: Yankees vs Red Sox Sep 23', 'MLB ZONE'),
        chans(95, 'MLB 12: Yankees vs Red Sox 24/7', 'MLB ZONE'),
      ]);
      expect(ids(got).sort()).toEqual([91, 92, 93, 95]);
      expect(got.every((c) => c.via === 'game')).toBe(true);
    });

    it('the kickoff time in the name picks the right game of a doubleheader', async () => {
      const { channelsForGame } = await import('./gameDay');
      const list = [chans(100, 'MLB 07: Yankees vs Red Sox 1:05 PM ET', 'MLB ZONE'), chans(101, 'MLB 08: Yankees vs Red Sox (6:35PM ET)', 'MLB ZONE')];
      const first = channelsForGame(mlb({ id: 'mlb:dh1', start: '2026-09-24T17:05:00Z' }), list);
      const second = channelsForGame(mlb({ id: 'mlb:dh2', start: '2026-09-24T22:35:00Z' }), list);
      expect(first.map((c) => [c.stream.stream_id, c.score])).toEqual([[100, 100], [101, 88]]);
      expect(second.map((c) => [c.stream.stream_id, c.score])).toEqual([[101, 100], [100, 88]]);
    });

    it('a fight card by its number or its headliners, wherever the PPV channel sits', async () => {
      const { channelsForGame, leagueCategories } = await import('./gameDay');
      const card = game({ id: 'ufc:1', league: 'ufc', leagueLabel: 'UFC', name: 'UFC 320: Ankalaev vs. Pereira 2', networks: ['ESPN+ PPV'] });
      const list = [
        chans(110, 'PPV 01: UFC 320 Main Card', 'PPV EVENTS'),
        chans(111, 'PPV 02: Pereira vs Ankalaev', 'PPV EVENTS'),
        chans(112, 'PPV 03: Canelo vs Crawford', 'PPV EVENTS'),
      ];
      expect(ids(channelsForGame(card, list))).toEqual([110, 111]);
      expect(leagueCategories(card, list).map((c) => c.name)).toEqual(['PPV EVENTS']);
    });

    it('"Football" is soccer for a soccer game unless it names the NFL', async () => {
      const { channelsForGame } = await import('./gameDay');
      const epl = game({ league: 'epl', leagueLabel: 'Premier League', home: team('Arsenal', 'Arsenal', 'Arsenal'), away: team('Chelsea', 'Chelsea', 'Chelsea') });
      expect(ids(channelsForGame(epl, [chans(120, 'Football 05: Arsenal vs Chelsea', 'UK| FOOTBALL'), chans(121, 'NFL 05: Arsenal vs Chelsea', 'US| NFL')]))).toEqual([120]);
      const liga = game({ league: 'laliga', leagueLabel: 'La Liga', home: team('Barcelona', 'Barcelona', 'Barcelona', 'BAR'), away: team('Real Madrid', 'Real Madrid', 'Real Madrid', 'RMA') });
      expect(ids(channelsForGame(liga, [
        chans(122, 'LA LIGA 02: Real Madrid vs Barcelona', 'ES| LA LIGA'),
        chans(123, 'Football 07: Real Madrid v Barcelona', 'UK| FOOTBALL'),
        chans(124, 'SOCCER 03: RMA vs BAR', 'US| SOCCER'),
      ]))).toEqual([122, 123, 124]);
    });
  });

  describe('events without teams: races, golf, tennis', () => {
    const f1 = (over: Partial<Game> = {}) => game({
      id: 'f1:1:race', league: 'f1', leagueLabel: 'F1', name: 'Italian GP · Race', event: 'Italian GP', session: 'Race',
      places: ['Autodromo Nazionale Monza', 'Monza'], networks: ['ESPN'], ...over,
    });

    it('a race by its name or its circuit, on a channel of the sport, never the other session', async () => {
      const { channelsForGame } = await import('./gameDay');
      const got = channelsForGame(f1(), [
        chans(300, 'F1: Italian Grand Prix', 'US| RACING'),
        chans(301, 'RACING 02: Formula 1 Monza (Race)', 'RACING EVENTS'),
        chans(302, 'F1: Italian GP Qualifying', 'US| RACING'),
        chans(303, 'NASCAR Cup: Kansas', 'US| RACING'),
        chans(304, 'US| Italian Food Network', 'US| ENTERTAINMENT'),
        chans(305, 'UK| Sky Sports F1 HD', 'UK| SPORTS'),
        chans(306, 'US| ESPN HD', 'US| SPORTS'),
      ]);
      const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
      expect(by).toEqual({ 300: 'game', 301: 'game', 305: 'league', 306: 'network' });
    });

    it('NASCAR by its track, golf and tennis by their tournament', async () => {
      const { channelsForGame } = await import('./gameDay');
      const nascar = game({ id: 'nascar:1', league: 'nascar', name: 'Hollywood Casino 400 · Race', event: 'Hollywood Casino 400', session: 'Race', places: ['Kansas Speedway', 'Kansas City'] });
      expect(ids(channelsForGame(nascar, [chans(310, 'NASCAR Cup Series: Kansas', 'US| RACING'), chans(311, 'NASCAR Cup Series: Talladega', 'US| RACING')]))).toEqual([310]);
      const golf = game({ id: 'pga:1', league: 'pga', name: 'TOUR Championship', event: 'TOUR Championship', places: ['East Lake Golf Club'] });
      expect(ids(channelsForGame(golf, [chans(320, 'PGA TOUR: TOUR Championship Rd 3', 'US| GOLF'), chans(321, 'PGA TOUR: Shriners Open', 'US| GOLF')]))).toEqual([320]);
      const tennis = game({ id: 'atp:1', league: 'atp', name: 'US Open', event: 'US Open', places: ['USTA Billie Jean King National Tennis Center'] });
      expect(ids(channelsForGame(tennis, [chans(330, 'Tennis: US Open Court 5', 'US| TENNIS'), chans(331, 'US| Open House', 'US| ENTERTAINMENT')]))).toEqual([330]);
    });

    it("the guide's listing for another session is not this one", async () => {
      const { checkGuides } = await import('./gameDay');
      const now = Date.parse('2026-09-27T12:00:00Z');
      const g = f1({ start: new Date(now + 60 * 60_000).toISOString() });
      const at = now + 55 * 60_000;
      epg[340] = [{ title: 'Formula 1 Racing', description: 'Italian Grand Prix. From Monza.', start: at, end: at + 2 * 60 * 60_000 }];
      epg[341] = [{ title: 'F1 Qualifying: Italian Grand Prix', description: '', start: at, end: at + 60 * 60_000 }];
      const list = [chans(340, 'RACING 01', 'US| RACING'), chans(341, 'RACING 02', 'US| RACING')];
      const got = await checkGuides(g, list, [], [g], now);
      expect(got.map((c) => [c.stream.stream_id, c.via, c.score])).toEqual([[340, 'game', 95]]);
    });
  });

  describe("PPV events, from the channels' own names", () => {
    // Friday Sep 18, 2026, 4 PM Eastern.
    const now = Date.parse('2026-09-18T20:00:00Z');

    it('reads the event and when it starts', async () => {
      const { ppvEvent } = await import('./gameDay');
      expect(ppvEvent('PPV EVENT 02: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)', now)).toEqual({ title: 'STSS Fonda 200 at Fonda', start: Date.parse('2026-09-18T22:00:00Z') });
      expect(ppvEvent('PPV EVENT 01: PDRA Brian Olson Memorial World Finals (9.18 8:55 AM ET)', now)).toEqual({ title: 'PDRA Brian Olson Memorial World Finals', start: Date.parse('2026-09-18T12:55:00Z') });
      expect(ppvEvent('PPV EVENT 13: RAF 13 Covington vs. Muhammad (9.18 9:00 PM ET)', now)?.title).toBe('RAF 13 Covington vs. Muhammad');
      expect(ppvEvent('US| PPV 3 - Canelo vs Crawford 9/13 8:00 PM ET', now)).toEqual({ title: 'Canelo vs Crawford', start: Date.parse('2026-09-14T00:00:00Z') });
      // A time alone is today's.
      expect(ppvEvent('PAY-PER-VIEW 7: Cotton Pickin 100 Prelim Night @ 7:30 PM', now)).toEqual({ title: 'Cotton Pickin 100 Prelim Night', start: Date.parse('2026-09-18T23:30:00Z') });
      expect(ppvEvent('PPV EVENT 15', now)).toBeNull();
      expect(ppvEvent('PPV EVENT 16: No Event', now)).toBeNull();
      expect(ppvEvent('PPV EVENT 17: Rolling Loud Festival', now)).toEqual({ title: 'Rolling Loud Festival', start: null });
    });

    it("lists today's and tonight's once per event, not old ones or a card the scoreboard has", async () => {
      const { channelKey, isPpvFight, ppvGames, sportsChannel } = await import('./gameDay');
      const other = { host: 'http://other.xyz', username: 'u', password: 'p' } as never;
      const list = [
        chans(400, 'PPV EVENT 02: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)', 'PAY-PER-VIEW 2'),
        chans(401, 'PPV EVENT 13: RAF 13 Covington vs. Muhammad (9.18 9:00 PM ET)', 'PAY-PER-VIEW 2'),
        chans(402, 'PPV EVENT 01: Last Week Finals (9.11 8:00 PM ET)', 'PAY-PER-VIEW 1'),
        chans(403, 'PPV EVENT 09: UFC 320 Ankalaev vs Pereira (9.18 10:00 PM ET)', 'PAY-PER-VIEW 3'),
        chans(404, 'PPV EVENT 05', 'PAY-PER-VIEW 1'),
        chans(405, 'MLB 07: Yankees vs Red Sox (9.18 7:05 PM ET)', 'MLB ZONE'),
        sportsChannel(other, { stream_id: 406, name: 'PPV 2: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)' } as never, 'PPV')!,
      ];
      const got = ppvGames(list, new Set([channelKey(list[3])]), now);
      expect(got.map((p) => [p.game.name, ids(p.links)])).toEqual([
        ['STSS Fonda 200 at Fonda', [400, 406]],
        ['RAF 13 Covington vs. Muhammad', [401]],
      ]);
      expect(got.map((p) => isPpvFight(p.game))).toEqual([false, true]);
      expect(got[0].game).toMatchObject({ league: 'ppv', leagueLabel: 'PPV', state: 'pre', start: '2026-09-18T22:00:00.000Z' });
    });

    it('a UFC card the scoreboard has keeps its PPV channel; the list leaves it out', async () => {
      const { cardChannels, channelsForGame } = await import('./gameDay');
      const card = game({ id: 'ufc:1', league: 'ufc', leagueLabel: 'UFC', name: 'UFC 320: Ankalaev vs. Pereira 2', start: new Date(now + 6 * 60 * 60_000).toISOString() });
      const list = [chans(410, 'PPV EVENT 09: UFC 320 Ankalaev vs Pereira (9.18 10:00 PM ET)', 'PAY-PER-VIEW 3')];
      expect(ids(channelsForGame(card, list))).toEqual([410]);
      expect([...cardChannels([card], list)]).toHaveLength(1);
    });
  });

  it('reads dates and times written in a channel name', async () => {
    const { nameDates, nameTimes } = await import('./gameDay');
    expect(nameDates('MLB 07: Yankees vs Red Sox 09/24')).toEqual([924]);
    expect(nameDates('Yankees vs Red Sox 2026-09-24')).toEqual([924]);
    expect(nameDates('Thu 25th Sep')).toEqual([925]);
    expect(nameDates('Yankees vs Red Sox 24/7')).toEqual([]);
    expect(nameDates('Mets vs Marlins 7:10 PM')).toEqual([]);
    expect(nameDates('PPV EVENT 02: STSS Fonda 200 at Fonda (9.18 6:00 PM ET)')).toEqual([918]);
    expect(nameDates('Bears vs Packers Dolby 5.1')).toEqual([]);
    expect(nameDates('Fight Night 7.05pm')).toEqual([]);
    expect(nameTimes('Yankees vs Red Sox 7:05 PM ET')).toEqual([{ mins: [1145], zone: 'America/New_York' }]);
    expect(nameTimes('Yankees vs Red Sox 19:05')).toEqual([{ mins: [1145], zone: undefined }]);
    expect(nameTimes('Yankees vs Red Sox 7pm')).toEqual([{ mins: [1140], zone: undefined }]);
    expect(nameTimes('MLB 07: Yankees vs Red Sox')).toEqual([]);
  });

  describe('checkGuides', () => {
    const now = Date.parse('2026-09-24T22:00:00Z');
    const kick = now + 60 * 60_000;
    const on = (title: string, description = '') => [{ title, description, start: kick - 5 * 60_000, end: kick + 3 * 60 * 60_000 }];
    const rays = game({ id: 'mlb:2', league: 'mlb', name: 'Rays @ Orioles', home: team('Orioles', 'Baltimore', 'Baltimore Orioles'), away: team('Rays', 'Tampa Bay', 'Tampa Bay Rays') });
    const channels = () => [
      chans(1, 'US| FOX 5 New York', 'US| LOCALS'),
      chans(2, 'US| FOX 25 Boston', 'US| LOCALS'),
      chans(3, 'US| YES Network', 'US| SPORTS'),
      chans(4, 'US| WPIX 11 New York', 'US| LOCALS'),
      chans(5, 'MLB 07', 'MLB ZONE'),
    ];

    it("confirms the networks with the game at kickoff, flags one with another game, and finds the city's local that has it", async () => {
      const { channelsForGame, checkGuides } = await import('./gameDay');
      const g = mlb({ start: new Date(kick).toISOString(), networks: ['FOX'], locals: [{ name: 'YES', market: 'away' }] });
      const list = [...channels(), chans(6, 'MLB 08: Yankees vs Red Sox', 'MLB ZONE')];
      epg[1] = on('MLB Baseball', 'New York Yankees at Boston Red Sox. From Fenway Park.');
      epg[2] = on('MLB Baseball', 'Tampa Bay Rays at Baltimore Orioles.');
      epg[4] = on('Yankees at Red Sox');
      epg[5] = on('Yankees at Red Sox');
      const found = channelsForGame(g, list);
      const got = await checkGuides(g, list, found, [g, rays], now);
      const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c]));
      expect(by[1]).toMatchObject({ score: 95, via: 'network' });
      expect(by[1].note).toBe('Guide: MLB Baseball — New York Yankees at Boston Red Sox. From Fenway Park.');
      expect(by[2]).toMatchObject({ score: 20, via: 'network', note: 'Guide: another game — Rays @ Orioles' });
      expect(by[4]).toMatchObject({ score: 95, via: 'local', note: 'Guide: Yankees at Red Sox' });
      // A numbered league channel's guide counts too, even with a channel
      // named for the game: both are read.
      expect(by[5]).toMatchObject({ score: 95, via: 'game' });
      // No guide for YES: it stays as it was. The channel named for the game
      // needs no guide.
      expect(by[3]).toBeUndefined();
      expect(vi.mocked(xtream.getShortEpg).mock.calls.map((c) => c[1])).not.toContain(6);
    });

    it('hands over what it has after each few lookups', async () => {
      const { checkGuides } = await import('./gameDay');
      const g = mlb({ start: new Date(kick).toISOString() });
      const list = Array.from({ length: 6 }, (_, i) => chans(200 + i, `MLB ${String(i + 1).padStart(2, '0')}`, 'MLB ZONE'));
      epg[200] = on('Yankees at Red Sox');
      epg[205] = on('Yankees at Red Sox');
      const partial: number[][] = [];
      const got = await checkGuides(g, list, [], [g], now, (links) => partial.push(ids(links)));
      expect(partial).toEqual([[200]]);
      expect(ids(got)).toEqual([200, 205]);
    });

    it("reads the numbered league channels' guide when no channel is named for the game", async () => {
      const { channelsForGame, checkGuides } = await import('./gameDay');
      const g = mlb({ start: new Date(kick).toISOString() });
      epg[5] = on('New York Yankees at Boston Red Sox');
      const list = channels();
      const got = await checkGuides(g, list, channelsForGame(g, list), [g], now);
      expect(got.map((c) => [c.stream.stream_id, c.via, c.score])).toEqual([[5, 'game', 95]]);
    });

    it('does not look for a game further off than the guide reaches', async () => {
      const { checkGuides } = await import('./gameDay');
      const g = mlb({ start: new Date(now + 20 * 60 * 60_000).toISOString() });
      expect(await checkGuides(g, channels(), [], [g], now)).toEqual([]);
      expect(xtream.getShortEpg).not.toHaveBeenCalled();
    });
  });

  it('weighs categories: leagues first, then sports and events, networks and US next, the rest never', async () => {
    const { categoryWeight } = await import('./gameDay');
    expect(categoryWeight('US| NFL SUNDAY TICKET')).toBe(3);
    expect(categoryWeight('MLB TEAMS')).toBe(3);
    expect(categoryWeight('NBA ZONE')).toBe(3);
    expect(categoryWeight('NHL PPV')).toBe(3);
    expect(categoryWeight('US| RACING')).toBe(3);
    expect(categoryWeight('GOLF')).toBe(3);
    expect(categoryWeight('LA LIGA')).toBe(3);
    expect(categoryWeight('PPV EVENTS')).toBe(2);
    expect(categoryWeight('US| SPORTS')).toBe(2);
    expect(categoryWeight('US| LOCALS')).toBe(1);
    expect(categoryWeight('USA')).toBe(1);
    expect(categoryWeight('US| KIDS')).toBe(0);
  });

  it('asks for channel lists at most ten minutes old, and again after that', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { CHANNELS_TTL_MS, loadSportsChannels } = await import('./gameDay');
    vi.mocked(xtream.getLiveCategories).mockResolvedValue([{ category_id: '1', category_name: 'MLB ZONE' }] as never);
    const streams = vi.mocked(xtream.getLiveStreams);
    streams.mockReset();
    streams.mockResolvedValueOnce([{ stream_id: 1, name: 'MLB 07: Mets vs Braves', category_id: '1' }] as never);
    streams.mockResolvedValueOnce([{ stream_id: 1, name: 'MLB 07: Yankees vs Red Sox', category_id: '1' }] as never);
    expect((await loadSportsChannels([line])).map((c) => c.stream.name)).toEqual(['MLB 07: Mets vs Braves']);
    expect(streams).toHaveBeenLastCalledWith(line, undefined, { maxAgeMs: CHANNELS_TTL_MS });
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await loadSportsChannels([line]);
    expect(streams).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await loadSportsChannels([line])).map((c) => c.stream.name)).toEqual(['MLB 07: Yankees vs Red Sox']);
    expect(streams).toHaveBeenCalledTimes(2);
  });

  it("on a box short of memory reads the leagues' categories first", async () => {
    document.documentElement.classList.add('native-low-memory');
    const { loadSportsChannels } = await import('./gameDay');
    const cats = [
      ...Array.from({ length: 30 }, (_, i) => ({ category_id: `s${i}`, category_name: `US| SPORTS ${i}` })),
      { category_id: 'mlb', category_name: 'MLB ZONE' },
    ];
    vi.mocked(xtream.getLiveCategories).mockResolvedValue(cats as never);
    const streams = vi.mocked(xtream.getLiveStreams);
    streams.mockReset();
    streams.mockResolvedValue([] as never);
    await loadSportsChannels([line]);
    expect(streams.mock.calls[0][1]).toBe('mlb');
    expect(streams).toHaveBeenCalledTimes(24);
  });

  it('labels kickoff times for today and tomorrow', async () => {
    const { kickoffLabel } = await import('./gameDay');
    const now = new Date(2026, 8, 27, 10, 0);
    expect(kickoffLabel(new Date(2026, 8, 27, 13, 0).toISOString(), now)).not.toMatch(/Tomorrow/);
    expect(kickoffLabel(new Date(2026, 8, 28, 13, 0).toISOString(), now)).toMatch(/^Tomorrow /);
  });
});
