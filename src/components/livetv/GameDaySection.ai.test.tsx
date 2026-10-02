/**
 * Game Day's search on screen: what the provider's daily scan found is listed
 * under "Found by search — may not be this game" (between the game's channels
 * and "Not confirmed by the guide"); the guide and the owner's picks still
 * have the last word; only a high-confidence one can be the row's Watch pick;
 * a held OK offers "Not this game". The scan goes in the background, and
 * nothing is asked with the flag off or on a Kids profile.
 */
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 4000 });

const soon = new Date(Date.now() + 60 * 60_000).toISOString();
const later = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
const line = { host: 'http://h', username: 'u', password: 'secret-pw' };
const team = (short: string, location: string) => ({ short, name: `${location} ${short}`, location, abbr: '', logo: null, score: null });

const st = vi.hoisted(() => ({
  flag: true,
  kids: null as null | string,
  guide: [] as unknown[],
  edits: [] as unknown[],
  cached: null as null | Record<string, unknown>,
  invoke: vi.fn(),
  track: vi.fn(),
}));

vi.mock('@/lib/gameDay', async (orig) => {
  const real = await orig<typeof import('@/lib/gameDay')>();
  const chan = (id: number, name: string, cat: string) => real.sportsChannel(line as never, { stream_id: id, name } as never, cat)!;
  return {
    ...real,
    fetchGames: async () => [
      { id: 'nfl:1', league: 'nfl', leagueLabel: 'NFL', name: 'CHI @ GB', start: soon, state: 'pre', detail: '',
        home: team('Packers', 'Green Bay'), away: team('Bears', 'Chicago'), networks: ['FOX'] },
      { id: 'ncaah:401', league: 'ncaah', leagueLabel: 'NCAAH', name: 'BU @ MICH', start: later, state: 'pre', detail: '',
        home: team('Wolverines', 'Michigan'), away: team('Terriers', 'Boston University'), networks: [] },
      { id: 'ncaah:402', league: 'ncaah', leagueLabel: 'NCAAH', name: 'UNH @ UVM', start: later, state: 'pre', detail: '',
        home: team('Catamounts', 'Vermont'), away: team('Wildcats', 'New Hampshire'), networks: [] },
    ],
    loadSportsChannels: async () => [
      chan(9, 'NFL 01: Bears vs Packers', 'NFL'),
      chan(7, 'US| FOX 5 New York', 'US| LOCALS'),
      chan(5, 'EVENT 05', 'LIVE EVENTS'),
      chan(31, 'B1G+ 03', 'B1G+'),
      chan(32, 'B1G+ 07', 'B1G+'),
      chan(41, 'LIVE EVENT 09', 'LIVE EVENTS'),
    ],
    checkGuides: () => Promise.resolve(st.guide),
    fetchGameEdits: async () => st.edits,
    // A's line-up hash, fixed here so a test can say the stored answer is fresh.
    lineupHash: () => 'HASH',
  };
});
vi.mock('@/lib/gameDayAi', async (orig) => ({ ...(await orig<typeof import('@/lib/gameDayAi')>()), lineupHash: () => 'HASH' }));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => ({ enabled: st.flag, loading: false }) }));
vi.mock('@/lib/kidsFilter', async (orig) => ({ ...(await orig<typeof import('@/lib/kidsFilter')>()), kidsLevel: () => st.kids }));
vi.mock('@/lib/xtream', async (orig) => ({ ...(await orig<typeof import('@/lib/xtream')>()), loadSavedAccounts: async () => [] }));
vi.mock('@/lib/channelStatus', () => ({ useDownChannels: () => new Set<string>(), isChannelDown: () => false, signalChannel: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ trackEvent: st.track, startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'dev-1' }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: st.invoke },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));

const freshAnswer = (matches: Record<string, unknown[]>, hash = 'HASH', ago = 60_000) => ({
  ok: true, day: 'today', lineup_hash: hash, scanned_at: new Date(Date.now() - ago).toISOString(), matches, learned: [],
});
const MATCHES = {
  'nfl:1': [{ stream_id: 5, name: 'EVENT 05', confidence: 'high', source: 'ai' }],
  'ncaah:401': [{ stream_id: 31, name: 'B1G+ 03', confidence: 'high', source: 'ai' }],
  'ncaah:402': [{ stream_id: 41, name: 'LIVE EVENT 09', confidence: 'medium', source: 'ai' }],
};
const ops = (op: string) => st.invoke.mock.calls.filter((c) => c[0] === 'game-day-match' && c[1]?.body?.op === op).map((c) => c[1].body);

