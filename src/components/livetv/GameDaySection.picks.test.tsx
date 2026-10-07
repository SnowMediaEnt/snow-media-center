/**
 * Game Day: the owner's channel picks (the admin app's game_day_channel_edits).
 * A game's list shows an added channel first with "Picked by Snow Media", drops
 * a hidden one and ends with a channel marked down and its ⚠️. The row's Watch
 * pick and a reminder's channel follow the picks (a hidden channel is neither).
 * A table that cannot be read, or is slow, leaves the list as the matching made it.
 */
import { act, configure, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const dream = { host: 'http://dstreams.xyz:8080', username: 'ds', password: 'secret-ds', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const vibez = { host: 'https://strmz.xyz', username: 'vb', password: 'secret-vb', output: 'm3u8' as const, serverLabel: 'Vibez' };
/** `edits`: what the owner's table gives; `mode`: how the read goes (a pick list, never answering, or the real read against a table that errors). */
const world = vi.hoisted(() => ({ saved: [] as unknown[], edits: [] as unknown[], mode: 'rows' as 'rows' | 'pending' | 'real' }));
const team = (short: string, location: string) => ({ short, name: `${location} ${short}`, location, abbr: '', logo: null, score: null });

vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  const chan = (l: object, id: number, name: string, cat: string) => real.sportsChannel(l as never, { stream_id: id, name } as never, cat)!;
  return {
    ...real,
    fetchGames: async () => [
      { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
        home: team('Packers', 'Green Bay'), away: team('Bears', 'Chicago'), networks: ['FOX'] },
      { id: 'nfl:2', league: 'nfl', leagueLabel: 'NFL', name: 'DET @ MIN', start: soon, state: 'pre', detail: '',
        home: team('Vikings', 'Minnesota'), away: team('Lions', 'Detroit'), networks: ['FOX'] },
    ],
    // Every line has the same three channels (the same stream ids): the game's own, a FOX station, and RedZone.
    loadSportsChannels: async (lines: object[]) => lines.flatMap((l) => [
      chan(l, 9, 'NFL 01: Bears vs Packers', 'NFL'),
      chan(l, 7, 'US| FOX 5 New York', 'US| LOCALS'),
      chan(l, 8, 'NFL RedZone', 'NFL ZONE'),
    ]),
    checkGuides: () => Promise.resolve([]),
    fetchGameEdits: (force?: boolean) => (world.mode === 'real'
      ? real.fetchGameEdits(force)
      : world.mode === 'pending' ? new Promise(() => {}) : Promise.resolve(world.edits)),
  };
});
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => world.saved }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false, channelReport: () => null, isCategoryDown: () => false, signalCategory: () => undefined }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    // The owner's table is not there on this database.
    from: () => { throw new Error('relation "game_day_channel_edits" does not exist'); },
  },
}));

// OK plays when it is let go (a held OK opens the channel's menu instead), so OK is pressed and released.
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); if (k === 'Enter') fireEvent.keyUp(window, { key: k }); });

const edit = (over: Record<string, unknown>) => ({ game_id: 'nfl:1', service: 'dstreams.xyz', channel_name: '', sort: 0, ...over });
/** The channels of the open list, top to bottom. */
const listed = (): string[] => Array.from(document.querySelectorAll('[data-gd-pick]')).map((b) => b.querySelector('span.font-semibold')?.textContent ?? '');
const downMarks = (): Element[] => Array.from(document.querySelectorAll('[aria-label="Reported down right now"]'));
const handedOver = () => JSON.parse(sessionStorage.getItem('smc-live-deeplink') || '{}');

async function openFirstGame(creds: object = dream) {
  const { default: GameDay } = await import('./GameDaySection');
  render(<GameDay creds={creds as never} isActive onExitLeft={() => {}} onWatch={() => {}} />);
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  world.saved = []; world.edits = []; world.mode = 'rows';
});

