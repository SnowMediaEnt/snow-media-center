import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slow under a loaded full run (renders the whole screen); the default 5 s flakes.
vi.setConfig({ testTimeout: 20_000 });

// The screen loads its games and channels, then lays out up to 80 rows: on a
// busy test machine the first render can pass the default 1 s wait.
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
/** What the guide check answers: a test may hold it back and hand it over later. */
const guide = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown[]>) }));
/** A test's own games and channels, after the usual ones. */
const more = vi.hoisted(() => ({ games: [] as unknown[], channels: [] as Array<[number, string, string]> }));
const line = { host: 'http://h', username: 'u', password: 'p' };
/** "9.24 7:30 PM ET": a time `hours` from now, as the provider writes it. */
const eastern = vi.hoisted(() => (hours: number) => {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(new Date(Date.now() + hours * 60 * 60_000))) p[x.type] = x.value;
  return `${p.month}.${p.day} ${p.hour}:${p.minute} ${String(p.dayPeriod).toUpperCase()} ET`;
});
const team = (short: string, location: string) => ({ short, name: `${location} ${short}`, location, abbr: '', logo: null, score: null });
vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  return {
    ...real,
    fetchGames: async () => [
      { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
        home: team('Packers', 'Green Bay'), away: team('Bears', 'Chicago'), networks: ['FOX'] },
      { id: 'mlb:2', league: 'mlb', leagueLabel: 'MLB', name: 'TOR @ BAL', start: soon, state: 'pre', detail: '',
        home: team('Orioles', 'Baltimore'), away: team('Blue Jays', 'Toronto'), networks: ['MLB.tv'] },
      ...more.games,
    ],
    loadSportsChannels: async () => [
      real.sportsChannel(line as never, { stream_id: 9, name: 'NFL 01: Bears vs Packers' } as never, 'NFL')!,
      real.sportsChannel(line as never, { stream_id: 7, name: 'US| FOX 5 New York' } as never, 'US| LOCALS')!,
      real.sportsChannel(line as never, { stream_id: 3, name: 'USA | A&E' } as never, 'USA')!,
      real.sportsChannel(line as never, { stream_id: 8, name: 'NFL RedZone' } as never, 'NFL ZONE')!,
      // The provider's PPV names: the event, then its date and time Eastern.
      real.sportsChannel(line as never, { stream_id: 21, name: `PPV EVENT 02: Dirt Track 100 at Fonda (${eastern(3)})`, category_id: 50 } as never, 'PAY-PER-VIEW 2')!,
      real.sportsChannel(line as never, { stream_id: 22, name: `PPV EVENT 13: Big Fight vs. Other Guy (${eastern(4)})`, category_id: 50 } as never, 'PAY-PER-VIEW 2')!,
      ...more.channels.map(([id, name, cat]) => real.sportsChannel(line as never, { stream_id: id, name } as never, cat)!),
    ],
    checkGuides: () => (guide.answer ? guide.answer() : Promise.resolve([])),
    // The owner's picks table is not asked in these tests.
    fetchGameEdits: async () => [],
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// OK plays when it is let go (a held OK opens the channel's menu instead), so OK is pressed and released.
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  guide.answer = null; more.games = []; more.channels = [];
});

/** A guide check the test answers when it chooses. */
const heldGuide = () => {
  const held = { release: (_links: unknown[]) => {} };
  guide.answer = () => new Promise((r) => { held.release = r; });
  return held;
};
/** The row of the game whose home team is `home`. */
const rowOf = (home: string): HTMLElement =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-gd-row]')).find((r) => r.textContent?.includes(`@ ${home}`))!;
const button = (row: HTMLElement, name: string): HTMLElement =>
  Array.from(row.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent?.includes(name))!;
const unconfirmedHeading = 'Not confirmed by the guide — may not have this game';

