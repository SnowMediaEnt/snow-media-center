// Game Day's deterministic matcher: conference and service families (B1G+,
// SEC+, ACCNX, UEFA, Flo …), a matchup's two sides, the teams' aliases and
// ranks, the "Michigan" inside "Michigan State" guard, folded accents — and
// the line-up search's helpers (scanCandidates, lineupHash, aiLinks).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
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
const other = { host: 'https://strmz.xyz', username: 'v', password: 'q' } as never;
const team = (short: string, location: string, name: string, abbr = '', rank?: number): GameTeam =>
  ({ short, location, name, abbr, logo: null, score: null, ...(rank ? { rank } : {}) });
const game = (over: Partial<Game>): Game => ({
  id: 'g', league: 'ncaah', leagueLabel: 'College Hockey', name: '', start: '', state: 'pre', detail: '', home: null, away: null, networks: [], ...over,
});
// ESPN's college forms (location, short, name, abbr).
const BU = (rank?: number) => team('Boston U', 'Boston University', 'Boston University Terriers', 'BU', rank);
const BC = (rank?: number) => team('Boston College', 'Boston College', 'Boston College Eagles', 'BC', rank);
const MICH = team('Michigan', 'Michigan', 'Michigan Wolverines', 'MICH');
const MSU = team('Michigan State', 'Michigan State', 'Michigan State Spartans', 'MSU');
const hockey = (away: GameTeam, over: Partial<Game> = {}): Game =>
  game({ id: 'ncaah:401', name: `${away.short} @ Michigan`, home: MICH, away, ...over });

let chans: (id: number, name: string, cat?: string, l?: unknown) => SportsChannel;
beforeEach(async () => {
  const m = await import('./gameDay');
  m.__resetGameDayForTests();
  chans = (id, name, cat = '', l = line) => m.sportsChannel(l as never, { stream_id: id, name, category_id: cat ? cat.length : undefined } as never, cat)!;
  for (const k of Object.keys(epg)) delete epg[Number(k)];
  vi.mocked(xtream.getShortEpg).mockClear();
});
afterEach(() => {
  document.documentElement.classList.remove('native-low-memory');
});

const ids = (l: Array<{ stream: { stream_id: number } }>) => l.map((c) => c.stream.stream_id);
const found = async (g: Game, list: SportsChannel[]) => {
  const { channelsForGame } = await import('./gameDay');
  return Object.fromEntries(channelsForGame(g, list).map((c) => [c.stream.stream_id, [c.via, c.score]]));
};

