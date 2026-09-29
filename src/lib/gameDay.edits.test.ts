/**
 * Game Day: the owner's channel picks (the admin app's game_day_channel_edits).
 * The pure merge over a game's links (add first, hide, down last), the service
 * a line is on, and the read that never blocks: a failed or missing table
 * leaves every list as the matching made it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the table read does: a test sets `next`, and reads `reads`. */
const db = vi.hoisted(() => ({
  reads: [] as Array<{ table: string; cols: string; order: string }>,
  next: (() => Promise.resolve({ data: [] as unknown, error: null as unknown })) as () => PromiseLike<{ data: unknown; error: unknown }>,
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    from: (table: string) => ({
      select: (cols: string) => ({ order: (order: string) => { db.reads.push({ table, cols, order }); return db.next(); } }),
    }),
  },
}));
vi.mock('@/lib/xtream', () => ({
  getLiveCategories: vi.fn(), getLiveStreams: vi.fn(), getShortEpg: vi.fn(),
  decodeEpgText: (s?: string) => s ?? '', parseEpgTime: (s?: string) => Number(s ?? 0),
}));

import {
  __resetGameDayForTests, applyChannelEdits, channelsForGame, fetchGameEdits, serviceOf, sportsChannel,
  type Game, type GameChannel, type GameEdit,
} from './gameDay';

const dream = { host: 'http://dstreams.xyz:8080', username: 'ds', password: 'p', output: 'm3u8' as const };
/** A second login on the same panel, written the other way (port 2083, no scheme). */
const dream2 = { host: 'dstreams.xyz:2083', username: 'ds2', password: 'p', output: 'm3u8' as const };
const vibez = { host: 'https://strmz.xyz', username: 'vb', password: 'p', output: 'm3u8' as const };

const team = (short: string, location: string, name: string) => ({ short, location, name, abbr: '', logo: null, score: null });
const game = (id = 'nfl:1', over: Partial<Game> = {}): Game => ({
  id, league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: '', state: 'pre', detail: '', home: null, away: null, networks: [], ...over,
});
const link = (line: typeof dream, id: number, name: string, via: GameChannel['via'] = 'network', score = 70): GameChannel => ({
  line, stream: { stream_id: id, name }, score, via,
});
const edit = (over: Partial<GameEdit> & Pick<GameEdit, 'action' | 'stream_id'>): GameEdit => ({
  game_id: 'nfl:1', service: 'dstreams.xyz', channel_name: '', sort: 0, ...over,
});
/** "login:stream" of each link, in order. */
const at = (l: GameChannel[]): string[] => l.map((x) => `${x.line.username}:${x.stream.stream_id}`);

describe('serviceOf', () => {
  it("is the line's hostname alone, however the host is written", () => {
    expect(serviceOf({ host: 'http://dstreams.xyz:8080' })).toBe('dstreams.xyz');
    expect(serviceOf({ host: 'dstreams.xyz:2083' })).toBe('dstreams.xyz');
    expect(serviceOf({ host: 'https://strmz.xyz' })).toBe('strmz.xyz');
    expect(serviceOf(dream)).toBe('dstreams.xyz');
    expect(serviceOf(dream2)).toBe('dstreams.xyz');
    expect(serviceOf(vibez)).toBe('strmz.xyz');
  });

  it('lower-cases, and cuts at the first : or /', () => {
    expect(serviceOf({ host: 'HTTP://DStreams.XYZ:8080/' })).toBe('dstreams.xyz');
    expect(serviceOf({ host: 'strmz.xyz/player_api.php' })).toBe('strmz.xyz');
    expect(serviceOf('http://strmz.xyz:80')).toBe('strmz.xyz');
  });

  it('is empty for nothing', () => {
    expect(serviceOf({ host: '' })).toBe('');
    expect(serviceOf(undefined)).toBe('');
    expect(serviceOf(null)).toBe('');
  });
});