describe('GameDaySection', () => {
  it("Watch lists the game's channels; OK plays the one picked", async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    const held = heldGuide();
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    // The list: the game channel first. FOX 5, only its name matched, waits
    // for the guide.
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(screen.queryByText('National TV')).toBeNull();
    expect(screen.queryByText('US| FOX 5 New York')).toBeNull();
    // The guide can't tell: FOX 5 comes in at the bottom, not confirmed.
    await act(async () => { held.release([]); await Promise.resolve(); });
    expect(await screen.findByText(unconfirmedHeading)).toBeTruthy();
    expect(screen.getByText('National TV')).toBeTruthy();
    const items = Array.from(document.querySelectorAll('[data-gd-pick]')).map((b) => b.textContent ?? '');
    expect(items.findIndex((x) => x.includes('FOX 5'))).toBe(1);
    expect(onWatch).not.toHaveBeenCalled();
    await key('ArrowDown');
    await key('Enter');
    // Handed over with the game, so Back from the channel comes back to its list.
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 7, username: 'u' });
    // Back on the games: Remind me.
    await key('ArrowRight');
    await key('Enter');
    expect(await screen.findByText('Reminder on')).toBeTruthy();
  });

  it("shows a whip-around zone channel (RedZone) in its own section, never as a team link", async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('NFL RedZone')).toBeTruthy();
    expect(screen.getByText('Zone channels — every game of the league, not just this one')).toBeTruthy();
    expect(screen.getByText('Zone channel')).toBeTruthy();
    expect(screen.queryByText('Team channel')).toBeNull();
  });

  it("the guide's answer arriving later leaves the highlight on the channel it was on", async () => {
    const real = await vi.importActual<typeof import('@/lib/gameDay')>('@/lib/gameDay');
    const held = heldGuide();
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('NFL RedZone')).toBeTruthy();
    await key('ArrowDown');
    // RedZone is highlighted; now the guide confirms another channel, which
    // goes up with the game's own, and FOX 5 comes in under "Not confirmed by
    // the guide".
    const confirmed = { line, stream: { stream_id: 3, name: 'USA | A&E' }, score: 95, via: 'network', note: 'Guide: Bears at Packers', guide: 'yes' };
    await act(async () => { held.release([confirmed]); await Promise.resolve(); });
    expect(await screen.findByText('Guide: Bears at Packers')).toBeTruthy();
    expect(screen.getByText(unconfirmedHeading)).toBeTruthy();
    expect(real.LINK_LABELS.network).toBe('National TV');
    const items = Array.from(document.querySelectorAll('[data-gd-pick]')).map((b) => b.textContent ?? '');
    expect(items.map((x) => ['A&E', 'NFL 01', 'FOX 5', 'RedZone'].find((n) => x.includes(n)))).toEqual(['NFL 01', 'A&E', 'FOX 5', 'RedZone']);
    await key('Enter');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 8 });
  });

  it("PPV events come from the PPV channels' names: fights with the games, the rest under PPV", async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('Big Fight vs. Other Guy')).toBeTruthy();
    expect(screen.queryByText('Dirt Track 100 at Fonda')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PPV' }));
    expect(await screen.findByText('Dirt Track 100 at Fonda')).toBeTruthy();
    // Its list: the channel itself, and its category to browse.
    fireEvent.click(screen.getAllByRole('button', { name: /Watch/ })[0]);
    expect(await screen.findByText('Browse PAY PER VIEW 2 in Live TV')).toBeTruthy();
    await key('Enter');
    expect(onWatch).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 21 });
  });

  it('a game only on a streaming service says so and plays nothing', async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('MLB.tv (streaming only)')).toBeTruthy();
    await key('ArrowDown');
    await key('Enter');
    expect(await screen.findByText(/Not in your channels right now/)).toBeTruthy();
    await key('Enter');
    expect(onWatch).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('smc-live-play')).toBeNull();
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
  });

  it("a game on Peacock, with Peacock feeds on the box, says to check the guide; its list shows the feed the guide confirms", async () => {
    more.games = [{ id: 'mlb:3', league: 'mlb', leagueLabel: 'MLB', name: 'DET @ CHW', start: soon, state: 'pre', detail: '',
      home: team('White Sox', 'Chicago'), away: team('Tigers', 'Detroit'), networks: ['Peacock'] }];
    more.channels = [[31, 'US| PEACOCK 01', 'US| PEACOCK'], [32, 'US| PEACOCK 02', 'US| PEACOCK']];
    const held = heldGuide();
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('Peacock — press Watch to check your guide')).toBeTruthy();
    // A service with no feeds on the box still says so.
    expect(screen.getByText('MLB.tv (streaming only)')).toBeTruthy();
    fireEvent.click(button(rowOf('White Sox'), 'Watch'));
    expect(await screen.findByText('Checking the guide…')).toBeTruthy();
    expect(screen.queryByText('US| PEACOCK 02')).toBeNull();
    const feed = { line, stream: { stream_id: 32, name: 'US| PEACOCK 02' }, score: 95, via: 'game', note: 'Guide: Tigers at White Sox', guide: 'yes' };
    await act(async () => { held.release([feed]); await Promise.resolve(); });
    expect(await screen.findByText('Guide: Tigers at White Sox')).toBeTruthy();
    expect(screen.queryByText('US| PEACOCK 01')).toBeNull();
    await key('Enter');
    expect(onWatch).toHaveBeenCalledWith('mlb:3');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 32 });
  });

  it('a playoff game lists no zone or team channel', async () => {
    more.games = [{ id: 'mlb:4', league: 'mlb', leagueLabel: 'MLB', name: 'DET @ CHW', start: soon, state: 'pre', detail: '',
      home: team('White Sox', 'Chicago'), away: team('Tigers', 'Detroit'), networks: ['TBS'], postseason: true, round: 'AL Wild Card - Game 1' }];
    more.channels = [
      [41, 'MLB Zone', 'MLB ZONE'],
      [42, 'MLB: Chicago White Sox', 'MLB TEAMS'],
      [43, 'EVENT 03: Detroit Tigers @ Chicago White Sox', 'US| LIVE EVENTS'],
    ];
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('EVENT 03: Detroit Tigers @ Chicago White Sox')).toBeTruthy();
    fireEvent.click(button(rowOf('White Sox'), 'Watch'));
    expect(await screen.findByText('Game channel')).toBeTruthy();
    const items = Array.from(document.querySelectorAll('[data-gd-pick]')).map((b) => b.textContent ?? '');
    expect(items.filter((x) => /MLB Zone|MLB: Chicago White Sox/.test(x))).toEqual([]);
    expect(screen.queryByText('Zone channel')).toBeNull();
    expect(screen.queryByText('Team channel')).toBeNull();
    expect(screen.queryByText('Zone channels — every game of the league, not just this one')).toBeNull();
  });

  it('"Remind me" on a game only a network\'s name matched stores no channel', async () => {
    more.games = [{ id: 'nfl:5', league: 'nfl', leagueLabel: 'NFL', name: 'DET @ MIN', start: soon, state: 'pre', detail: '',
      home: team('Vikings', 'Minnesota'), away: team('Lions', 'Detroit'), networks: ['FOX'] }];
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    // FOX 5 is only a guess until its guide is read: the row picks nothing.
    expect(await screen.findByText('FOX — press Watch to check your guide')).toBeTruthy();
    fireEvent.click(button(rowOf('Vikings'), 'Remind me'));
    const stored = JSON.parse(localStorage.getItem('smc-game-reminders-v1') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 'nfl:5' });
    expect(stored[0].channel).toBeUndefined();
  });
});
