import { act, cleanup, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 6000 });

// The channel list the TiviMate way (a customer's request):
// - Slim rows (Player Settings › Appearance, lib/liveRows): one line per
//   channel in Classic and Compact; the Vibez wall keeps its tiles.
// - The preview box holds the channel being watched (useHeldPreview): with
//   nothing on it follows the highlight as ever and OK goes full screen; back
//   from watching a channel full screen it keeps that channel while the
//   highlight moves, OK on another plays that one in the box, OK on the one
//   in the box goes full screen. Leaving Live TV, or the held channel failing
//   to play, lets go of it.

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'News Three', num: 3, category_id: '1' },
];
const status = vi.hoisted(() => ({ set: new Set<string>() }));
const player = vi.hoisted(() => ({ args: [] as Array<{ active: boolean; url: string | null; rect?: unknown }>, error: null as null | { message: string } }));
const layout = vi.hoisted(() => ({ id: 'classic' as 'classic' | 'compact' | 'grid' }));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadFavoritesData: () => new Map(),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 3, byCat: {} }),
  loadPlayerAccount: async () => ({ host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: 2 }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  prepareLocalForLine: () => null,
  loadFavoritesForLine: () => new Map(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => status.set,
  signalChannel: vi.fn(),
  signalCategory: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => layout.id,
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: { timeshiftStatus: async () => ({ state: 'off' }), timeshiftWipe: async () => {}, getEngines: async () => ({}), getStats: async () => ({}) },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => {},
  hasRecorder: () => false,
  SnowRecorder: {
    getVolumes: async () => ({ volumes: [] }),
    listSchedules: async () => ({ schedules: [] }),
    active: async () => ({ jobs: [] }),
    list: async () => ({ recordings: [], volumes: [] }),
    start: vi.fn(),
  },
}));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: { active: boolean; url: string | null; rect?: unknown }) => {
    player.args.push(a);
    return { buffering: false, error: player.error, retry: () => {}, paused: false, controller: null };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
// jsdom has no layout: the list shows every row.
vi.mock('@tanstack/react-virtual', async () => {
  const { useMemo } = await import('react');
  return {
    useVirtualizer: ({ count, estimateSize, getItemKey }: { count: number; estimateSize: (i: number) => number; getItemKey?: (i: number) => number | string }) => {
      const items = useMemo(
        () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey ? getItemKey(index) : index, start: index * estimateSize(index), size: estimateSize(index) })),
        [count, estimateSize, getItemKey],
      );
      return { getVirtualItems: () => items, getTotalSize: () => count * estimateSize(0), measure: () => {}, scrollToOffset: () => {}, scrollToIndex: () => {} };
    },
  };
});

const down = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const press = (k: string) => { down(k); up(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const fullScreen = () => document.querySelector('.z-\\[60\\]');
const warning = () => document.querySelector('[data-channel-warning]');
const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-howto="live.channels"] [data-focused]')).find((el) => (el.textContent ?? '').includes(name));
const playingTag = () => document.querySelector('[data-preview-playing]')?.textContent ?? null;
/** The stream the native player has, as a stream id (null: none). */
const inPlayer = (): number | null => {
  const a = player.args[player.args.length - 1];
  const m = a?.active && a.url ? /\/(\d+)\.ts/.exec(a.url) : null;
  return m ? Number(m[1]) : null;
};
/** Past the preview's dwell (700 ms). */
const dwell = () => sleep(900);

async function openNews() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const warned = await import('./channelWarning');
  warned.__resetWarnedForTests();
  const r = render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News Three'));
  await sleep(50);
  return r;
}
/** OK on News One, then Back twice (the bar, then the picture). */
async function watchNewsOneAndComeBack() {
  press('Enter');
  await waitFor(() => expect(fullScreen()).not.toBeNull());
  press('Escape');
  press('Escape');
  await waitFor(() => expect(fullScreen()).toBeNull());
  await waitFor(() => expect(text()).toContain('News Three'));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  status.set = new Set();
  player.args.length = 0;
  player.error = null;
  layout.id = 'classic';
});
afterEach(() => { document.documentElement.className = ''; });

describe('the preview box with nothing on', () => {
  it('follows the highlight after the dwell, and OK goes full screen', async () => {
    await openNews();
    await dwell();
    expect(inPlayer()).toBe(101);
    press('ArrowDown');
    await dwell();
    expect(inPlayer()).toBe(102);
    expect(playingTag()).toBeNull();
    expect(text()).toContain('OK full screen · Hold OK options');
    press('Enter');
    await waitFor(() => expect(fullScreen()).not.toBeNull());
  }, 20000);
});

