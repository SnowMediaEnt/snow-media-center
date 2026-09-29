import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const dream = { host: 'http://dstreams.xyz:8080', username: 'ds', password: 'secret-ds', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const vibez = { host: 'https://strmz.xyz', username: 'vb', password: 'secret-vb', output: 'm3u8' as const, serverLabel: 'Vibez' };
const saved = vi.hoisted(() => ({ list: [] as unknown[] }));
const toastFn = vi.hoisted(() => vi.fn());
const team = (short: string, location: string) => ({ short, name: `${location} ${short}`, location, abbr: '', logo: null, score: null });

vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  const chan = (l: object, id: number, name: string, cat: string) => real.sportsChannel(l as never, { stream_id: id, name } as never, cat)!;
  return {
    ...real,
    fetchGames: async () => [
      { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
        home: team('Packers', 'Green Bay'), away: team('Bears', 'Chicago'), networks: ['FOX'] },
    ],
    // What the box would read from every line it was asked about; the same channel is on both services.
    loadSportsChannels: async (lines: Array<{ host: string }>) => lines.flatMap((l, i) => [
      chan(l, 100 + i, 'NFL 01: Bears vs Packers', 'NFL'),
    ]),
    checkGuides: () => Promise.resolve([]),
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => saved.list }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastFn }) }));

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); toastFn.mockClear(); saved.list = []; });

describe('GameDaySection with several signed-in lines', () => {
  it('merges every line and tags each link with its service, active line first', async () => {
    saved.list = [{ id: 'a', ...vibez }];
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={dream as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    // The row shows the best link (the active line's) with its tag and a +1 for the other line.
    expect(await screen.findByText('+1')).toBeTruthy();
    await key('Enter');
    const names = await screen.findAllByText('NFL 01: Bears vs Packers');
    expect(names.length).toBeGreaterThanOrEqual(2);
    const tags = Array.from(document.querySelectorAll('[data-gd-pick] [aria-label^="On "]')).map((e) => e.textContent);
    // Brand spelling, once per service, the active one first.
    expect(tags).toEqual(['DreamStreams', 'Vibez']);
  });

  it('shows no tags with one line', async () => {
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={dream as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(document.querySelectorAll('[aria-label^="On "]').length).toBe(0);
    expect(screen.queryByText('DreamStreams')).toBeNull();
  });

  it("plays a link from the other line on that line, without switching the account", async () => {
    saved.list = [{ id: 'a', ...vibez }];
    const { default: GameDay } = await import('./GameDaySection');
    const onWatch = vi.fn();
    render(<GameDay creds={dream as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
    expect(await screen.findByText('+1')).toBeTruthy();
    await key('Enter');
    await screen.findAllByText('Game channel');
    await key('ArrowDown');
    await key('Enter');
    const handed = JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}');
    expect(handed).toMatchObject({ host: vibez.host, username: 'vb', streamId: 101 });
    // Only the line's id travels: never a password.
    expect(JSON.stringify(handed)).not.toContain('secret');
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
    expect(toastFn).toHaveBeenCalledWith({ title: 'Playing on Vibez' });
  });

  it('a link from the active line plays with no "Playing on" notice', async () => {
    saved.list = [{ id: 'a', ...vibez }];
    const { default: GameDay } = await import('./GameDaySection');
    render(<GameDay creds={dream as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
    expect(await screen.findByText('+1')).toBeTruthy();
    await key('Enter');
    await screen.findAllByText('Game channel');
    await key('Enter');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ host: dream.host, streamId: 100 });
    expect(toastFn).not.toHaveBeenCalled();
  });
});