describe('the owner\'s report: "#11 Boston vs Michigan" in B1G+', () => {
  it('splits the name into its sides once, with the rank apart, and ties B1G+ / BIG10+ to the college leagues', () => {
    for (const cat of ['B1G+', 'BIG10+', 'US| BIG 10+', 'BIG TEN+']) {
      const c = chans(1, '#11 Boston vs Michigan', cat);
      expect(c.sides, cat).toEqual([' boston ', ' michigan ']);
      expect(c.ranks, cat).toEqual([11, 0]);
      expect(c.fam, cat).toEqual(['b1g']);
      expect(c.leagues, cat).toEqual(expect.arrayContaining(['ncaah', 'ncaab', 'wncaab', 'ncaaf']));
    }
  });

  it('is found as the game, score 100, for BU (ranked 11) — on B1G+ and on BIG10+', async () => {
    for (const cat of ['B1G+', 'BIG10+']) {
      expect(await found(hockey(BU(11)), [chans(1, '#11 Boston vs Michigan', cat)]), cat).toEqual({ 1: ['game', 100] });
    }
  });

  it('is found for Boston College too, ranked 11 or with no rank known', async () => {
    expect(await found(hockey(BC(11)), [chans(1, '#11 Boston vs Michigan', 'B1G+')])).toEqual({ 1: ['game', 100] });
    expect(await found(hockey(BC()), [chans(1, '#11 Boston vs Michigan', 'BIG10+')])).toEqual({ 1: ['game', 100] });
  });

  it('is loaded from the whole line-up, and on a box short of memory B1G+ is read first', async () => {
    const { categoryWeight, channelsForGame, loadSportsChannels, __resetGameDayForTests } = await import('./gameDay');
    expect(categoryWeight('B1G+')).toBe(3);
    expect(categoryWeight('BIG10+')).toBe(3);
    vi.mocked(xtream.getLiveCategories).mockReset();
    vi.mocked(xtream.getLiveCategories).mockResolvedValue([
      ...Array.from({ length: 30 }, (_, i) => ({ category_id: `s${i}`, category_name: `US| SPORTS ${i}` })),
      { category_id: 'b1g', category_name: 'B1G+' },
    ] as never);
    const streams = vi.mocked(xtream.getLiveStreams);
    streams.mockReset();
    streams.mockImplementation((async (_l: unknown, cat?: string) => (cat === undefined || cat === 'b1g'
      ? [{ stream_id: 1, name: '#11 Boston vs Michigan', category_id: 'b1g' }]
      : [])) as never);
    const whole = await loadSportsChannels([line]);
    expect(ids(channelsForGame(hockey(BU(11)), whole))).toEqual([1]);

    __resetGameDayForTests();
    document.documentElement.classList.add('native-low-memory');
    streams.mockClear();
    const low = await loadSportsChannels([line]);
    expect(streams.mock.calls[0][1]).toBe('b1g');
    expect(ids(channelsForGame(hockey(BU(11)), low))).toEqual([1]);
  });

  it('keeps a matchup from the whole line-up whatever its category, but never a kids one', async () => {
    const { loadSportsChannels } = await import('./gameDay');
    vi.mocked(xtream.getLiveCategories).mockReset();
    vi.mocked(xtream.getLiveCategories).mockResolvedValue([
      { category_id: '1', category_name: 'DS EXTRA' }, { category_id: '2', category_name: 'KIDS' },
    ] as never);
    const streams = vi.mocked(xtream.getLiveStreams);
    streams.mockReset();
    streams.mockResolvedValue([
      { stream_id: 1, name: '#11 Boston vs Michigan', category_id: '1' },
      { stream_id: 2, name: 'Tom vs Jerry', category_id: '2' },
      { stream_id: 3, name: 'Cooking Channel', category_id: '1' },
    ] as never);
    expect(ids(await loadSportsChannels([line]))).toEqual([1]);
  });
});

