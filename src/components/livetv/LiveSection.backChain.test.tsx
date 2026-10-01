/**
 * The remote's Back in a full-screen live channel while a recording runs
 * (owner's Fire TV, 1.8.1): one press closed Snow Media Center. On a TV box
 * Back reaches the page only as Capacitor's backButton event; the Player shell
 * (LiveTV) owns it and turns it into an Escape that this section walks:
 * the bar, then full screen, then the list. Here the shell's part is played
 * by hand. Back never leaves the Player from full screen, never stops the
 * recording, and the section's own backButton listener leaves the press to
 * the shell (one press, one step).
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });

const rec = vi.hoisted(() => ({ stop: vi.fn(async () => {}) }));

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
// Every backButton listener the section registers, so a test can press the remote's Back.
const cap = vi.hoisted(() => ({ back: [] as Array<() => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, cb: () => void) => {
      if (ev === 'backButton') cap.back.push(cb);
      return { remove() { cap.back = cap.back.filter((f) => f !== cb); } };
    },
    exitApp: vi.fn(),
  },
}));
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
    // News One is being recorded.
    active: async () => ({ jobs: [{ id: 'r1', channel: 'News One', startedAt: Date.now() - 60_000, endsAt: 0, bytes: 1 }] }),
    stop: rec.stop,
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
const bar = () => document.querySelector('[data-bar-control]');

type BackWindow = Window & { __playerOwnsBack?: boolean; __overlayHandledBackAt?: number };
/** One press of the remote's Back: what LiveTV's listener does, then every other listener. */
const hardwareBack = async () => {
  await act(async () => {
    const w = window as BackWindow;
    w.__overlayHandledBackAt = Date.now();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    for (const f of [...cap.back]) f();
  });
  await sleep(20);
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  cap.back = [];
  rec.stop.mockClear();
  (window as BackWindow).__playerOwnsBack = true; // LiveTV is mounted around the section
});
afterEach(() => { document.documentElement.className = ''; (window as BackWindow).__playerOwnsBack = false; });

describe('Back from a full-screen channel while it records', () => {
  it('walks bar → full screen → the channel list, never out of the Player, and the recording goes on', async () => {
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    const onExitLeft = vi.fn();
    const onBack = vi.fn();
    render(<Live creds={line} isActive onExitLeft={onExitLeft} onBack={onBack} />);
    await sleep(20);
    down('ArrowRight'); up('ArrowRight');
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(50);
    down('Enter'); up('Enter');
    // Full screen, the bar up, and it knows this channel is recording.
    await waitFor(() => expect(document.querySelector('button[aria-label="Stop recording"]')).not.toBeNull());
    expect(cap.back.length).toBeGreaterThan(0);

    // 1: the bar goes; still full screen.
    await hardwareBack();
    expect(bar()).toBeNull();
    expect(text()).not.toContain('News Two');

    // 2: full screen closes onto the channel list.
    await hardwareBack();
    await waitFor(() => expect(text()).toContain('News Two'));
    expect(onExitLeft).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    // The recording was never touched.
    expect(rec.stop).not.toHaveBeenCalled();
  });
});
