/**
 * Game Day never says a game is "not in your channels" before the search for
 * it is over. While the line-up is still being read, OK on a game opens its
 * list on "Still finding this game's channels…" (the row says "Finding your
 * channels…"); when the line-up comes, the list offers what was found (and OK
 * plays it), or only then says it's not there. The guide being asked, and
 * the line-up search's answer on its way, are "still looking" too. A line
 * that didn't load, or a guide that didn't answer, is "couldn't check" with
 * Try again: never "not in your channels".
 */
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const line = { host: 'http://h', username: 'u', password: 'p' };
const team = (short: string, location: string) => ({ short, name: `${location} ${short}`, location, abbr: '', logo: null, score: null });

const world = vi.hoisted(() => ({
  /** The line-up read: `missing` hears the lines it could not read. Unset: the usual channels at once. */
  load: null as null | ((missing?: unknown[]) => Promise<unknown[]>),
  /** Lines saved on the box besides the one signed in. */
  saved: [] as unknown[],
  /** The guide check: `stats.failed` counts its failed lookups. Unset: nothing found. */
  guide: null as null | ((stats?: { failed: number }) => Promise<unknown[]>),
  loads: 0,
  guides: 0,
  flag: false,
  chan: null as unknown as (id: number, name: string, cat: string) => unknown,
  usual: [] as Array<[number, string, string]>,
  invoke: vi.fn(),
}));

vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  world.chan = (id, name, cat) => real.sportsChannel(line as never, { stream_id: id, name } as never, cat)!;
  return {
    ...real,
    fetchGames: async () => [
      { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
        home: team('Packers', 'Green Bay'), away: team('Bears', 'Chicago'), networks: ['FOX'] },
      { id: 'mlb:2', league: 'mlb', leagueLabel: 'MLB', name: 'TOR @ BAL', start: soon, state: 'pre', detail: '',
        home: team('Orioles', 'Baltimore'), away: team('Blue Jays', 'Toronto'), networks: ['MLB.tv'] },
      { id: 'mlb:3', league: 'mlb', leagueLabel: 'MLB', name: 'DET @ CHW', start: soon, state: 'pre', detail: '',
        home: team('White Sox', 'Chicago'), away: team('Tigers', 'Detroit'), networks: ['Peacock'] },
    ],
    loadSportsChannels: (_lines: unknown, _learned: unknown, missing?: unknown[]) => {
      world.loads += 1;
      return world.load ? world.load(missing) : Promise.resolve(world.usual.map(([id, name, cat]) => world.chan(id, name, cat)));
    },
    checkGuides: (...args: unknown[]) => {
      world.guides += 1;
      return world.guide ? world.guide(args[6] as { failed: number } | undefined) : Promise.resolve([]);
    },
    fetchGameEdits: async () => [],
    // The line-up's hash, fixed so the search's stored answer is this line-up's (no scan).
    lineupHash: () => 'HASH',
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => world.saved }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: world.flag, loading: false }) }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false, channelReport: () => null, isCategoryDown: () => false, signalCategory: () => undefined, openWhenFresh: (_h: string, go: (f: null) => void) => go(null), signalChannel: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'dev-1' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: world.invoke },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));

// OK plays when it is let go (a held OK opens the channel's menu instead), so OK is pressed and released.
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });
/** A promise the test settles when it chooses. */
const held = <T,>() => {
  let release!: (v: T) => void;
  const p = new Promise<T>((r) => { release = r; });
  return { p, release };
};
const rowOf = (home: string): HTMLElement =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-gd-row]')).find((r) => r.textContent?.includes(`@ ${home}`))!;
const handedOver = () => JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}');
const STILL = "Still finding this game's channels…";
const NONE = /Not in your channels right now/;
const NOT_IN = /not in your channels/i;

async function renderGameDay() {
  const { default: GameDay } = await import('./GameDaySection');
  const onWatch = vi.fn();
  render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
  await waitFor(() => expect(document.querySelectorAll('[data-gd-row]').length).toBe(3));
  return { onWatch };
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  world.load = null; world.guide = null; world.loads = 0; world.guides = 0; world.flag = false; world.saved = [];
  world.usual = [[9, 'NFL 01: Bears vs Packers', 'NFL'], [7, 'US| FOX 5 New York', 'US| LOCALS'], [3, 'USA | A&E', 'USA']];
  world.invoke.mockReset();
  world.invoke.mockImplementation(async () => ({ data: { ok: true }, error: null }));
});

