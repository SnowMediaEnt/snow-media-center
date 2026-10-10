import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

configure({ asyncUtilTimeout: 10000 });

// The logo wall ("Vibez") drawn Compact (lib/viewSize, the default; ported
// from Tronix build 43): square logo tiles, as many a row as fit the measured
// width, the highlighted channel's whole name in the top bar, and on a TV the
// categories fold to a strip while the remote is in the tiles (◀ off the
// first column unfolds them). A touch screen never folds. Large is the older
// wall (5 tall tiles a row).

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'LIVE EVENT 03 - 9pm Fight Night Main Card', num: 3, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadFavoritesData: () => new Map(),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 2, byCat: {} }),
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
  useLiveLayout: () => 'grid',
  hasLiveLayoutChoice: () => true,
}));
const recordChannelWatch = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: (...a: unknown[]) => recordChannelWatch(...a) }));
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
    getVolumes: async () => ({ volumes: [] }),
    listSchedules: async () => ({ schedules: [] }),
    active: async () => ({ jobs: [] }),
    list: async () => ({ recordings: [], volumes: [] }),
    start: vi.fn(),
  },
}));
const nativeArgs: Array<{ active: boolean; background?: boolean; rect?: unknown }> = [];
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: { active: boolean; background?: boolean; rect?: unknown }) => {
    nativeArgs.push(a);
    return { buffering: false, error: null, retry: () => {}, paused: false, controller: null };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
vi.mock('./BufferingDiagnostics', () => ({ default: () => null }));
vi.mock('./VideoPlayer', () => ({ default: () => <div data-testid="video" /> }));
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


// jsdom has no layout: the wall's box is 656 px wide (a 960 px TV less the
// side menu's strip and the categories), and the observer reports at once.
class RO { cb: () => void; constructor(cb: () => void) { this.cb = cb; } observe() { this.cb(); } disconnect() {} unobserve() {} }
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 656; } });
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const tiles = () => document.querySelectorAll('[data-wall-tile="compact"]');
const fold = () => document.querySelector('[data-cat-fold]')?.getAttribute('data-cat-fold');

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { __setPhoneModeForTests({ touch: false, phone: false }); document.documentElement.className = ''; });

const mount = async () => {
  vi.resetModules();
  const pm = await import('@/lib/phoneMode');
  const { default: Live } = await import('./LiveSection');
  render(<Live creds={line} isActive onExitLeft={vi.fn()} onBack={() => {}} />);
  return pm;
};

describe('the logo wall, Compact', () => {
  it('square tiles; ▶ into them folds the categories to a strip with the whole name on top; ◀ unfolds', async () => {
    await mount();
    await waitFor(() => expect(tiles().length).toBe(3));
    expect(document.querySelector('[data-wall-logo]')).not.toBeNull();
    // A long name: a step smaller on two lines, never one cut line.
    const long = [...document.querySelectorAll('[data-wall-name]')].find((el) => el.textContent?.includes('Fight Night'))!;
    expect(long.className).toContain('line-clamp-2');
    expect(long.className).toContain('text-[11px]');
    expect(fold()).toBe('open');
    key('ArrowRight');
    await waitFor(() => expect(fold()).toBe('folded'));
    expect(document.querySelector('[data-cat-strip]')?.textContent).toContain('N');
    expect(document.querySelector('[data-wall-focus-name]')?.textContent).toContain('News One');
    key('ArrowLeft');
    await waitFor(() => expect(fold()).toBe('open'));
  });

  it('a touch screen never folds', async () => {
    const pm = await mount();
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: false }));
    await waitFor(() => expect(tiles().length).toBe(3));
    expect(fold()).toBeUndefined();
  });

  it('Large: the older wall, nothing folds', async () => {
    localStorage.setItem('snow-view-size', 'large');
    await mount();
    await waitFor(() => expect(document.querySelectorAll('[data-wall-name]').length + document.body.textContent!.split('News One').length - 1).toBeGreaterThan(0));
    expect(tiles().length).toBe(0);
    expect(fold()).toBeUndefined();
  });
});
