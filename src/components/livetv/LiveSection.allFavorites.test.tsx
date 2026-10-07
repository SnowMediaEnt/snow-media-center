import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [{ id: 'v', serverLabel: 'Vibez', host: 'http://v.test', username: 'vuser', password: 'vpw', output: 'm3u8', addedAt: 1 }],
  loadFavoritesData: () => new Map([[101, { stream_id: 101, name: 'News One', category_id: '1' }]]),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 2, byCat: {} }),
  loadPlayerAccount: async () => ({ host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: 2 }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  prepareLocalForLine: () => null,
  loadFavoritesForLine: (c: { host: string }) => c.host === 'http://v.test'
    ? new Map([[555, { stream_id: 555, name: 'Vibez Sports', category_id: '9' }]])
    : new Map([[101, { stream_id: 101, name: 'News One', category_id: '1' }]]),
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

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { document.documentElement.className = ''; });

describe('Favorites from every service together', () => {
  it('with DreamStreams and Vibez, a combined Favorites comes first and lists both, each with its service', async () => {
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Favorites · all services'));
    const rows = Array.from(document.querySelectorAll('[data-focused]')).map((el) => el.textContent ?? '');
    const iAll = rows.findIndex((r) => r.includes('Favorites · all services'));
    const iDream = rows.findIndex((r) => r.includes('DreamStreams'));
    expect(iAll).toBeGreaterThanOrEqual(0);
    expect(iAll).toBeLessThan(iDream);
    // Open it and look at the channels.
    const entry = Array.from(document.querySelectorAll('[data-focused]')).find((el) => (el.textContent ?? '').includes('Favorites · all services')) as HTMLElement;
    act(() => { fireEvent.click(entry); });
    await sleep(50);
    await waitFor(() => expect(text()).toContain('Vibez Sports'));
    expect(text()).toContain('News One');
    const tags = Array.from(document.querySelectorAll('[data-service-tag]')).map((el) => el.textContent);
    expect(tags).toEqual(expect.arrayContaining(['DreamStreams', 'Vibez']));
  });
});
