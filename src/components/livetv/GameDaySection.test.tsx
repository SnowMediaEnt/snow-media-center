import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
vi.mock('@/lib/gameDay', async (orig) => ({
  ...(await orig<typeof import('@/lib/gameDay')>()),
  fetchGames: async () => [
    { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
      home: { short: 'Packers', name: 'Green Bay Packers', location: 'Green Bay', abbr: 'GB', logo: null, score: null },
      away: { short: 'Bears', name: 'Chicago Bears', location: 'Chicago', abbr: 'CHI', logo: null, score: null }, networks: ['FOX'] },
  ],
  loadSportsChannels: async () => [{ line: { host: 'http://h', username: 'u', password: 'p' }, stream: { stream_id: 9, name: 'NFL 01: Bears vs Packers' } }],
}));
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe('GameDaySection', () => {
  it('lists a game with its channel, and Watch hands that channel to Live TV', async () => {
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={{ host: 'http://h', username: 'u', password: 'p' } as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onWatch).toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ streamId: 9, username: 'u' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('Reminder on')).toBeTruthy();
  });
});
