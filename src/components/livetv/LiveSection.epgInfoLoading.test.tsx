/**
 * Live TV's info panel while the highlighted channel's programme info is
 * still on its way (the Guide's same case: GuideSection.infoLoading.test.tsx).
 * The panel said "No program info available" until the answer came back, so
 * the screen contradicted itself for the length of the request. Now:
 * "Loading…" until the answer is in; "No program info available" only after
 * an answer that really is empty.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const epg = vi.hoisted(() => ({
  pending: [] as Array<(v: { epg_listings: unknown[] }) => void>,
  layout: 'classic' as 'classic' | 'compact',
}));

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
  // Each channel's answer waits until the test gives it.
  getShortEpg: (_c: unknown, _id: number) => new Promise((res) => { epg.pending.push(res); }),
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
  useLiveLayout: () => epg.layout,
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

const down = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const loadingLine = () => document.querySelector('[data-live-info-loading]');
const answerAll = async (listings: unknown[]) => {
  await waitFor(() => expect(epg.pending.length).toBeGreaterThan(0));
  const all = epg.pending.splice(0);
  await act(async () => { all.forEach((r) => r({ epg_listings: listings })); });
  await sleep(250); // one redraw per burst of answers
};

async function onNewsOne() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  down('ArrowRight'); up('ArrowRight');
  await waitFor(() => expect(text()).toContain('News One'));
  await sleep(50);
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); epg.pending = []; });
afterEach(() => { document.documentElement.className = ''; });

describe.each(['classic', 'compact'] as const)('Live TV info panel while programme info loads (%s)', (layout) => {
  beforeEach(() => { epg.layout = layout; });

  it('says "Loading…", not "No program info available", until the answer is in', async () => {
    await onNewsOne();
    await waitFor(() => expect(epg.pending.length).toBeGreaterThan(0));
    expect(loadingLine()?.textContent).toBe('Loading…');
    expect(text()).not.toContain('No program info available');
  });

  it('an empty answer: then "No program info available"', async () => {
    await onNewsOne();
    await answerAll([]);
    await waitFor(() => expect(text()).toContain('No program info available'));
    expect(loadingLine()).toBeNull();
  });

  it('an answer with a programme on now: its title, no loading line', async () => {
    await onNewsOne();
    const s = (ms: number) => String(Math.floor(ms / 1000));
    const n = Date.now();
    await answerAll([{ title: btoa('Morning Bulletin'), start: '', end: '', start_timestamp: s(n - 600_000), stop_timestamp: s(n + 1_800_000) }]);
    await waitFor(() => expect(text()).toContain('Morning Bulletin'));
    expect(loadingLine()).toBeNull();
    expect(text()).not.toContain('No program info available');
  });
});
