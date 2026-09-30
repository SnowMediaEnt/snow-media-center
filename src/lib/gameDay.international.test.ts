// Game Day's national-team and extra soccer competitions: their chips, the
// league words of channels, and finding USA vs Chile or Czechia vs England
// by the teams' names, codes and networks.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/xtream', () => ({
  getLiveCategories: vi.fn(), getLiveStreams: vi.fn(), getShortEpg: vi.fn(async () => ({ epg_listings: [] })),
  decodeEpgText: (s?: string) => s ?? '',
  parseEpgTime: (s?: string) => Number(s ?? 0),
}));

import type { Game, GameTeam, SportsChannel } from './gameDay';

const line = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p' } as never;
const team = (short: string, location: string, name: string, abbr = ''): GameTeam => ({ short, location, name, abbr, logo: null, score: null });
const game = (over: Partial<Game>): Game => ({
  id: 'g', league: 'friendly', leagueLabel: 'Friendly', name: '', start: '', state: 'pre', detail: '', home: null, away: null, networks: [], ...over,
});
// ESPN's national teams: the USA's short name is "USA", Czechia's is its own.
const USA = team('USA', 'United States', 'United States', 'USA');
const CHILE = team('Chile', 'Chile', 'Chile', 'CHI');
const CZE = team('Czechia', 'Czechia', 'Czechia', 'CZE');
const ENG = team('England', 'England', 'England', 'ENG');
const usaChile = (over: Partial<Game> = {}): Game => game({ id: 'friendly:1', name: 'Chile @ USA', home: USA, away: CHILE, networks: ['TNT', 'truTV', 'Universo'], ...over });
const czeEng = (over: Partial<Game> = {}): Game => game({
  id: 'unl:1', league: 'unl', leagueLabel: 'UEFA Nations League', name: 'England @ Czechia', home: CZE, away: ENG, networks: ['FS1', 'Fox One'], ...over,
});

let chans: (id: number, name: string, cat?: string) => SportsChannel;
beforeEach(async () => {
  const m = await import('./gameDay');
  m.__resetGameDayForTests();
  chans = (id, name, cat = '') => m.sportsChannel(line, { stream_id: id, name, category_id: cat ? cat.length : undefined } as never, cat)!;
});
const ids = (l: Array<{ stream: { stream_id: number } }>) => l.map((c) => c.stream.stream_id);

describe('chips', () => {
  it('files the national teams under International and the other soccer competitions under More Soccer, the big leagues on their own', async () => {
    const { chipOf } = await import('./gameDay');
    for (const l of ['friendly', 'friendlyw', 'wcq', 'unl', 'cnl', 'euroq', 'euro', 'wc', 'wwc', 'copa', 'gold']) {
      expect(chipOf({ league: l, leagueLabel: 'x' }), l).toMatchObject({ id: 'chip:intl', labelKey: 'gameDay.chipIntl' });
    }
    for (const l of ['uecl', 'facup', 'efl', 'wsl', 'leaguescup', 'cwc', 'liberta']) {
      expect(chipOf({ league: l, leagueLabel: 'x' }), l).toMatchObject({ id: 'chip:soccer', labelKey: 'gameDay.chipSoccer' });
    }
    // One chip each, the games keep their own label for the row.
    expect(chipOf({ league: 'mls', leagueLabel: 'MLS' })).toEqual({ id: 'mls', label: 'MLS' });
    expect(chipOf({ league: 'epl', leagueLabel: 'Premier League' })).toEqual({ id: 'epl', label: 'Premier League' });
    expect(chipOf({ league: 'wncaab', leagueLabel: "Women's College Basketball" }).id).toBe('wncaab');
    expect(chipOf({ league: 'ppv', leagueLabel: 'PPV' }).id).toBe('ppv');
  });

  it('has both chip names in every language', async () => {
    const files = import.meta.glob('../i18n/locales/*/gameDay.json', { eager: true }) as Record<string, { default: { gameDay: Record<string, unknown> } }>;
    expect(Object.keys(files)).toHaveLength(5);
    for (const [path, mod] of Object.entries(files)) {
      expect(typeof mod.default.gameDay.chipIntl, path).toBe('string');
      expect(typeof mod.default.gameDay.chipSoccer, path).toBe('string');
    }
  });
});

describe('league words', () => {
  it("read a competition's name, and a soccer channel is every soccer competition's", async () => {
    const { leaguesIn, categoryWeight } = await import('./gameDay');
    expect(leaguesIn('us international friendly')).toEqual(expect.arrayContaining(['friendly', 'friendlyw']));
    expect(leaguesIn('uefa nations league')).toEqual(expect.arrayContaining(['unl', 'cnl']));
    expect(leaguesIn('wc qualifier conmebol')).toContain('wcq');
    expect(leaguesIn('fa cup')).toEqual(['facup']);
    expect(leaguesIn('conference league')).toEqual(['uecl']);
    expect(leaguesIn('carabao cup')).toEqual(['efl']);
    expect(leaguesIn('leagues cup')).toEqual(['leaguescup']);
    expect(leaguesIn('womens college basketball')).toEqual(expect.arrayContaining(['wncaab', 'ncaab']));
    expect(leaguesIn('us soccer')).toEqual(expect.arrayContaining(['friendly', 'unl', 'facup', 'mls', 'epl']));
    // "Family friendly" is no soccer game.
    expect(leaguesIn('family friendly movies')).toEqual([]);
    expect(categoryWeight('US| WORLD CUP QUALIFIERS')).toBe(3);
    expect(categoryWeight('US| NATIONS LEAGUE')).toBe(3);
  });
});

