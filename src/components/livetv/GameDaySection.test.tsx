import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The screen loads its games and channels, then lays out up to 80 rows: on a
// busy test machine the first render can pass the default 1 s wait.
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
/** What the guide check answers: a test may hold it back and hand it over later. */
const guide = vi.hoisted(() => ({ answer: null as null | (() => Promise<unknown[]>) }));
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
    ],
    loadSportsChannels: async () => [
      real.sportsChannel(line as never, { stream_id: 9, name: 'NFL 01: Bears vs Packers' } as never, 'NFL')!,
      real.sportsChannel(line as never, { stream_id: 7, name: 'US| FOX 5 New York' } as never, 'US| LOCALS')!,
      real.sportsChannel(line as never, { stream_id: 3, name: 'USA | A&E' } as never, 'USA')!,
      // The provider's PPV names: the event, then its date and time Eastern.
      real.sportsChannel(line as never, { stream_id: 21, name: `PPV EVENT 02: Dirt Track 100 at Fonda (${eastern(3)})`, category_id: 50 } as never, 'PAY-PER-VIEW 2')!,
      real.sportsChannel(line as never, { stream_id: 22, name: `PPV EVENT 13: Big Fight vs. Other Guy (${eastern(4)})`, category_id: 50 } as never, 'PAY-PER-VIEW 2')!,
    ],
    checkGuides: () => (guide.answer ? guide.answer() : Promise.resolve([])),
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); guide.answer = null; });

describe('GameDaySection', () => {
  it("Watch lists the game's channels; OK plays the one picked", async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    // The list: the game channel first, then FOX (a FOX station).
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(screen.getByText('National TV')).toBeTruthy();
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

  it("the guide's answer arriving later leaves the highlight on the channel it was on", async () => {
    const real = await vi.importActual<typeof import('@/lib/gameDay')>('@/lib/gameDay');
    let release: (links: unknown[]) => void = () => {};
    guide.answer = () => new Promise((r) => { release = r; });
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    await key('ArrowDown');
    // FOX 5 is highlighted; now the guide confirms another channel, which goes first.
    const confirmed = { line, stream: { stream_id: 3, name: 'USA | A&E' }, score: 95, via: 'network', note: 'Guide: Bears at Packers' };
    await act(async () => { release([confirmed]); await Promise.resolve(); });
    expect(await screen.findByText('Guide: Bears at Packers')).toBeTruthy();
    expect(real.LINK_LABELS.network).toBe('National TV');
    await key('Enter');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 7 });
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
});
