import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));

const line = { host: 'http://dstreams.xyz:8080', username: 'u', password: 'p' } as never;
const ch = (stream_id: number, name: string) => ({ line, stream: { stream_id, name } as never });
const team = (short: string, location: string, name: string) => ({ short, location, name, abbr: '', logo: null, score: null });

describe('gameDay', () => {
  it('puts the event channel first, then the networks, and ignores the city on its own', async () => {
    const { channelsForGame } = await import('./gameDay');
    const game = {
      id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: '', state: 'pre' as const, detail: '',
      home: team('Packers', 'Green Bay', 'Green Bay Packers'), away: team('Bears', 'Chicago', 'Chicago Bears'),
      networks: ['FOX', 'NFL Net', 'Peacock'],
    };
    const chans = [
      ch(1, 'US| FOX 32 Chicago HD'),
      ch(2, 'NFL 03: Chicago Bears vs Green Bay Packers'),
      ch(3, 'US| NFL Network FHD'),
      ch(4, 'US| Chicago News'),
      ch(5, 'US| Fox Sports 1'),
      ch(6, 'US| FOX 5 New York'),
    ];
    const got = (await import('./gameDay')).channelsForGame(game, chans).map((c) => c.stream.stream_id);
    expect(got[0]).toBe(2);
    expect(got).toContain(3);
    expect(got).toContain(1);
    expect(got).not.toContain(4);
    expect(got).not.toContain(5);
    expect(got).toContain(6);
    expect(channelsForGame(game, chans).find((c) => c.stream.stream_id === 2)?.via).toBe('event');
  });

  it('weighs categories: sports first, networks next, the rest never', async () => {
    const { categoryWeight } = await import('./gameDay');
    expect(categoryWeight('US| NFL SUNDAY TICKET')).toBe(2);
    expect(categoryWeight('PPV EVENTS')).toBe(2);
    expect(categoryWeight('US| LOCALS')).toBe(1);
    expect(categoryWeight('US| KIDS')).toBe(0);
  });

  it('labels kickoff times for today and tomorrow', async () => {
    const { kickoffLabel } = await import('./gameDay');
    const now = new Date(2026, 8, 27, 10, 0);
    expect(kickoffLabel(new Date(2026, 8, 27, 13, 0).toISOString(), now)).not.toMatch(/Tomorrow/);
    expect(kickoffLabel(new Date(2026, 8, 28, 13, 0).toISOString(), now)).toMatch(/^Tomorrow /);
  });
});