describe("a matchup's sides: codes, mascots, ranks and the other schools", () => {
  it('"ESPN+ 07: BU vs MICH" on ESPN+: the codes count on a feed of the game\'s services', async () => {
    expect(await found(hockey(BU()), [chans(1, 'ESPN+ 07: BU vs MICH', 'ESPN+')])).toEqual({ 1: ['game', 100] });
    // The same codes on a channel that is nothing of the game's: not enough.
    expect(await found(hockey(BU()), [chans(2, 'EVENT 03: BU vs MICH', 'SPORTS EVENTS')])).toEqual({});
  });

  it('"Terriers vs Wolverines" in B1G+ by the mascots; mascots alone elsewhere are not enough', async () => {
    expect(await found(hockey(BU()), [chans(1, 'Terriers vs Wolverines', 'B1G+')])).toEqual({ 1: ['game', 100] });
    expect(await found(hockey(BU()), [chans(2, 'Terriers vs Wolverines', 'US| SPORTS')])).toEqual({});
    // A mascot next to the other school's name is.
    expect(await found(hockey(BU()), [chans(3, 'Terriers vs Michigan', 'US| SPORTS')])).toEqual({ 3: ['game', 100] });
  });

  it('"Michigan State vs Boston University" is not the Michigan game', async () => {
    expect(await found(hockey(BU()), [
      chans(1, 'Michigan State vs Boston University', 'B1G+'),
      chans(2, 'B1G+ 04: Boston University @ Michigan St.', 'B1G+'),
    ])).toEqual({});
    // It is Michigan State's.
    const msu = game({ id: 'ncaah:402', home: MSU, away: BU() });
    expect(await found(msu, [chans(1, 'Michigan State vs Boston University', 'B1G+'), chans(2, 'B1G+ 04: Boston University @ Michigan St.', 'B1G+')]))
      .toEqual({ 1: ['game', 100], 2: ['game', 100] });
    // Boston University is not Boston College.
    expect(await found(hockey(BC()), [chans(3, 'Boston University vs Michigan', 'B1G+')])).toEqual({});
  });

  it('"#5 Boston vs Michigan" is not #11 BU\'s game', async () => {
    expect(await found(hockey(BU(11)), [chans(1, '#5 Boston vs Michigan', 'B1G+'), chans(2, '(11) Boston vs Michigan', 'B1G+')]))
      .toEqual({ 2: ['game', 100] });
  });

  it('a label before a ":" or "|", and a schedule after the matchup, are not a side', () => {
    const cases: Array<[string, [string, string]]> = [
      ['Live Event 05: Team A vs Team B 7:00 PM ET', [' team a ', ' team b ']],
      ['ESPN+ 07 | BU vs Michigan', [' bu ', ' michigan ']],
      ['MLB 07 [Yankees vs Red Sox]', [' yankees ', ' red sox ']],
      ['Paramount+ 04 | UCL | Inter v Barcelona', [' inter ', ' barcelona ']],
      ['MLB 10: Yankees v Red Sox 25/09 00:05 UK', [' yankees ', ' red sox ']],
      ['Czechia vs England | Peacock 02', [' czechia ', ' england ']],
      ['Miami (OH) vs Toledo (9.18 6:00 PM ET)', [' miami oh ', ' toledo ']],
      ['NCAA 03: No. 3 Duke at North Carolina', [' duke ', ' north carolina ']],
      ['Live Event 05: Flamengo - Palmeiras', [' flamengo ', ' palmeiras ']],
    ];
    for (const [name, sides] of cases) expect(chans(1, name, 'X').sides, name).toEqual(sides);
    for (const name of ['US| ESPN HD', 'US - CNN', 'MLB 07', 'PPV EVENT 15']) expect(chans(1, name, 'X').sides, name).toBeUndefined();
    expect(chans(1, 'NCAA 03: No. 3 Duke at North Carolina', 'X').ranks).toEqual([3, 0]);
  });

  it('"Live Event 05: … 7:00 PM ET" checks the time like any event channel', async () => {
    const nba = (start: string) => game({
      id: 'nba:1', league: 'nba', leagueLabel: 'NBA', start,
      home: team('Celtics', 'Boston', 'Boston Celtics', 'BOS'), away: team('Lakers', 'Los Angeles', 'Los Angeles Lakers', 'LAL'),
    });
    const list = [chans(1, 'Live Event 05: Lakers vs Celtics 7:00 PM ET', 'US| LIVE EVENTS')];
    expect(await found(nba('2026-10-02T23:00:00Z'), list)).toEqual({ 1: ['game', 100] });
    expect(await found(nba('2026-10-02T17:00:00Z'), list)).toEqual({ 1: ['game', 88] });
  });

  it('PPV is never a team game\'s, by names, cities or codes', async () => {
    const osu = team('Ohio State', 'Ohio State', 'Ohio State Buckeyes', 'OSU');
    const football = game({ id: 'ncaaf:1', league: 'ncaaf', leagueLabel: 'College Football', home: osu, away: MICH });
    expect(await found(football, [chans(1, 'PPV EVENT 12: Michigan vs Ohio State', 'PPV')])).toEqual({});
    expect(await found(hockey(BU(11)), [chans(2, 'PPV 3: Boston vs Michigan', 'PAY-PER-VIEW'), chans(3, 'PPV 4: Boston College vs Michigan', 'PPV')])).toEqual({});
  });
});