describe('applyChannelEdits', () => {
  it('hide drops the channel from that game only', () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream, 302, 'FOX'), link(vibez, 512, 'ESPN')];
    const edits = [edit({ action: 'hide', stream_id: 301 })];
    // Only the DreamStreams ESPN (its service and stream id) is gone; Vibez's has its own stream id.
    expect(at(applyChannelEdits(game('nfl:1'), auto, edits, [dream, vibez]))).toEqual(['ds:302', 'vb:512']);
    // Another game, the same links: untouched.
    expect(applyChannelEdits(game('nfl:2'), auto, edits, [dream, vibez])).toBe(auto);
  });

  it('matches the service without its port and the stream id as a number', () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream2, 301, 'ESPN'), link(dream, 302, 'FOX')];
    const edits = [edit({ action: 'hide', stream_id: '301' as unknown as number })];
    // Both logins on dstreams.xyz (port 8080 or 2083): the panel is the same.
    expect(at(applyChannelEdits(game(), auto, edits, [dream]))).toEqual(['ds:302']);
    // A link whose stream id is a string matches a number.
    const text = [{ ...auto[0], stream: { stream_id: '301' as unknown as number, name: 'ESPN' } }, auto[2]];
    expect(at(applyChannelEdits(game(), text, [edit({ action: 'hide', stream_id: 301 })], [dream]))).toEqual(['ds:302']);
  });

  it('add puts the channel first, in sort order, on every line of that service', () => {
    const auto = [link(dream, 302, 'FOX'), link(vibez, 512, 'ESPN')];
    const edits = [
      edit({ action: 'add', stream_id: 900, channel_name: 'Second pick', sort: 2 }),
      edit({ action: 'add', stream_id: 800, channel_name: 'First pick', sort: 1 }),
    ];
    const got = applyChannelEdits(game(), auto, edits, [dream, vibez, dream2]);
    // Both DreamStreams logins get both picks (the sort order first, then the box's line order); Vibez none.
    expect(at(got)).toEqual(['ds:800', 'ds2:800', 'ds:900', 'ds2:900', 'ds:302', 'vb:512']);
    expect(got.slice(0, 4).every((l) => l.picked === true)).toBe(true);
    expect(got.slice(4).some((l) => l.picked)).toBe(false);
  });

  it("add keeps the owner's order when the sorts tie, however many there are", () => {
    const edits = Array.from({ length: 14 }, (_, i) => edit({ action: 'add', stream_id: 100 + i, channel_name: `C${i}`, sort: 1 }));
    const got = applyChannelEdits(game(), [], edits, [dream]);
    expect(got.map((l) => l.stream.stream_id)).toEqual(edits.map((e) => e.stream_id));
  });

  it("add uses the stream as that line loaded it, or builds it from the pick when it did not", () => {
    const loaded = sportsChannel(dream, { stream_id: 800, name: 'US| CBS Sports HD', stream_icon: 'cbs.png', category_id: '7' } as never, 'US| SPORTS')!;
    const edits = [
      edit({ action: 'add', stream_id: 800, channel_name: 'CBS Sports', sort: 1 }),
      edit({ action: 'add', stream_id: 900, channel_name: 'Big Game Feed', sort: 2 }),
    ];
    const got = applyChannelEdits(game(), [], edits, [dream, dream2], [loaded]);
    expect(at(got)).toEqual(['ds:800', 'ds2:800', 'ds:900', 'ds2:900']);
    // Loaded on the first login: that very stream. Not loaded on the second (its own list), nor 900 on either: built from the pick.
    expect(got[0].stream).toBe(loaded.stream);
    expect(got[1].stream).toEqual({ stream_id: 800, name: 'CBS Sports' });
    expect(got[2].stream).toEqual({ stream_id: 900, name: 'Big Game Feed' });
    expect(got[3].stream).toEqual({ stream_id: 900, name: 'Big Game Feed' });
    // A game channel for the game, the owner's word for it.
    expect(got.every((l) => l.via === 'game' && l.picked)).toBe(true);
  });

  it('add never lists a channel twice: the pick replaces the matching own link to it', () => {
    const auto = [link(dream, 302, 'FOX'), { ...link(dream, 800, 'US| CBS Sports HD', 'network', 70), note: 'Guide: Bears at Packers' }, link(vibez, 800, 'CBS Vibez')];
    const edits = [
      edit({ action: 'add', stream_id: 800, channel_name: 'CBS Sports', sort: 1 }),
      // The same row twice, and under a spelling of the panel with a port.
      edit({ action: 'add', stream_id: 800, channel_name: 'CBS Sports', sort: 5 }),
      edit({ action: 'add', service: 'dstreams.xyz:8080', stream_id: 800, sort: 6 }),
    ];
    const got = applyChannelEdits(game(), auto, edits, [dream, vibez]);
    // The DreamStreams 800 once, first; Vibez's 800 is another stream on another panel: left as it was.
    expect(at(got)).toEqual(['ds:800', 'ds:302', 'vb:800']);
    // It is the matching's own stream, kind and guide note, now the owner's.
    expect(got[0]).toMatchObject({ picked: true, via: 'network', note: 'Guide: Bears at Packers' });
    expect(got[0].stream).toBe(auto[1].stream);
  });

  it('add is skipped, silently, when the box has no line on that service', () => {
    const auto = [link(dream, 302, 'FOX')];
    const edits = [edit({ action: 'add', service: 'strmz.xyz', stream_id: 512, channel_name: 'ESPN', sort: 1 })];
    expect(applyChannelEdits(game(), auto, edits, [dream])).toBe(auto);
    expect(applyChannelEdits(game(), auto, edits, [])).toBe(auto);
    // With a Vibez line it is added — and only on it.
    expect(at(applyChannelEdits(game(), auto, edits, [dream, vibez]))).toEqual(['vb:512', 'ds:302']);
  });

  it('down keeps the channel but moves it to the end, marked down', () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream, 302, 'FOX'), link(vibez, 512, 'ESPN'), link(vibez, 513, 'NBC')];
    const got = applyChannelEdits(game(), auto, [edit({ action: 'down', stream_id: 301 }), edit({ action: 'down', service: 'strmz.xyz', stream_id: 512 })], [dream, vibez]);
    expect(at(got)).toEqual(['ds:302', 'vb:513', 'ds:301', 'vb:512']);
    expect(got.map((l) => !!l.ownerDown)).toEqual([false, false, true, true]);
    // The list it was given is not touched.
    expect(auto.some((l) => l.ownerDown)).toBe(false);
    expect(at(auto)).toEqual(['ds:301', 'ds:302', 'vb:512', 'vb:513']);
  });

  it('down does not add a channel the game does not have', () => {
    const auto = [link(dream, 302, 'FOX')];
    expect(applyChannelEdits(game(), auto, [edit({ action: 'down', stream_id: 999 })], [dream])).toBe(auto);
  });

  it('a pick marked down too is a down channel, last, and not a pick', () => {
    const auto = [link(dream, 302, 'FOX')];
    const edits = [edit({ action: 'add', stream_id: 800, channel_name: 'CBS', sort: 1 }), edit({ action: 'down', stream_id: 800 })];
    const got = applyChannelEdits(game(), auto, edits, [dream]);
    expect(at(got)).toEqual(['ds:302', 'ds:800']);
    expect(got[1]).toMatchObject({ ownerDown: true });
    expect(got[1].picked).toBeFalsy();
  });

  it('hide beats an add or a down of the same channel', () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream, 302, 'FOX')];
    const edits = [
      edit({ action: 'add', stream_id: 800, channel_name: 'CBS', sort: 1 }), edit({ action: 'hide', stream_id: 800 }),
      edit({ action: 'down', stream_id: 301 }), edit({ action: 'hide', stream_id: 301 }),
    ];
    expect(at(applyChannelEdits(game(), auto, edits, [dream]))).toEqual(['ds:302']);
  });

  it('puts add, hide and down together over the real matching', () => {
    const g = game('nfl:1', {
      home: team('Packers', 'Green Bay', 'Green Bay Packers'), away: team('Bears', 'Chicago', 'Chicago Bears'), networks: ['FOX'],
    });
    const list = [
      sportsChannel(dream, { stream_id: 1, name: 'NFL 01: Bears vs Packers' } as never, 'NFL')!,
      sportsChannel(dream, { stream_id: 2, name: 'US| FOX 5 New York' } as never, 'US| LOCALS')!,
      sportsChannel(dream, { stream_id: 3, name: 'NFL RedZone' } as never, 'NFL ZONE')!,
    ];
    const auto = channelsForGame(g, list);
    expect(at(auto)).toEqual(['ds:1', 'ds:2', 'ds:3']);
    const edits = [
      edit({ action: 'add', stream_id: 555, channel_name: 'CBS Sports HD', sort: 1 }),
      edit({ action: 'hide', stream_id: 2 }),
      edit({ action: 'down', stream_id: 1 }),
      // Another game's rows change nothing here.
      edit({ game_id: 'nfl:2', action: 'hide', stream_id: 3 }),
      edit({ game_id: 'nfl:2', action: 'add', stream_id: 777, channel_name: 'Other', sort: 0 }),
    ];
    const got = applyChannelEdits(g, auto, edits, [dream], list);
    expect(at(got)).toEqual(['ds:555', 'ds:3', 'ds:1']);
    expect(got.map((l) => [!!l.picked, !!l.ownerDown])).toEqual([[true, false], [false, false], [false, true]]);
  });

  it("ignores edits for a game that is not the one asked about", () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream, 302, 'FOX')];
    const edits = [
      edit({ game_id: 'nfl:999', action: 'hide', stream_id: 301 }),
      edit({ game_id: 'nfl:999', action: 'add', stream_id: 800, channel_name: 'CBS', sort: 1 }),
      edit({ game_id: 'nfl:999', action: 'down', stream_id: 302 }),
    ];
    expect(applyChannelEdits(game('nfl:1'), auto, edits, [dream])).toBe(auto);
  });

  it('gives the list back untouched with no edits, unusable ones, or when anything goes wrong', () => {
    const auto = [link(dream, 301, 'ESPN'), link(dream, 302, 'FOX')];
    expect(applyChannelEdits(game(), auto, [], [dream])).toBe(auto);
    expect(applyChannelEdits(game(), auto, null, [dream])).toBe(auto);
    expect(applyChannelEdits(game(), auto, undefined, [dream])).toBe(auto);
    const junk = [null, { game_id: 'nfl:1', action: 'explode', service: 'dstreams.xyz', stream_id: 301 }, edit({ action: 'hide', stream_id: 0 })];
    expect(applyChannelEdits(game(), auto, junk as never, [dream])).toBe(auto);
    const boom = { filter() { throw new Error('boom'); } } as unknown as GameEdit[];
    expect(applyChannelEdits(game(), auto, boom, [dream])).toBe(auto);
  });
});

