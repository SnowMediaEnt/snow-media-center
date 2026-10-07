/**
 * Game Day: hold OK on a channel in a game's list opens Live TV's short menu
 * to report it. The report is for that link's own line and stream (a link can
 * come from another signed-in line), "channel down" puts the ⚠️ on that
 * channel, and the ticket carries no login. A short press of OK still plays.
 */
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const dream = { host: 'http://dstreams.xyz:8080', username: 'ds', password: 'secret-ds', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const vibez = { host: 'https://strmz.xyz', username: 'vb', password: 'secret-vb', output: 'm3u8' as const, serverLabel: 'Vibez' };
const saved = vi.hoisted(() => ({ list: [] as unknown[] }));
const spy = vi.hoisted(() => ({ signal: vi.fn(), invoke: vi.fn(async () => ({ data: null, error: null })), toast: vi.fn(), down: new Set<string>() }));
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
    // The same channel on both services, under different stream ids.
    loadSportsChannels: async (lines: Array<{ host: string }>) => lines.flatMap((l, i) => [
      chan(l, 100 + i, 'NFL 01: Bears vs Packers', 'NFL'),
    ]),
    checkGuides: () => Promise.resolve([]),
  };
});
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => saved.list,
  // The panel's answer for the line's connections (never a network call here).
  authenticate: async () => ({ user_info: { username: 'vb', password: 'secret-vb', active_cons: '1', max_connections: '2' } }),
}));
vi.mock('@/lib/channelStatus', () => ({
  useDownChannels: () => spy.down,
  isChannelDown: (set: Set<string>, host: string, id: number) => set.has(`${host}|${id}`),
  channelReport: (set: Set<string>, host: string, id: number) => (set.has(`${host}|${id}`) ? 'down' : set.has(`${host}|buf:${id}`) ? 'buffering' : null),
  isCategoryDown: () => false,
  signalChannel: spy.signal,
  signalCategory: vi.fn(),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: spy.toast }), toast: spy.toast }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: spy.invoke },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));

const down = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const tap = (k: string) => { down(k); up(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const holdOk = async () => { down('Enter'); await sleep(700); up('Enter'); await sleep(20); };
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? '';

async function openList(onWatch = vi.fn(), onNavigate = vi.fn()) {
  saved.list = [{ id: 'a', ...vibez }];
  const { default: GameDay } = await import('./GameDaySection');
  render(<GameDay creds={dream as never} isActive onExitLeft={() => {}} onWatch={onWatch} onNavigate={onNavigate} />);
  expect(await screen.findByText('+1')).toBeTruthy();
  tap('Enter');
  await screen.findAllByText('Game channel');
  return { onWatch, onNavigate };
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  spy.signal.mockClear(); spy.invoke.mockClear(); spy.toast.mockClear(); spy.down = new Set();
  saved.list = [];
});

describe('Game Day: hold OK on a channel to report it', () => {
  it('opens the short menu (Report, Cancel) for the highlighted link, without playing it', async () => {
    const { onWatch } = await openList();
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('Report Channel'));
    expect(dialogText()).toContain('NFL 01: Bears vs Packers');
    expect(dialogText()).not.toContain('Record');
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
    expect(onWatch).not.toHaveBeenCalled();
  });

  it("reports the other line's link with that line and stream, and marks it down for the other boxes", async () => {
    await openList();
    tap('ArrowDown'); // the Vibez copy (stream 101)
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('Report Channel'));
    // OK let go: the menu is armed. Report Channel → Channel down.
    tap('Enter');
    await waitFor(() => expect(dialogText()).toContain('Channel down'));
    tap('Enter');
    await waitFor(() => expect(spy.invoke).toHaveBeenCalled());
    // The report goes with that link's own line (its username and connections go to the Hub).
    expect(spy.signal).toHaveBeenCalledWith(vibez.host, 101, 'NFL 01: Bears vs Packers', 'down', expect.objectContaining({ username: vibez.username }));
    const body = (spy.invoke.mock.calls[0] as unknown as [string, { body: { message: string } }])[1].body;
    expect(body.message).toContain('Channel ID: 101');
    expect(body.message).toContain('Service: Vibez');
    expect(body.message).toContain('Issue: Channel down');
    // That line's username and connections (the owner asked for them), never its password.
    expect(body.message).toContain('Line: vb (Vibez) · connections 1/2');
    expect(JSON.stringify(spy.invoke.mock.calls)).not.toContain('secret');
  });

  it('a channel already showing ⚠️ offers "It’s working now" and clears it on its own line', async () => {
    spy.down = new Set([`${vibez.host}|101`]);
    await openList();
    // Down links sort after working ones: the Vibez copy is second.
    tap('ArrowDown');
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('working now'));
    tap('Enter');
    expect(spy.signal).toHaveBeenCalledWith(vibez.host, 101, 'NFL 01: Bears vs Packers', 'clear');
  });

  it('one Back closes the menu only; the channel list stays; a short press then plays', async () => {
    const { onWatch } = await openList();
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('Report Channel'));
    down('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getAllByText('Game channel').length).toBeGreaterThan(0);
    expect(onWatch).not.toHaveBeenCalled();
    tap('Enter');
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ host: dream.host, streamId: 100 });
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
  });

  it('the list says how to report', async () => {
    await openList();
    expect(screen.getByText('Hold OK on a channel to report it')).toBeTruthy();
  });
});

describe('Game Day: a link reported buffering or down asks before it plays', () => {
  const warning = () => document.querySelector('[data-channel-warning]');

  it('buffering: listed after the working copy, amber, and OK asks first; Pick another keeps the list', async () => {
    spy.down = new Set([`${dream.host}|buf:100`]);
    const { onWatch } = await openList();
    // The working Vibez copy leads; the buffering one is second.
    tap('ArrowDown');
    expect(document.querySelector('[data-gd-pick="1"] [aria-label="Reported buffering recently"]')).not.toBeNull();
    tap('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('buffering'));
    expect(document.body.textContent).toContain('Reported buffering recently — it may not play well.');
    tap('Enter'); // the highlight starts on Pick another
    expect(warning()).toBeNull();
    expect(sessionStorage.getItem('smc-live-deeplink')).toBeNull();
    expect(onWatch).not.toHaveBeenCalled();
    expect(screen.getAllByText('Game channel').length).toBeGreaterThan(0);
  });

  it('Watch anyway hands it to Live TV', async () => {
    spy.down = new Set([`${dream.host}|100`]);
    const { onWatch } = await openList();
    tap('ArrowDown');
    tap('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('down'));
    tap('ArrowLeft');
    tap('Enter');
    expect(warning()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}')).toMatchObject({ host: dream.host, streamId: 100 });
    expect(onWatch).toHaveBeenCalledWith('nfl:1');
  });
});