const press = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
const release = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const tap = (k: string) => { press(k); release(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const holdOk = async () => { press('Enter'); await sleep(700); release('Enter'); await sleep(20); };
const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? '';
const rowOf = (text: string): HTMLElement =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-gd-row]')).find((r) => r.textContent?.includes(text))!;
const SEARCH_HEADING = 'Found by search — may not be this game';
const UNCONFIRMED_HEADING = 'Not confirmed by the guide — may not have this game';

async function renderGameDay() {
  const { default: GameDay } = await import('./GameDaySection');
  const onWatch = vi.fn();
  render(<GameDay creds={line as never} isActive onExitLeft={() => {}} onWatch={onWatch} />);
  await screen.findByText('NFL 01: Bears vs Packers');
  return { onWatch };
}
/** Opens the NFL game's list (the first row) and waits for what was found. */
async function openNfl() {
  await renderGameDay();
  if (st.flag && !st.kids) await waitFor(() => expect(ops('cached').length).toBeGreaterThan(0));
  await sleep(30);
  tap('Enter');
  await screen.findByText('Game channel');
}

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Element.prototype.scrollIntoView = vi.fn();
  st.flag = true; st.kids = null; st.guide = []; st.edits = []; st.cached = freshAnswer(MATCHES);
  st.track.mockClear();
  st.invoke.mockReset();
  st.invoke.mockImplementation(async (_fn: string, opts: { body: { op: string } }) => {
    if (opts.body.op === 'cached') return { data: st.cached, error: null };
    if (opts.body.op === 'scan') return { data: { ok: true, scanned: true }, error: null };
    return { data: { ok: true }, error: null };
  });
});

