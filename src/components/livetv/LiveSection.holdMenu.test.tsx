/**
 * Hold OK on a channel in the Live TV list opens the channel's short menu
 * (Add to Favorites, Report Channel, Record…), not the recording options.
 * Record… leads on to them (where to save, how long, the extra-stream line);
 * one Back closes one level. Kids profiles get no Record… row. A short press
 * still plays.
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

const down = (k: string, extra: Partial<KeyboardEventInit> = {}) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined, ...extra }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const recordDialog = () => document.querySelector('[data-record-dialog]');
const menuRows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);

async function openList() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const kids = await import('@/lib/kidsFilter');
  return { Live, kids };
}
async function onNewsOne(Live: typeof import('./LiveSection').default) {
  render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  down('ArrowRight'); up('ArrowRight');
  await waitFor(() => expect(text()).toContain('News One'));
  await sleep(50);
}
/** Hold OK past the hold time (600 ms), then let go. */
async function holdOk() {
  down('Enter');
  await sleep(700);
  up('Enter');
  await sleep(20);
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { document.documentElement.className = ''; });

describe('hold OK on a channel in Live TV', () => {
  it('opens the short menu with Record… as one row, not the recording options', async () => {
    const { Live } = await openList();
    await onNewsOne(Live);
    await holdOk();
    await waitFor(() => expect(menuRows()).toContain('Record…'));
    expect(menuRows()).toEqual(['Report Channel', 'Add to Favorites', 'Record…', 'Cancel']);
    expect(recordDialog()).toBeNull();
    expect(text()).toContain('News One');
  });

  it('Record… opens the recording options: where to save, how long, the extra-stream line', async () => {
    const { Live } = await openList();
    await onNewsOne(Live);
    await holdOk();
    await waitFor(() => expect(menuRows()).toContain('Record…'));
    up('Enter'); // the menu is armed once OK has been let go
    // Report, Add to Favorites, then Record…
    down('ArrowDown'); down('ArrowDown');
    down('Enter'); up('Enter');
    await waitFor(() => expect(recordDialog()).not.toBeNull());
    // One level at a time: the menu is gone, the options are up.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[data-record-row="dest"]')).not.toBeNull();
    expect(document.querySelector('[data-record-row="dur"]')).not.toBeNull();
    expect(document.querySelector('[data-record-note]')?.textContent).toMatch(/stream/i);
    // No "More options…" any more: the menu came first.
    expect(document.querySelector('[data-record-row="more"]')).toBeNull();
    // Back closes the options, and nothing else opens.
    down('Escape');
    expect(recordDialog()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Report Channel goes to the reasons; Back returns to the menu, Back again closes it', async () => {
    const { Live } = await openList();
    await onNewsOne(Live);
    await holdOk();
    await waitFor(() => expect(menuRows()).toContain('Record…'));
    up('Enter');
    down('Enter'); up('Enter');
    await waitFor(() => expect(text()).toContain('Channel down'));
    down('Escape');
    expect(menuRows()).toContain('Record…');
    down('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(recordDialog()).toBeNull();
  });

  it('a short press of OK still plays', async () => {
    const { Live } = await openList();
    await onNewsOne(Live);
    down('Enter'); up('Enter');
    // Full screen: the player bar is up, with its Record and Report buttons.
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    expect(document.querySelector('button[aria-label="Record"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a Kids profile gets the menu without Record…', async () => {
    const { Live, kids } = await openList();
    kids.setKidsLevel('teen');
    try {
      await onNewsOne(Live);
      await holdOk();
      await waitFor(() => expect(menuRows()).toContain('Report Channel'));
      expect(menuRows()).not.toContain('Record…');
      expect(recordDialog()).toBeNull();
    } finally {
      kids.setKidsLevel(null);
    }
  });

  it('the Report button in the player bar opens the same menu for the channel that is playing', async () => {
    const { Live } = await openList();
    await onNewsOne(Live);
    down('Enter'); up('Enter');
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    // On Play; ▶ Forward (greyed out ones are skipped), Next, Record, Report.
    for (let i = 0; i < 12 && document.querySelector('[data-bar-control] button[data-focused="true"]')?.getAttribute('aria-label') !== 'Report channel'; i++) {
      down('ArrowRight'); up('ArrowRight');
    }
    expect(document.querySelector('[data-bar-control] button[data-focused="true"]')?.getAttribute('aria-label')).toBe('Report channel');
    down('Enter'); up('Enter');
    await waitFor(() => expect(menuRows()).toContain('Report Channel'));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('News One');
    // Back closes the menu and leaves the player where it was.
    up('Enter');
    down('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull();
  });
});