describe("USA vs Chile", () => {
  it("finds the game by the teams' names and codes, and the networks (with their partners), never USA Network", async () => {
    const { channelsForGame } = await import('./gameDay');
    const list = [
      chans(1, 'US| USA vs Chile', 'US| SOCCER'),
      chans(2, 'USMNT vs CHI - International Friendly', 'US| SPORTS'),
      chans(3, 'US| TNT HD', 'US| SPORTS'),
      chans(4, 'US| truTV', 'US| ENTERTAINMENT'),
      chans(5, 'US| Universo HD', 'US| SPANISH'),
      chans(6, 'US| USA Network HD', 'US| ENTERTAINMENT'),
      chans(7, 'US| FS1 HD', 'US| SPORTS'),
      chans(8, 'US| Mexico vs Peru', 'US| SOCCER'),
      chans(9, 'Estados Unidos vs Chile | TUDN', 'US| SPANISH'),
    ];
    const got = channelsForGame(usaChile(), list);
    const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
    expect(by[1]).toBe('game');
    expect(by[2]).toBe('game');
    expect(by[9]).toBe('game');
    expect(by[3]).toBe('network');
    expect(by[4]).toBe('network');
    expect(by[5]).toBe('network');
    // Not the game's networks, and not the USA's "team channel".
    expect(ids(got)).not.toEqual(expect.arrayContaining([6]));
    expect(ids(got)).not.toContain(7);
    expect(ids(got)).not.toContain(8);
    // The named game before the networks.
    expect(ids(got).slice(0, 3).sort()).toEqual([1, 2, 9]);
  });

  it("the streaming services to check are the networks' partners (Universo and Telemundo on Peacock, Golazo on Paramount+, FS1 on Fox One)", async () => {
    const { gameServices } = await import('./gameDay');
    expect(gameServices(usaChile({ networks: ['Telemundo', 'Peacock'] }))).toEqual(['peacock']);
    expect(gameServices(usaChile({ networks: ['Universo'] }))).toEqual(['peacock']);
    expect(gameServices(usaChile({ networks: ['CBS Golazo Network', 'Paramount+'] }))).toEqual(['paramount']);
    expect(gameServices(usaChile({ networks: ['FS1', 'Fox One'] }))).toEqual(['foxone']);
  });

  it('the USWNT and a women\'s friendly go by the same names', async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({ id: 'friendlyw:1', league: 'friendlyw', leagueLabel: "Women's Friendly", home: USA, away: team('Japan', 'Japan', 'Japan', 'JPN'), networks: [] });
    const got = channelsForGame(g, [chans(1, 'USWNT vs Japan', 'US| SOCCER'), chans(2, 'US| USA Network', 'US| ENTERTAINMENT')]);
    expect(ids(got)).toEqual([1]);
  });
});

describe('Czechia vs England', () => {
  it('is found by CZE / ENG, Czech Republic, Czechia and the FS1 network', async () => {
    const { channelsForGame } = await import('./gameDay');
    const list = [
      chans(1, 'US| CZE vs ENG', 'US| SOCCER'),
      chans(2, 'England v Czech Republic - Nations League', 'US| SPORTS'),
      chans(3, 'Czechia vs England | Peacock 02', 'US| PEACOCK'),
      chans(4, 'US| FS1 HD', 'US| SPORTS'),
      chans(5, 'US| ENG vs SCO', 'US| SOCCER'),
      chans(6, 'England vs Spain', 'US| SOCCER'),
      chans(7, 'US| FOX Sports 1', 'US| SPORTS'),
    ];
    const got = channelsForGame(czeEng(), list);
    const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
    expect(by[1]).toBe('game');
    expect(by[2]).toBe('game');
    expect(by[3]).toBe('game');
    expect(by[4]).toBe('network');
    expect(by[7]).toBe('network');
    expect(ids(got)).not.toContain(5);
    // England on its own is a team channel at best, never the game's own.
    expect(by[6]).not.toBe('game');
  });

  it('does not take another nation league\'s CONCACAF channel', async () => {
    const { channelsForGame } = await import('./gameDay');
    // A channel of the UFC or the NHL is never a soccer game's.
    const got = channelsForGame(czeEng(), [chans(1, 'UFC Fight Night England', 'US| UFC'), chans(2, 'NHL Network', 'US| NHL')]);
    expect(got).toEqual([]);
  });
});

describe('the other competitions', () => {
  it("a cup's channels and its teams' are found like a league's", async () => {
    const { channelsForGame } = await import('./gameDay');
    const g = game({
      id: 'facup:1', league: 'facup', leagueLabel: 'FA Cup', name: 'Derby @ Leeds',
      home: team('Leeds', 'Leeds', 'Leeds United', 'LEE'), away: team('Derby', 'Derby', 'Derby County', 'DER'), networks: ['ESPN+', 'ESPN'],
    });
    const list = [
      chans(1, 'FA CUP 02: Leeds vs Derby', 'FA CUP'),
      chans(2, 'US| ESPN HD', 'US| SPORTS'),
      chans(3, 'FA Cup TV', 'FA CUP'),
      chans(4, 'US| Premier League TV', 'PREMIER LEAGUE'),
    ];
    const got = channelsForGame(g, list);
    const by = Object.fromEntries(got.map((c) => [c.stream.stream_id, c.via]));
    expect(by[1]).toBe('game');
    expect(by[2]).toBe('network');
    expect(by[3]).toBe('league');
    expect(ids(got)).not.toContain(4);
  });
});