describe('Game Day: found by search', () => {
  it('lists a found channel under its own heading, between the game\'s channels and "Not confirmed by the guide"', async () => {
    await openNfl();
    await screen.findByText('EVENT 05');
    const text = document.querySelector('[data-howto="gd.links"]')!.textContent!;
    const at = (s: string) => text.indexOf(s);
    expect(at('NFL 01: Bears vs Packers')).toBeGreaterThanOrEqual(0);
    expect(at('NFL 01: Bears vs Packers')).toBeLessThan(at(SEARCH_HEADING));
    expect(at(SEARCH_HEADING)).toBeLessThan(at('EVENT 05'));
    expect(at('EVENT 05')).toBeLessThan(at(UNCONFIRMED_HEADING));
    expect(at(UNCONFIRMED_HEADING)).toBeLessThan(at('US| FOX 5 New York'));
    // The found channel says so where the others say what they are.
    expect(text).toContain('Found by search');
  });

  it('only reads the stored answer when it is fresh for this line-up: no scan', async () => {
    await openNfl();
    expect(ops('cached')[0]).toEqual({ op: 'cached', host: 'h' });
    expect(ops('scan')).toHaveLength(0);
  });

  it('sends the scan in the background when the answer is from another line-up, then reads it again', async () => {
    st.cached = freshAnswer({}, 'OTHER');
    await renderGameDay();
    await waitFor(() => expect(ops('scan')).toHaveLength(1));
    const scan = ops('scan')[0];
    expect(scan).toMatchObject({ op: 'scan', host: 'h', lineup_hash: 'HASH', device_id: 'dev-1' });
    // Channel names, categories and ids only: never the login or a URL.
    expect(JSON.stringify(scan)).not.toContain('secret');
    expect(JSON.stringify(scan)).not.toContain('http');
    for (const c of scan.candidates) expect(Object.keys(c).sort()).toEqual(['cat', 'id', 'name']);
    await waitFor(() => expect(ops('cached').length).toBeGreaterThanOrEqual(2));
    expect(st.track).toHaveBeenCalledWith('gameday_ai_scan', 'player', expect.objectContaining({ result: 'scanned' }));
  });

  it('another box scanning the provider now (busy): the answer is read again, the scan is not sent twice', async () => {
    st.cached = freshAnswer({}, 'OTHER');
    st.invoke.mockImplementation(async (_fn: string, opts: { body: { op: string } }) => {
      if (opts.body.op === 'cached') return { data: st.cached, error: null };
      if (opts.body.op === 'scan') return { data: { ok: true, scanned: false, busy: true }, error: null };
      return { data: { ok: true }, error: null };
    });
    await renderGameDay();
    await waitFor(() => expect(ops('cached').length).toBeGreaterThanOrEqual(2));
    await sleep(50);
    expect(ops('scan')).toHaveLength(1);
  });

  it('a found channel the guide shows with something else is dropped', async () => {
    st.guide = [{ line, stream: { stream_id: 5, name: 'EVENT 05' }, score: 85, via: 'game', guide: 'other' }];
    await openNfl();
    await sleep(50);
    expect(screen.queryByText('EVENT 05')).toBeNull();
    expect(screen.queryByText(SEARCH_HEADING)).toBeNull();
  });

  it("the owner's hide removes a found channel", async () => {
    st.edits = [{ game_id: 'nfl:1', service: 'h', stream_id: 5, channel_name: 'EVENT 05', action: 'hide', sort: 0 }];
    await openNfl();
    await sleep(50);
    expect(screen.queryByText('EVENT 05')).toBeNull();
  });

  it('a high-confidence match is the Watch pick of a row with nothing else; a medium one never is', async () => {
    await renderGameDay();
    await waitFor(() => expect(rowOf('Wolverines').textContent).toContain('B1G+ 03'));
    expect(rowOf('Wolverines').textContent).toContain('Found by search');
    expect(rowOf('Catamounts').textContent).not.toContain('LIVE EVENT 09');
    expect(rowOf('Catamounts').textContent).not.toContain('Found by search');
    // Nothing sure to watch: the row says so (with the box's B1G+ feeds, it
    // offers to check their guides).
    expect(rowOf('Catamounts').textContent).toMatch(/Not in your channels|check your guide/);
  });

  it('asks nothing with the flag off', async () => {
    st.flag = false;
    await openNfl();
    await sleep(50);
    expect(ops('cached')).toHaveLength(0);
    expect(ops('scan')).toHaveLength(0);
    expect(screen.queryByText('EVENT 05')).toBeNull();
  });

  it('asks nothing on a Kids profile', async () => {
    st.kids = 'kids';
    await openNfl();
    await sleep(50);
    expect(st.invoke.mock.calls.filter((c) => c[0] === 'game-day-match')).toHaveLength(0);
  });

  it('"Not this game": offered only on a found channel; takes it off at once and tells the server', async () => {
    await openNfl();
    await screen.findByText('EVENT 05');
    // The game's own channel: no such row.
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('Report Channel'));
    expect(dialogText()).not.toContain('Not this game');
    press('Escape');
    await sleep(400);
    // Down to the found channel.
    tap('ArrowDown');
    await holdOk();
    await waitFor(() => expect(dialogText()).toContain('Not this game'));
    tap('ArrowDown'); // Report Channel → Not this game
    tap('Enter');
    await waitFor(() => expect(screen.queryByText('EVENT 05')).toBeNull());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(ops('learn')).toEqual([expect.objectContaining({ op: 'learn', host: 'h', game_id: 'nfl:1', stream_id: 5, source: 'wrong' })]);
    expect(st.track).toHaveBeenCalledWith('gameday_ai_wrong', 'player', { league: 'nfl' });
    // The game's channels are untouched.
    expect(document.querySelector('[data-howto="gd.links"]')!.textContent).toContain('NFL 01: Bears vs Packers');
  });

  it('playing a found channel counts it; a list closed with nothing to watch is remembered for Live TV', async () => {
    const { onWatch } = await renderGameDay();
    await waitFor(() => expect(rowOf('Wolverines').textContent).toContain('B1G+ 03'));
    // The college game's row is the second.
    tap('ArrowDown');
    tap('Enter');
    await screen.findByText(SEARCH_HEADING);
    tap('Enter');
    expect(onWatch).toHaveBeenCalledWith('ncaah:401');
    expect(st.track).toHaveBeenCalledWith('gameday_ai_play', 'player', { league: 'ncaah', confidence: 'high' });
    const miss = JSON.parse(sessionStorage.getItem('smc-gameday-miss') || '[]');
    expect(miss).toEqual([expect.objectContaining({ gameId: 'ncaah:401', league: 'ncaah' })]);
    expect(miss[0].tokens).toContain('michigan');
  });
});