describe('families', () => {
  it('a conference network is every college sport\'s, not football\'s alone', async () => {
    const { leaguesIn } = await import('./gameDay');
    const uk = team('Kentucky', 'Kentucky', 'Kentucky Wildcats', 'UK');
    const tenn = team('Tennessee', 'Tennessee', 'Tennessee Volunteers', 'TENN');
    const hoops = game({ id: 'ncaab:1', league: 'ncaab', leagueLabel: 'College Basketball', home: tenn, away: uk, networks: ['SEC Network'] });
    expect(await found(hoops, [
      chans(1, 'SEC Network+ 03: Kentucky vs Tennessee', 'SEC+'),
      chans(2, 'US| SEC Network HD', 'US| SPORTS'),
      chans(3, 'Big Ten Network', 'US| SPORTS'),
    ])).toEqual({ 1: ['game', 100], 2: ['network', 70], 3: ['league', 30] });
    expect(leaguesIn('college football')).toEqual(['ncaaf', 'nfl', 'ufl']);
    expect(leaguesIn('acc network')).toEqual(expect.arrayContaining(['ncaaf', 'ncaab', 'wncaab', 'ncaah']));
  });

  it('"FloHockey 02: Boston College vs Northeastern" in FLOSPORTS', async () => {
    const { categoryWeight } = await import('./gameDay');
    expect(categoryWeight('FLOSPORTS')).toBe(3);
    const neu = team('Northeastern', 'Northeastern', 'Northeastern Huskies', 'NU');
    const g = game({ id: 'ncaah:3', home: neu, away: BC() });
    expect(await found(g, [chans(1, 'FloHockey 02: Boston College vs Northeastern', 'FLOSPORTS')])).toEqual({ 1: ['game', 100] });
  });

  it('weighs the families\' categories as leagues\', and the rest as before', async () => {
    const { categoryWeight } = await import('./gameDay');
    for (const cat of ['SEC+', 'ACCNX', 'PAC-12', 'NCAA', 'UEFA', 'US| BIG EAST', 'BIG 12']) expect(categoryWeight(cat), cat).toBe(3);
    expect(categoryWeight('US| MATCHDAY')).toBe(2);
    expect(categoryWeight('US| ENTERTAINMENT')).toBe(1);
  });

  it('a team named "College" makes no channel the NCAA\'s', () => {
    expect(chans(1, 'Boston College vs Maine', 'US| SPORTS').fam).toBeUndefined();
    expect(chans(2, 'NCAA 03: Boston College vs Maine', 'US| SPORTS').fam).toEqual(['ncaa']);
  });

  it('reads the numbered family feeds by their guide (B1G+ 03), within the services\' budget', async () => {
    const { checkGuides, gameServices } = await import('./gameDay');
    expect(gameServices(hockey(BU()))).toEqual(['b1gplus', 'secplus', 'accnx', 'flo', 'ncaa', 'espnplus']);
    expect(gameServices(game({ league: 'ucl', networks: ['CBS'] }))).toEqual(['paramount', 'uefa']);
    for (const [name, service] of [['B1G+ 03', 'b1gplus'], ['SEC+ 12', 'secplus'], ['ACCNX 05', 'accnx'], ['FLO 02', 'flo'], ['NCAA 07', 'ncaa'], ['UEFA 04', 'uefa']]) {
      expect(chans(1, name).service, name).toBe(service);
    }
    const now = Date.parse('2026-10-02T22:00:00Z');
    const kick = now + 60 * 60_000;
    epg[11] = [{ title: 'College Hockey', description: 'Boston University at Michigan.', start: kick - 5 * 60_000, end: kick + 3 * 60 * 60_000 }];
    const g = hockey(BU(), { start: new Date(kick).toISOString() });
    const got = await checkGuides(g, [chans(10, 'B1G+ 02', 'STREAMING'), chans(11, 'B1G+ 03', 'STREAMING')], [], [g], now);
    expect(got.map((c) => [c.stream.stream_id, c.via, c.guide])).toEqual([[11, 'game', 'yes']]);
  });
});

