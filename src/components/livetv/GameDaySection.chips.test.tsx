import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
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
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false, channelReport: () => null, isCategoryDown: () => false, signalCategory: () => undefined, openWhenFresh: (_h: string, go: (f: null) => void) => go(null) }));
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

describe('GameDaySection chips under the remote', () => {
  const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });
  const classes = (el: HTMLElement | undefined) => (el?.className ?? '').split(/\s+/);

  it('the selected chip, when focused, drops its solid gold so the gold focus ring shows on it', async () => {
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    await waitFor(() => expect(rows().length).toBe(4));
    const all = () => document.querySelector<HTMLElement>('[data-howto="gd.chips"] button');
    // Selected, not focused: the solid gold chip.
    expect(all()?.getAttribute('data-focused')).toBe('false');
    expect(classes(all() ?? undefined)).toContain('bg-brand-gold');

    key('ArrowUp'); // rows -> chips: "All", the selected one, has the remote
    expect(all()?.getAttribute('data-focused')).toBe('true');
    expect(classes(all() ?? undefined)).toContain('tv-ring');
    // A gold ring on a gold fill is invisible: no solid gold under the ring,
    // the selection kept in a gold tint and gold text.
    expect(classes(all() ?? undefined)).not.toContain('bg-brand-gold');
    expect(classes(all() ?? undefined)).toContain('bg-brand-gold/25');
    expect(classes(all() ?? undefined)).toContain('text-brand-gold');

    // Another chip under the remote: white, ring; the selected one back to gold.
    key('ArrowRight');
    const second = document.querySelectorAll<HTMLElement>('[data-howto="gd.chips"] button')[1];
    expect(second.getAttribute('data-focused')).toBe('true');
    expect(classes(second)).toContain('bg-white');
    expect(classes(all() ?? undefined)).toContain('bg-brand-gold');
  });

  it('chips that wrap onto rows: Up/Down move row to row, Down from the last row reaches the games, Up from the first leaves', async () => {
    // Two chips a row, as a narrow screen wraps them: All PPV / International More Soccer / MLS.
    const rect = (top: number, left: number) => ({ top, left, width: 90, height: 30, bottom: top + 30, right: left + 90, x: left, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const i = Number(this.getAttribute('data-gd-chip'));
      return (this.hasAttribute('data-gd-chip') ? rect(Math.floor(i / 2) * 40, (i % 2) * 100) : rect(0, 0)) as DOMRect;
    });
    try {
      const { default: GameDay } = await import('./GameDaySection');
      const onExitUp = vi.fn();
      render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onExitUp={onExitUp} onWatch={() => {}} />);
      await waitFor(() => expect(rows().length).toBe(4));
      const chips = () => Array.from(document.querySelectorAll<HTMLElement>('[data-howto="gd.chips"] button'));
      expect(chips().map((b) => b.textContent)).toEqual(['All', 'PPV', 'International', 'More Soccer', 'MLS']);
      const focusedChip = () => chips().find((b) => b.getAttribute('data-focused') === 'true')?.textContent ?? null;
      const focusedRow = () => document.querySelector('[data-gd-row][data-focused="true"]')?.getAttribute('data-gd-row') ?? null;

      key('ArrowUp'); // the games -> the chips
      expect(focusedChip()).toBe('All');
      key('ArrowDown'); // the row below, not the games
      expect(focusedChip()).toBe('International');
      expect(focusedRow()).toBeNull();
      key('ArrowRight'); // along the row
      expect(focusedChip()).toBe('More Soccer');
      key('ArrowDown'); // the last row has one chip: that one
      expect(focusedChip()).toBe('MLS');
      key('ArrowDown'); // past the last row: the games
      expect(focusedChip()).toBeNull();
      expect(focusedRow()).toBe('0');
      key('ArrowUp'); // the first game: back to the chip it came from
      expect(focusedChip()).toBe('MLS');
      key('ArrowUp');
      expect(focusedChip()).toBe('International');
      key('ArrowUp');
      expect(focusedChip()).toBe('All');
      expect(onExitUp).not.toHaveBeenCalled();
      key('ArrowUp'); // the first row: Up leaves the chips
      expect(onExitUp).toHaveBeenCalledTimes(1);
      // Left/Right still go chip to chip, on to the next row at a row's end.
      key('ArrowRight');
      key('ArrowRight');
      expect(focusedChip()).toBe('International');
      key('ArrowLeft');
      expect(focusedChip()).toBe('PPV');
      // OK picks it.
      key('Enter');
      expect(rows()).toHaveLength(0);
      expect(document.body.textContent).toContain('No PPV events on your channels today');
    } finally {
      spy.mockRestore();
    }
  });
});