describe('Game Day: no "not in your channels" before the search is over', () => {
  it("OK on a game while the line-up is still being read: still finding; then the channel found is offered, and OK plays it", async () => {
    const lineup = held<unknown[]>();
    world.load = () => lineup.p;
    const { onWatch } = await renderGameDay();
    expect(rowOf('Packers').textContent).toContain('Finding your channels…');
    await key('Enter');
    expect(await screen.findByText(STILL)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(document.body.textContent).not.toMatch(NOT_IN);
    // The guide is asked once the line-up is in, not before.
    expect(world.guides).toBe(0);
    // OK with nothing listed yet waits there (the list stays open).
    await key('Enter');
    expect(screen.getByText(STILL)).toBeTruthy();
    expect(onWatch).not.toHaveBeenCalled();

    await act(async () => { lineup.release(world.usual.map(([id, name, cat]) => world.chan(id, name, cat))); });
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(screen.queryByText(STILL)).toBeNull();
    await waitFor(() => expect(world.guides).toBe(1));
    await key('Enter');
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
    expect(handedOver()).toMatchObject({ streamId: 9 });
  });

  it('when the search finds nothing for the game, only then "not in your channels"', async () => {
    const lineup = held<unknown[]>();
    world.load = () => lineup.p;
    const guide = held<unknown[]>();
    world.guide = () => guide.p;
    await renderGameDay();
    await key('ArrowDown');
    await key('Enter');
    expect(await screen.findByText(STILL)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    // The line-up comes with nothing of this game's: its guide is asked, still not "not there".
    await act(async () => { lineup.release([world.chan(3, 'USA | A&E', 'USA')]); });
    expect(await screen.findByText('Checking the guide…')).toBeTruthy();
    expect(screen.queryByText(STILL)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    // The guide has nothing either: now it says so.
    await act(async () => { guide.release([]); });
    expect(await screen.findByText(NONE)).toBeTruthy();
    expect(rowOf('Orioles').textContent).toContain('MLB.tv (streaming only)');
  });

  it("a line that didn't load: \"couldn't check\" with Try again, never \"not in your channels\"; Try again reads it again", async () => {
    world.load = (missing) => { missing?.push(line); return Promise.resolve([]); };
    const { onWatch } = await renderGameDay();
    await waitFor(() => expect(rowOf('Packers').textContent).toContain("Couldn't check your channels"));
    expect(rowOf('Orioles').textContent).toContain("Couldn't check your channels");
    expect(document.body.textContent).not.toMatch(NOT_IN);
    await key('Enter');
    expect(await screen.findByText(/Couldn't finish checking your channels for this game/)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();

    // Try again (the only item, so under the remote): the line-up is read
    // again, the list is still finding until it comes.
    const again = held<unknown[]>();
    world.load = () => again.p;
    const before = world.loads;
    await key('Enter');
    expect(await screen.findByText(STILL)).toBeTruthy();
    expect(world.loads).toBe(before + 1);
    expect(rowOf('Packers').textContent).toContain('Finding your channels…');
    await act(async () => { again.release(world.usual.map(([id, name, cat]) => world.chan(id, name, cat))); });
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
    await key('Enter');
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
    expect(handedOver()).toMatchObject({ streamId: 9 });
  });

  it("a guide that didn't answer: \"couldn't check\" with Try again, which asks it again", async () => {
    world.usual = [...world.usual, [31, 'US| PEACOCK 01', 'US| PEACOCK'], [32, 'US| PEACOCK 02', 'US| PEACOCK']];
    world.guide = async (stats) => { if (stats) stats.failed += 2; return []; };
    const { onWatch } = await renderGameDay();
    expect(await screen.findByText('Peacock — press Watch to check your guide')).toBeTruthy();
    fireEvent.click(Array.from(rowOf('White Sox').querySelectorAll('button')).find((b) => b.textContent?.includes('Watch'))!);
    expect(await screen.findByText(/Couldn't finish checking your channels for this game/)).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    // This time the guide answers, with the game on a feed.
    const feed = { line, stream: { stream_id: 32, name: 'US| PEACOCK 02' }, score: 95, via: 'game', note: 'Guide: Tigers at White Sox', guide: 'yes' };
    world.guide = async () => [feed];
    await key('Enter');
    expect(await screen.findByText('Guide: Tigers at White Sox')).toBeTruthy();
    expect(world.guides).toBe(2);
    expect(screen.queryByText('Try again')).toBeNull();
    await key('Enter');
    expect(onWatch).toHaveBeenCalledWith('mlb:3');
    expect(handedOver()).toMatchObject({ streamId: 32 });
  });

  it("a game with two teams isn't \"not in your channels\" while the line-up search's answer is on its way", async () => {
    world.flag = true;
    const answer = held<unknown>();
    world.invoke.mockImplementation(async (_fn: string, opts: { body: { op: string } }) => {
      if (opts.body.op === 'cached') return { data: await answer.p, error: null };
      return { data: { ok: true }, error: null };
    });
    await renderGameDay();
    await waitFor(() => expect(world.invoke).toHaveBeenCalled());
    // The NFL game has its channel; the other has nothing yet: still looking.
    expect(rowOf('Packers').textContent).toContain('NFL 01: Bears vs Packers');
    expect(rowOf('Orioles').textContent).toContain('Finding your channels…');
    await key('ArrowDown');
    await key('Enter');
    expect(await screen.findByText('Searching your channels…')).toBeTruthy();
    expect(screen.queryByText(NONE)).toBeNull();
    // The answer: nothing for it. Now it's not in the channels.
    await act(async () => {
      answer.release({ ok: true, lineup_hash: 'HASH', scanned_at: new Date(Date.now() - 60_000).toISOString(), matches: {}, learned: [] });
    });
    expect(await screen.findByText(NONE)).toBeTruthy();
    expect(screen.queryByText('Searching your channels…')).toBeNull();
    expect(rowOf('Orioles').textContent).toContain('MLB.tv (streaming only)');
  });

  it('two saved lines, one that never loads: the games are decided from the one that did, not "couldn\'t check"', async () => {
    const dead = { host: 'http://dead.test', username: 'x', password: 'y', output: 'ts', serverLabel: 'Old line' };
    world.saved = [dead];
    world.load = (missing) => { missing?.push(dead); return Promise.resolve(world.usual.map(([id, name, cat]) => world.chan(id, name, cat))); };
    await renderGameDay();
    await waitFor(() => expect(rowOf('Packers').textContent).not.toContain('Finding your channels…'));
    expect(document.body.textContent).not.toContain("Couldn't check your channels");
    // The game the live line carries is offered as usual.
    await key('Enter');
    expect(await screen.findByText('Game channel')).toBeTruthy();
  });
});