describe('UEFA and accents', () => {
  const ATM = team('Atlético Madrid', 'Atlético Madrid', 'Atlético Madrid', 'ATM');
  const FCB = team('Bayern Munich', 'Bayern Munich', 'Bayern Munich', 'MUN');
  const ucl = (home: GameTeam, away: GameTeam) => game({ id: 'ucl:1', league: 'ucl', leagueLabel: 'Champions League', home, away, networks: ['Paramount+'] });

  it('"Atletico Madrid v Bayern Munich" in UEFA is ESPN\'s "Atlético Madrid" vs "Bayern Munich"; München too', async () => {
    expect(await found(ucl(ATM, FCB), [
      chans(1, 'Atletico Madrid v Bayern Munich', 'UEFA'),
      chans(2, 'UEFA 03: Atlético Madrid vs Bayern München', 'UEFA'),
      chans(3, 'Atletico Madrid v Barcelona', 'UEFA'),
    ])).toEqual({ 1: ['game', 100], 2: ['game', 100] });
  });

  it('"Paramount+ 04 | UCL | Inter v Barcelona" is Internazionale\'s game', async () => {
    const inter = team('Internazionale', 'Internazionale', 'Internazionale', 'INT');
    const barca = team('Barcelona', 'Barcelona', 'Barcelona', 'BAR');
    expect(await found(ucl(barca, inter), [chans(1, 'Paramount+ 04 | UCL | Inter v Barcelona', 'US| PARAMOUNT+')])).toEqual({ 1: ['game', 100] });
    // "Inter" alone is not Internazionale on a channel of nothing of the game's.
    expect(await found(ucl(barca, inter), [chans(2, 'Inter Miami vs Toronto', 'US| SPORTS')])).toEqual({});
  });
});

describe('learned categories', () => {
  it("are read as the league's, on a box short of memory too", async () => {
    document.documentElement.classList.add('native-low-memory');
    const { channelsForGame, loadSportsChannels } = await import('./gameDay');
    vi.mocked(xtream.getLiveCategories).mockReset();
    vi.mocked(xtream.getLiveCategories).mockResolvedValue([{ category_id: '9', category_name: 'DS EXTRA 2' }] as never);
    const streams = vi.mocked(xtream.getLiveStreams);
    streams.mockReset();
    streams.mockResolvedValue([{ stream_id: 5, name: 'Boston vs Michigan', category_id: '9' }] as never);
    const learned = new Map([['DS EXTRA 2', ['ncaah']]]);
    expect(await loadSportsChannels([line])).toEqual([]);
    const got = await loadSportsChannels([line], learned);
    // Both cities on a channel of the league: the game.
    expect(channelsForGame(hockey(BC()), got).map((c) => [c.stream.stream_id, c.via])).toEqual([[5, 'game']]);
    // And when the list was loaded without them, channelsForGame takes them.
    const bare = [chans(6, 'BU vs MICH', 'DS EXTRA 2')];
    expect(channelsForGame(hockey(BU()), bare)).toEqual([]);
    expect(ids(channelsForGame(hockey(BU()), bare, 12, learned))).toEqual([6]);
  });

  it("match whatever form the key comes in: the box's normalised one, or the panel's own", async () => {
    const { channelsForGame, sportsChannel } = await import('./gameDay');
    // The category as the panel names it; the box sends it normalised.
    const raw = 'ÉVÉNEMENTS | Spécial:Extra_2';
    const list = [sportsChannel(line, { stream_id: 7, name: 'BU vs MICH' } as never, raw)!];
    for (const key of ['evenements special extra 2', raw, 'EVENEMENTS|SPECIAL:EXTRA_2']) {
      expect(ids(channelsForGame(hockey(BU()), list, 12, new Map([[key, ['ncaah']]]))), key).toEqual([7]);
    }
    expect(channelsForGame(hockey(BU()), list, 12, new Map([['evenements', ['ncaah']]]))).toEqual([]);
  });
});

