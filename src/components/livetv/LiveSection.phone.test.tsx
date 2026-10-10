import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

configure({ asyncUtilTimeout: 10000 });

// Live TV on a phone (Tronix 4369a23, b033d02, 2ca8249): upright it is one
// phone screen (the video box, the category chips, slim rows) whatever the
// layout; a tap plays a channel in the box, a tap on the box goes full
// screen; full screen a touch screen's Back leaves the picture at once;
// turning sideways while watching goes full screen. A TV is unchanged.

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
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
  useLiveLayout: () => 'classic',
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

const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const fullScreen = () => document.querySelector('.z-\\[60\\]');
const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-focused]')).find((el) => (el.textContent ?? '').includes(name));
const back = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); nativeArgs.length = 0; recordChannelWatch.mockClear(); });
afterEach(() => { __setPhoneModeForTests({ touch: false, phone: false }); document.documentElement.className = ''; });

const mount = async (onExitLeft = vi.fn()) => {
  vi.resetModules();
  const pm = await import('@/lib/phoneMode');
  const { default: Live } = await import('./LiveSection');
  const r = render(<Live creds={line} isActive onExitLeft={onExitLeft} onBack={() => {}} />);
  return { ...r, pm };
};

describe('Live TV on a phone held upright', () => {
  it('is one phone screen: the video box, the category chips, slim rows', async () => {
    const { pm } = await mount();
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(document.querySelector('[data-live-phone]')).not.toBeNull());
    expect(document.querySelector('[data-phone-video]')).not.toBeNull();
    await waitFor(() => expect(document.querySelectorAll('[data-cat-chip]').length).toBeGreaterThan(0));
    expect(document.body.textContent).toContain('Tap a channel to watch it here');
    await waitFor(() => expect(row('News One')).toBeTruthy());
  }, 30000);

  it('a tap plays a channel in the box (counted as watching), a tap on the box goes full screen', async () => {
    const { pm } = await mount();
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(row('News One')).toBeTruthy());
    act(() => { fireEvent.click(row('News One')!); });
    await sleep(20);
    expect(fullScreen()).toBeNull();
    expect(document.querySelector('[data-phone-now]')?.textContent).toContain('News One');
    // The box owns the screen like full screen does.
    await waitFor(() => expect(nativeArgs[nativeArgs.length - 1]).toMatchObject({ active: true, background: true }));
    // Into Recently watched after the usual few seconds, as full screen would.
    await waitFor(() => expect(recordChannelWatch).toHaveBeenCalled(), { timeout: 8000 });
    act(() => { fireEvent.click(document.querySelector('[data-phone-fullscreen]')!); });
    await waitFor(() => expect(fullScreen()).not.toBeNull());
  }, 30000);

  it('full screen, a touch screen\'s Back leaves the picture at once (the bar comes and goes with a tap)', async () => {
    const { pm } = await mount();
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(row('News One')).toBeTruthy());
    act(() => { fireEvent.click(row('News One')!); });
    act(() => { fireEvent.click(document.querySelector('[data-phone-video]')!); });
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    // A tap on the picture puts the bar away or brings it up.
    const bar = () => document.querySelector('[data-howto="bar.root"]');
    const before = !!bar();
    act(() => { fireEvent.click(fullScreen()!); });
    await waitFor(() => expect(!!bar()).toBe(!before));
    if (!bar()) {
      act(() => { fireEvent.click(fullScreen()!); });
      await waitFor(() => expect(bar()).not.toBeNull());
    }
    // With the bar up, Back leaves at once (a TV's first Back hides the bar).
    back();
    await waitFor(() => expect(fullScreen()).toBeNull());
    // Back in the box, with the channel.
    expect(document.querySelector('[data-phone-now]')?.textContent).toContain('News One');
  }, 30000);

  it('turned sideways while watching in the box: full screen; upright again: back to the box', async () => {
    const { pm } = await mount();
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(row('News One')).toBeTruthy());
    act(() => { fireEvent.click(row('News One')!); });
    await sleep(20);
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: false }));
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(fullScreen()).toBeNull());
    expect(document.querySelector('[data-phone-now]')?.textContent).toContain('News One');
  }, 30000);

  it('a category chip opens its channels; Back on a touch screen leaves Live TV (no highlight to walk back)', async () => {
    const onExitLeft = vi.fn();
    const { pm } = await mount(onExitLeft);
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: true }));
    await waitFor(() => expect(document.querySelectorAll('[data-cat-chip]').length).toBeGreaterThan(1));
    const sports = Array.from(document.querySelectorAll<HTMLElement>('[data-cat-chip]')).find((el) => (el.textContent ?? '').includes('Sports'))!;
    act(() => { fireEvent.click(sports); });
    await waitFor(() => expect(sports.getAttribute('data-active')).toBe('true'));
    back();
    expect(onExitLeft).toHaveBeenCalled();
  }, 30000);
});

describe('Live TV on a TV', () => {
  it('keeps its chosen layout and OK on a row plays full screen', async () => {
    await mount();
    await waitFor(() => expect(row('News One')).toBeTruthy());
    expect(document.querySelector('[data-live-phone]')).toBeNull();
    act(() => { fireEvent.click(row('News One')!); });
    await waitFor(() => expect(fullScreen()).not.toBeNull());
  }, 30000);
});