describe('the preview box holding the channel being watched', () => {
  it('back from full screen it keeps that channel while the highlight moves', async () => {
    await openNews();
    await watchNewsOneAndComeBack();
    expect(inPlayer()).toBe(101);
    press('ArrowDown');
    press('ArrowDown');
    await dwell();
    // Still News One in the box; the info is News Three's, and the box says what plays.
    expect(inPlayer()).toBe(101);
    expect(playingTag()).toBe('Playing: News One');
    expect(text()).toContain('OK preview · OK again full screen · Hold OK options');
    // On the channel in the box: nothing to tell apart.
    press('ArrowUp');
    press('ArrowUp');
    await sleep(20);
    expect(playingTag()).toBeNull();
  }, 20000);

  it('OK on another channel plays it in the box (held now); OK again goes full screen', async () => {
    await openNews();
    await watchNewsOneAndComeBack();
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(102));
    expect(fullScreen()).toBeNull();
    // Its row is the one playing now.
    expect(row('News Two')?.textContent).toContain('ON AIR');
    expect(row('News One')?.textContent).not.toContain('ON AIR');
    // It is held: the highlight moving on leaves it there.
    press('ArrowDown');
    await dwell();
    expect(inPlayer()).toBe(102);
    expect(playingTag()).toBe('Playing: News Two');
    press('ArrowUp');
    press('Enter');
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    expect(inPlayer()).toBe(102);
  }, 20000);

  it('a channel reported down asks first; Watch anyway plays it in the box, not full screen', async () => {
    await openNews();
    await watchNewsOneAndComeBack();
    status.set = new Set(['h.test|102']);
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    expect(inPlayer()).toBe(101);
    // Watch anyway is to the left of Pick another (the default).
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(102));
    expect(warning()).toBeNull();
    expect(fullScreen()).toBeNull();
    // OK on it in the box: full screen, without asking a second time.
    press('Enter');
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    expect(warning()).toBeNull();
  }, 20000);

  it('lets go when the held channel fails to play: the box follows the highlight again', async () => {
    const r = await openNews();
    await watchNewsOneAndComeBack();
    press('ArrowDown');
    await dwell();
    expect(inPlayer()).toBe(101);
    player.error = { message: 'Source error' };
    // Any render brings the player's error in.
    press('ArrowDown');
    await sleep(20);
    player.error = null;
    press('ArrowUp');
    await dwell();
    expect(inPlayer()).toBe(102);
    expect(playingTag()).toBeNull();
    expect(text()).toContain('OK full screen · Hold OK options');
    r.unmount();
  }, 20000);

  it('lets go when Live TV is left: the next visit starts with nothing on', async () => {
    const r = await openNews();
    await watchNewsOneAndComeBack();
    r.unmount();
    cleanup();
    player.args.length = 0;
    await openNews();
    await dwell();
    expect(inPlayer()).toBe(101);
    press('ArrowDown');
    await dwell();
    expect(inPlayer()).toBe(102);
    // Nothing held: OK goes full screen.
    press('Enter');
    await waitFor(() => expect(fullScreen()).not.toBeNull());
  }, 30000);

  it('holds in Compact too', async () => {
    layout.id = 'compact';
    await openNews();
    await watchNewsOneAndComeBack();
    press('ArrowDown');
    await dwell();
    expect(inPlayer()).toBe(101);
    expect(playingTag()).toBe('Playing: News One');
  }, 20000);
});

describe('slim rows in the channel list', () => {
  it('draws every channel on one slim row in Classic and Compact once Slim is chosen', async () => {
    localStorage.setItem('snow-livetv-rows', 'slim');
    for (const id of ['classic', 'compact'] as const) {
      layout.id = id;
      const r = await openNews();
      expect(document.querySelectorAll('[data-row-slim]').length).toBe(3);
      expect(row('News One')?.hasAttribute('data-row-slim')).toBe(true);
      // The list still walks with the remote.
      press('ArrowDown');
      await sleep(20);
      expect(document.querySelector('[data-row-slim][data-focused="true"]')?.textContent).toContain('News Two');
      r.unmount();
      cleanup();
    }
  }, 30000);

  it('leaves Normal rows alone, and the Vibez wall its tiles', async () => {
    const r = await openNews();
    expect(document.querySelectorAll('[data-row-slim]').length).toBe(0);
    r.unmount();
    cleanup();
    localStorage.setItem('snow-livetv-rows', 'slim');
    layout.id = 'grid';
    await openNews();
    expect(document.querySelectorAll('[data-row-slim]').length).toBe(0);
  }, 30000);
});