describe('the line-up search', () => {
  it('scanCandidates: the event channels of one provider, matchups first, only id, name and category', async () => {
    const { scanCandidates } = await import('./gameDay');
    const list = [
      chans(1, 'US| ESPN HD', 'US| SPORTS'),
      chans(2, 'B1G+ 03', 'B1G+'),
      chans(3, '#11 Boston vs Michigan', 'B1G+'),
      chans(4, 'NETFLIX 24/7: Team A vs Team B', 'US| SPORTS'),
      chans(5, 'Tom vs Jerry', 'KIDS'),
      chans(6, 'PPV EVENT 12: Michigan vs Ohio State', 'PPV'),
      chans(7, 'Live Event 05', 'US| LIVE EVENTS'),
      chans(8, 'MLB 07', 'MLB ZONE'),
      chans(9, 'MLB Network', 'MLB'),
      chans(10, 'US| PEACOCK 02', 'US| PEACOCK'),
      chans(3, '#11 Boston vs Michigan', 'B1G+', line),
      chans(11, 'Yankees vs Red Sox', 'MLB', other),
    ];
    const got = scanCandidates(list, 'dstreams.xyz');
    // A PPV channel named for an event goes too (the search links it to a
    // fight card only, never a team game).
    expect(got.map((c) => c.id)).toEqual([3, 2, 6, 7, 8, 10]);
    expect(got[0]).toEqual({ id: 3, name: '#11 Boston vs Michigan', cat: 'b1g+' });
    for (const c of got) expect(Object.keys(c).sort()).toEqual(['cat', 'id', 'name']);
    expect(JSON.stringify(got)).not.toMatch(/dstreams|"u"|"p"|http|password|username/);
    expect(scanCandidates(list, 'http://strmz.xyz:8080').map((c) => c.id)).toEqual([11]);
    expect(scanCandidates(list, 'dstreams.xyz', 2).map((c) => c.id)).toEqual([3, 2]);
    expect(scanCandidates([chans(20, 'PPV1 05', 'PPV1'), chans(21, 'PPV1: UFC 321 Aspinall vs Gane', 'PPV1')], 'dstreams.xyz').map((c) => c.id)).toEqual([21]);
    const many = Array.from({ length: 2500 }, (_, i) => chans(100 + i, `Team ${i} vs Team ${i + 1}`, 'EVENTS'));
    expect(scanCandidates(many, 'dstreams.xyz')).toHaveLength(2000);
  });

  it('lineupHash: the same channels in any order give the same hash; a renamed one does not', async () => {
    const { lineupHash } = await import('./gameDay');
    const a = [{ id: 2, name: 'B1G+ 03', cat: 'b1g+' }, { id: 1, name: '#11 Boston vs Michigan', cat: 'b1g+' }];
    const h = lineupHash(a);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(lineupHash([...a].reverse())).toBe(h);
    expect(lineupHash([a[0], { ...a[1], name: '#11 Boston vs Maine' }])).not.toBe(h);
    expect(lineupHash([])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("lineupHash: always text the game-day-match function accepts (anything else is refused as bad_request)", async () => {
    const { lineupHash } = await import('./gameDay');
    const SERVER_FORMAT = /^[A-Za-z0-9_:.-]{1,128}$/;
    const odd = [
      [],
      [{ id: 1, name: '', cat: '' }],
      [{ id: 7, name: 'Atlético vs München | ⚽ 7:00 PM ET', cat: 'uefa' }, { id: 3, name: '"quotes" \\ / <tags>', cat: 'x' }],
      Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, name: `Team ${i} vs Team ${i + 1}`, cat: 'events' })),
      [{ id: NaN, name: null, cat: undefined }] as never,
    ];
    for (const c of odd) expect(lineupHash(c as never)).toMatch(SERVER_FORMAT);
  });

  it('teamTokens: the teams\' names, schools, mascots and codes', async () => {
    const { teamTokens } = await import('./gameDay');
    const t = teamTokens(hockey(BU()));
    expect(t).toEqual(expect.arrayContaining(['boston', 'terriers', 'michigan', 'wolverines', 'mich']));
    expect(t).not.toContain('university');
  });

  it('aiLinks: only streams loaded here, on that provider, under that name or one with the teams\' words', async () => {
    const { aiLinks, arrangeLinks } = await import('./gameDay');
    const g = hockey(BU());
    const list = [
      chans(1, 'DS 01', 'EXTRA'),
      chans(2, 'Boston U @ Michigan', 'EXTRA'),
      chans(3, 'Ohio State vs Penn State', 'EXTRA'),
      chans(4, 'DS 04', 'EXTRA', other),
    ];
    const got = aiLinks(g, list, 'dstreams.xyz', [
      { stream_id: 1, name: 'DS 01', confidence: 'medium', source: 'ai' },
      { stream_id: 2, name: 'Feed 2', confidence: 'high', source: 'ai' },
      // Renamed for another game since the search: not shown.
      { stream_id: 3, name: 'Boston vs Michigan', confidence: 'high', source: 'ai' },
      // Not on this provider's lines, or not loaded here.
      { stream_id: 4, name: 'DS 04', confidence: 'high', source: 'crowd' },
      { stream_id: 99, name: 'Gone', confidence: 'high', source: 'ai' },
    ]);
    expect(got.map((c) => [c.stream.stream_id, c.score, c.via, c.search])).toEqual([[2, 85, 'game', 'high'], [1, 75, 'game', 'medium']]);
    expect(aiLinks(g, list, 'strmz.xyz', [{ stream_id: 4, name: 'DS 04', confidence: 'high', source: 'crowd' }]).map((c) => c.stream.stream_id)).toEqual([4]);
    // Their own group; the guide still decides.
    const groups = arrangeLinks(g, [{ ...got[0], guide: 'yes' }, { ...got[1] }], false);
    expect(ids(groups.main)).toEqual([2]);
    expect(ids(groups.search)).toEqual([1]);
    expect(arrangeLinks(g, [{ ...got[1], guide: 'other' }], false).search).toEqual([]);
  });

  it("checkGuides reads the search links' guide: 'other' drops one, 'yes' makes it the game's, none keeps it apart", async () => {
    const { aiLinks, arrangeLinks, checkGuides, mergeLinks } = await import('./gameDay');
    const now = Date.parse('2026-10-02T22:00:00Z');
    const kick = now + 60 * 60_000;
    const on = (title: string, description = '') => [{ title, description, start: kick - 5 * 60_000, end: kick + 3 * 60 * 60_000 }];
    const g = hockey(BU(), { start: new Date(kick).toISOString() });
    const list = [chans(21, 'DS 21', 'EXTRA'), chans(22, 'DS 22', 'EXTRA'), chans(23, 'DS 23', 'EXTRA')];
    const search = aiLinks(g, list, 'dstreams.xyz', [21, 22, 23].map((id) => ({ stream_id: id, name: `DS ${id}`, confidence: 'high' as const, source: 'ai' as const })));
    epg[21] = on('College Hockey', 'Boston University at Michigan.');
    epg[22] = on('Cooking Live');
    const extra = await checkGuides(g, list, search, [g], now);
    expect(vi.mocked(xtream.getShortEpg).mock.calls.map((c) => c[1]).sort()).toEqual([21, 22, 23]);
    expect(extra.map((c) => [c.stream.stream_id, c.guide])).toEqual([[21, 'yes'], [22, 'other'], [23, 'none']]);
    const groups = arrangeLinks(g, mergeLinks([extra, search], list), false);
    expect(ids(groups.main)).toEqual([21]);
    expect(ids(groups.search)).toEqual([23]);
  });
});
