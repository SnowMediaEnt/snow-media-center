import { configure, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const line = { host: 'http://h', username: 'u', password: 'p' };
const team = (short: string, location: string, abbr = '') => ({ short, name: short, location, abbr, logo: null, score: null });
const base = { start: soon, state: 'pre', detail: '', networks: ['FS1'] };

vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  return {
    ...real,
    fetchGames: async () => [
      { ...base, id: 'friendly:1', league: 'friendly', leagueLabel: 'Friendly', name: 'Chile @ USA', home: team('USA', 'United States', 'USA'), away: team('Chile', 'Chile', 'CHI') },
      { ...base, id: 'unl:1', league: 'unl', leagueLabel: 'UEFA Nations League', name: 'England @ Czechia', home: team('Czechia', 'Czechia', 'CZE'), away: team('England', 'England', 'ENG') },
      { ...base, id: 'facup:1', league: 'facup', leagueLabel: 'FA Cup', name: 'Derby @ Leeds', home: team('Leeds', 'Leeds'), away: team('Derby', 'Derby') },
      { ...base, id: 'mls:1', league: 'mls', leagueLabel: 'MLS', name: 'Sounders @ Timbers', home: team('Timbers', 'Portland'), away: team('Sounders', 'Seattle') },
    ],
    loadSportsChannels: async () => [real.sportsChannel(line as never, { stream_id: 1, name: 'US| USA vs Chile' } as never, 'US| SOCCER')!],
    checkGuides: () => Promise.resolve([]),
    fetchGameEdits: async () => [],
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });

const chip = (name: string): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === name);
const rows = (): string[] => Array.from(document.querySelectorAll<HTMLElement>('[data-gd-row]')).map((r) => r.textContent ?? '');

describe('GameDaySection chips for soccer', () => {
  it('files national teams under International and cups under More Soccer, each game still labelled with its own competition', async () => {
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await waitFor(() => expect(rows().length).toBe(4));
    // One chip for the internationals, one for the other soccer; the big league on its own.
    expect(chip('International')).toBeTruthy();
    expect(chip('More Soccer')).toBeTruthy();
    expect(chip('MLS')).toBeTruthy();
    expect(chip('Friendly')).toBeUndefined();
    expect(chip('UEFA Nations League')).toBeUndefined();
    expect(rows().some((r) => r.includes('Friendly') && r.includes('Chile@ USA') && r.includes('US| USA vs Chile'))).toBe(true);
    expect(rows().some((r) => r.includes('UEFA Nations League') && r.includes('England@ Czechia'))).toBe(true);

    fireEvent.click(chip('International')!);
    expect(rows()).toHaveLength(2);
    expect(rows().join(' ')).toContain('Chile@ USA');
    expect(rows().join(' ')).toContain('England@ Czechia');
    expect(rows().join(' ')).not.toContain('Derby@ Leeds');

    fireEvent.click(chip('More Soccer')!);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('FA Cup');

    fireEvent.click(chip('MLS')!);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Timbers');
  });
});
