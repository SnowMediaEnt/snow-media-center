import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const line = { host: 'http://h', username: 'u', password: 'p' };
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
    ],
    scanEventChannels: async () => [],
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });

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
    expect(onWatch).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 7, username: 'u' });
    // Back on the games: Remind me.
    await key('ArrowRight');
    await key('Enter');
    expect(await screen.findByText('Reminder on')).toBeTruthy();
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