describe('Game Day with the owner\'s picks', () => {
  it('lists an added channel first with "Picked by Snow Media", drops a hidden one, and ends with a down one and its ⚠️', async () => {
    world.edits = [
      edit({ stream_id: 555, channel_name: 'CBS Sports HD', action: 'add', sort: 1 }),
      edit({ stream_id: 9, channel_name: 'NFL 01: Bears vs Packers', action: 'down' }),
      edit({ stream_id: 8, channel_name: 'NFL RedZone', action: 'hide' }),
      // Another game's picks change nothing in this one.
      edit({ game_id: 'nfl:2', stream_id: 7, channel_name: 'US| FOX 5 New York', action: 'hide' }),
    ];
    await openFirstGame();
    // The row's own pick is the owner's.
    expect(await screen.findByText('CBS Sports HD')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('Picked by Snow Media')).toBeTruthy();
    // Picks first, RedZone gone, the channel marked down last.
    expect(listed()).toEqual(['CBS Sports HD', 'US| FOX 5 New York', 'NFL 01: Bears vs Packers']);
    expect(screen.getAllByText('Picked by Snow Media')).toHaveLength(1);
    const items = Array.from(document.querySelectorAll('[data-gd-pick]'));
    expect(items[0].textContent).toContain('Picked by Snow Media');
    // The ⚠️ is the down badge Game Day already has, on the last one only.
    expect(downMarks()).toHaveLength(1);
    expect(items[2].contains(downMarks()[0])).toBe(true);
    expect(items[1].textContent).not.toContain('Picked by Snow Media');
    // OK plays the first: the owner's pick, built from the pick (it is not in the box's list).
    await key('Enter');
    expect(handedOver()).toMatchObject({ host: dream.host, username: 'ds', streamId: 555, name: 'CBS Sports HD' });
    expect(JSON.stringify(handedOver())).not.toContain('secret');
  });

  it('leaves the other game as the matching made it', async () => {
    world.edits = [
      edit({ stream_id: 555, channel_name: 'CBS Sports HD', action: 'add', sort: 1 }),
      edit({ stream_id: 7, channel_name: 'US| FOX 5 New York', action: 'hide' }),
    ];
    await openFirstGame();
    expect(await screen.findByText('CBS Sports HD')).toBeTruthy();
    await key('ArrowDown');
    await key('Enter');
    // DET @ MIN: its FOX station is still there, no pick.
    expect(await screen.findByText('Zone channel')).toBeTruthy();
    expect(listed()).toEqual(['US| FOX 5 New York', 'NFL RedZone']);
    expect(screen.queryByText('Picked by Snow Media')).toBeNull();
  });

  it("a hidden channel is never the row's Watch pick or a reminder's channel", async () => {
    world.saved = [{ id: 'a', ...vibez }];
    world.edits = [edit({ stream_id: 9, channel_name: 'NFL 01: Bears vs Packers', action: 'hide' })];
    await openFirstGame();
    // CHI @ GB: with its own channel hidden on Dreamstreams, the row goes on
    // to the same channel on Vibez (never to the FOX station, a guess until
    // its guide is read).
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    expect(screen.queryByText('US| FOX 5 New York')).toBeNull();
    await key('ArrowRight');
    await key('Enter');
    expect(await screen.findByText('Reminder on')).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem('smc-game-reminders-v1') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].channel).toMatchObject({ streamId: 9, username: 'vb' });
  });

  it('adds the pick on each line of its service only, and keeps the service tags', async () => {
    world.saved = [{ id: 'a', ...vibez }];
    world.edits = [
      edit({ stream_id: 555, channel_name: 'CBS Sports HD', action: 'add', sort: 1 }),
      edit({ service: 'strmz.xyz', stream_id: 512, channel_name: 'CBS Sports Vibez', action: 'add', sort: 2 }),
    ];
    await openFirstGame();
    // Both lines' game channels and both picks are in (+3 more on CHI @ GB)
    // before the list is opened; FOX 5 waits for its guide, RedZone for the list.
    expect(await screen.findByText('+3')).toBeTruthy();
    await key('Enter');
    expect(await screen.findAllByText('Picked by Snow Media')).toHaveLength(2);
    expect(listed().slice(0, 2)).toEqual(['CBS Sports HD', 'CBS Sports Vibez']);
    const tags = Array.from(document.querySelectorAll('[data-gd-pick] [aria-label^="On "]')).map((e) => e.textContent);
    expect(tags.slice(0, 2)).toEqual(['DreamStreams', 'Vibez']);
    // Playing the second plays it on Vibez, on its own login.
    await key('ArrowDown');
    await key('Enter');
    expect(handedOver()).toMatchObject({ host: vibez.host, username: 'vb', streamId: 512 });
  });

  it('shows a channel the owner marked down with the ⚠️ in the row when it is all there is', async () => {
    world.edits = [
      edit({ stream_id: 9, channel_name: 'NFL 01: Bears vs Packers', action: 'down' }),
      edit({ stream_id: 7, channel_name: 'US| FOX 5 New York', action: 'hide' }),
      edit({ stream_id: 8, channel_name: 'NFL RedZone', action: 'hide' }),
    ];
    await openFirstGame();
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    expect(downMarks()).toHaveLength(1);
  });

  it('shows the games and their channels as the matching made them while the read is still going', async () => {
    world.mode = 'pending';
    await openFirstGame();
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(listed()).toEqual(['NFL 01: Bears vs Packers', 'US| FOX 5 New York', 'NFL RedZone']);
    expect(screen.queryByText('Picked by Snow Media')).toBeNull();
    expect(downMarks()).toHaveLength(0);
  });

  it('shows the list as the matching made it when the table cannot be read', async () => {
    world.mode = 'real';
    await openFirstGame();
    expect(await screen.findByText('NFL 01: Bears vs Packers')).toBeTruthy();
    await key('Enter');
    expect(await screen.findByText('Game channel')).toBeTruthy();
    expect(listed()).toEqual(['NFL 01: Bears vs Packers', 'US| FOX 5 New York', 'NFL RedZone']);
    expect(screen.queryByText('Picked by Snow Media')).toBeNull();
    expect(downMarks()).toHaveLength(0);
    // Playing works as it always did.
    await key('Enter');
    expect(handedOver()).toMatchObject({ streamId: 9 });
  });
});
