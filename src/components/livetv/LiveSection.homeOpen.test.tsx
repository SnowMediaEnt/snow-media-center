/**
 * A Home tile opens Live TV on its Favorites (every line's, in the viewer's
 * order), or with Recordings open (hand-over: smc-live-open, LIVE_OPEN_KEY).
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 2, byCat: {} }),
  loadPlayerAccount: async () => ({ host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: 2 }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
vi.mock('@/lib/channelStatus', async (orig) => ({
  ...(await orig<typeof import('@/lib/channelStatus')>()),
  useDownChannels: () => new Set<string>(),
  signalChannel: vi.fn(),
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
  useLiveLayout: () => 'classic',
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
  hasRecorder: () => true,
  SnowRecorder: {
    getVolumes: async () => ({ volumes: [{ id: 'box', label: 'This box', removable: false, freeBytes: 40 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 }] }),
    listSchedules: async () => ({ schedules: [] }),
    active: async () => ({ jobs: [] }),
    list: async () => ({ recordings: [], volumes: [] }),
    start: vi.fn(),
  },
}));
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: () => ({ buffering: false, error: null, retry: () => {} }) }));
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

const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';

async function openLive() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const favs = await import('@/lib/favoritesSync');
  return { Live, favs };
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { document.documentElement.className = ''; });

describe('Live TV opened from a Home tile', () => {
  it('Favorites: opens on the Favorites list, its channels showing', async () => {
    const { Live, favs } = await openLive();
    favs.saveFavoritesForLine(line, new Map([[102, { stream_id: 102, name: 'News Two', num: 2, category_id: '1' }]]));
    sessionStorage.setItem('smc-live-open', JSON.stringify('favorites'));
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(80);
    // Only the favourite is listed (the News category would list both), and the hand-over is used up.
    expect(text()).not.toContain('News One');
    expect(sessionStorage.getItem('smc-live-open')).toBeNull();
  });

  it('Recordings has its own section now: the old hand-off is used up and changes nothing here', async () => {
    const { Live } = await openLive();
    sessionStorage.setItem('smc-live-open', JSON.stringify('recordings'));
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await sleep(80);
    expect(sessionStorage.getItem('smc-live-open')).toBeNull();
    expect(document.querySelector('[data-recordings-screen]')).toBeNull();
  });

  it('asked again while Live TV is open (the event)', async () => {
    const { Live, favs } = await openLive();
    favs.saveFavoritesForLine(line, new Map([[101, { stream_id: 101, name: 'News One', num: 1, category_id: '1' }]]));
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await sleep(60);
    act(() => { window.dispatchEvent(new CustomEvent('smc:live-open', { detail: 'favorites' })); });
    await waitFor(() => expect(text()).toContain('News One'));
  });
});