describe('fetchGameEdits', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    game_id: 'nfl:1', service: 'dstreams.xyz', stream_id: 301, channel_name: 'ESPN', action: 'add', sort: 1, ...over,
  });
  const online = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value: on });

  beforeEach(() => {
    __resetGameDayForTests();
    db.reads.length = 0;
    db.next = () => Promise.resolve({ data: [], error: null });
    online(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    online(true);
  });

  it('reads the table once, in the sort order, and keeps it as long as the games', async () => {
    db.next = () => Promise.resolve({ data: [row(), row({ stream_id: 302, sort: 2 })], error: null });
    const first = await fetchGameEdits();
    expect(first.map((e) => e.stream_id)).toEqual([301, 302]);
    expect(db.reads).toEqual([{ table: 'game_day_channel_edits', cols: 'game_id,service,stream_id,channel_name,action,sort', order: 'sort' }]);
    expect(await fetchGameEdits()).toBe(first);
    expect(db.reads).toHaveLength(1);
    // The games' refresh asks again; the same rows come back as the same list.
    expect(await fetchGameEdits(true)).toBe(first);
    expect(db.reads).toHaveLength(2);
    // A few minutes on it is read again by itself.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60_000 + 1000);
    await fetchGameEdits();
    expect(db.reads).toHaveLength(3);
  });

  it('shares one read between callers that ask together', async () => {
    let answer: (v: { data: unknown; error: unknown }) => void = () => {};
    db.next = () => new Promise((r) => { answer = r; });
    const a = fetchGameEdits();
    const b = fetchGameEdits(true);
    expect(db.reads).toHaveLength(1);
    answer({ data: [row()], error: null });
    expect(await a).toBe(await b);
  });

  it("tidies each row: the panel's hostname, numbers for the ids, and drops what cannot be used", async () => {
    db.next = () => Promise.resolve({
      data: [
        row({ service: 'DStreams.xyz', stream_id: '301', channel_name: '  ESPN ', sort: '2' }),
        row({ service: 'strmz.xyz', stream_id: 512, channel_name: null, action: 'hide', sort: null }),
        row({ stream_id: 0 }),
        row({ stream_id: 'x' }),
        row({ game_id: '' }),
        row({ service: '' }),
        row({ action: 'explode' }),
        null,
      ],
      error: null,
    });
    expect(await fetchGameEdits()).toEqual([
      { game_id: 'nfl:1', service: 'dstreams.xyz', stream_id: 301, channel_name: 'ESPN', action: 'add', sort: 2 },
      { game_id: 'nfl:1', service: 'strmz.xyz', stream_id: 512, channel_name: '', action: 'hide', sort: 0 },
    ]);
  });

  it('gives no edits, and never throws, when the read fails or the table is missing', async () => {
    const fails: Array<() => PromiseLike<{ data: unknown; error: unknown }>> = [
      () => Promise.resolve({ data: null, error: { message: 'relation "game_day_channel_edits" does not exist' } }),
      () => Promise.resolve({ data: { not: 'a list' }, error: null }),
      () => Promise.reject(new Error('Failed to fetch')),
      () => { throw new TypeError('no table'); },
    ];
    for (const next of fails) {
      __resetGameDayForTests();
      db.next = next;
      expect(await fetchGameEdits()).toEqual([]);
    }
  });

  it('does not ask while the box is offline', async () => {
    online(false);
    expect(await fetchGameEdits()).toEqual([]);
    expect(db.reads).toHaveLength(0);
  });

  it('keeps the last good list when a later read fails, and takes a changed one', async () => {
    db.next = () => Promise.resolve({ data: [row()], error: null });
    const good = await fetchGameEdits();
    db.next = () => Promise.reject(new Error('offline'));
    expect(await fetchGameEdits(true)).toBe(good);
    db.next = () => Promise.resolve({ data: [row({ action: 'hide' })], error: null });
    const changed = await fetchGameEdits(true);
    expect(changed).not.toBe(good);
    expect(changed.map((e) => e.action)).toEqual(['hide']);
  });

  it('gives up on a read that does not answer after a few seconds, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    db.next = () => new Promise(() => {});
    let done = false;
    const p = fetchGameEdits().then((e) => { done = true; return e; });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await p).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    // A read that answers clears its timer too.
    db.next = () => Promise.resolve({ data: [row()], error: null });
    expect((await fetchGameEdits(true)).length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
