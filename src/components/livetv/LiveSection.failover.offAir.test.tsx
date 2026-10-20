/**
 * A dead channel, end to end through the real useNativePlayer: the plugin
 * (mocked) gives the channel up as off the air (RECONNECT_EXHAUSTED with
 * HTTP 404, DeadStreamRule.kt); the hook shows the error at once, with no
 * fresh start of the dead address, and Live TV plays the same channel from
 * the viewer's other service. It used to take minutes of "Buffering… try a
 * VPN" first. No panel is contacted: the lists are fixtures.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const h = vi.hoisted(() => ({
  loads: [] as string[],
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  signalChannel: vi.fn(),
  trackEvent: vi.fn(),
  toast: vi.fn(),
}));

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const VIBEZ = { id: 'v', serverLabel: 'Vibez', host: 'http://v.test', username: 'vuser', password: 'vpw', output: 'm3u8', addedAt: 1 };
const DREAM = [
  { stream_id: 101, name: 'US: ESPN HD', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const VIBEZ_CH = [
  { stream_id: 501, name: 'USA | ESPN FHD', num: 1, category_id: '9' },
  { stream_id: 503, name: 'Movies Max', num: 3, category_id: '9' },
];
const OFF_AIR = "This channel isn't on the air right now.";

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [VIBEZ],
  getLiveCategories: async (c: { host: string }) => (c.host === 'http://v.test'
    ? [{ category_id: '9', category_name: 'Vibez Sports' }]
    : [{ category_id: '1', category_name: 'Sports' }]),
  getLiveStreams: async (c: { host: string }, catId?: string) =>
    (c.host === 'http://v.test' ? VIBEZ_CH : DREAM).filter((s) => !catId || s.category_id === catId).map((s) => ({ ...s })),
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
  signalChannel: h.signalChannel,
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
vi.mock('@/lib/analytics', () => ({ trackEvent: h.trackEvent, startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
// The plugin: every load's address kept, its events fired by the test, any
// other call answered with nothing.
vi.mock('@/capacitor/SnowPlayer', () => {
  const base: Record<string, unknown> = {
    load: async (o: { url: string }) => { h.loads.push(o.url); },
    timeshiftStatus: async () => ({ state: 'off' }),
    getEngines: async () => ({}),
    getStats: async () => ({}),
    getPosition: async () => ({ position: 0, duration: 0, playing: false }),
    addListener: async (ev: string, cb: (d: Record<string, unknown>) => void) => {
      h.listeners.set(ev, [...(h.listeners.get(ev) ?? []), cb]);
      return { remove: () => { h.listeners.set(ev, (h.listeners.get(ev) ?? []).filter((f) => f !== cb)); } };
    },
  };
  return {
    hasNativePlayer: () => true,
    SnowPlayer: new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : async () => ({})) }),
  };
});
vi.mock('@/lib/nativeVideoController', () => ({
  createNativeVideoController: () => ({
    controller: { getSubtitleTracks: () => [], getAudioTracks: () => [], isSeekable: () => false, isPaused: () => false, togglePlay: () => {} },
    prime: async () => {}, resetPaused: () => {}, dispose: () => {},
  }),
}));
vi.mock('@/lib/bufferDiagnostics', async (orig) => ({
  ...(await orig<typeof import('@/lib/bufferDiagnostics')>()),
  beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {},
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => {},
  hasRecorder: () => false,
  SnowRecorder: { listSchedules: async () => ({ schedules: [] }), active: async () => ({ jobs: [] }), list: async () => ({ recordings: [], volumes: [] }) },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast, useToast: () => ({ toast: h.toast }) }));
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

const press = (k: string) => act(() => {
  fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined });
  fireEvent.keyUp(window, { key: k });
});
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (h.listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
const last = () => h.loads[h.loads.length - 1] ?? '';
const isLoad = (u: string, host: string, id: number) => u.startsWith(host) && u.includes(`/${id}.`);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.loads.length = 0; h.listeners.clear();
  h.signalChannel.mockClear(); h.trackEvent.mockClear(); h.toast.mockClear();
});
afterEach(() => { document.documentElement.className = ''; });

describe('a dead channel (HTTP 404) with a second service', () => {
  it('the off-air answer fails over at once: no fresh start of the dead address, the copy plays', async () => {
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Sports'));
    await sleep(50);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(50);
    press('Enter');
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    await waitFor(() => expect(isLoad(last(), 'http://h.test', 101)).toBe(true));
    await waitFor(() => expect(h.listeners.get('playerError')?.length ?? 0).toBeGreaterThan(0));
    const before = h.loads.length;

    // What the plugin says after the first try and one retry both got 404.
    fire('playerError', { screenId: 'main', code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: 404 });
    // Well inside the second the old fresh start would have waited.
    await waitFor(() => expect(isLoad(last(), 'http://v.test', 501)).toBe(true), { timeout: 900 });
    expect(h.loads.slice(before).filter((u) => isLoad(u, 'http://h.test', 101))).toEqual([]);
    // Off the air for every box on DreamStreams at once (offair-status), with
    // the status number, never the address; not a plain 'fail'.
    expect(h.signalChannel).toHaveBeenCalledWith('http://h.test', 101, 'US: ESPN HD', 'offair', expect.objectContaining({ host: 'http://h.test' }), 404);
    expect(h.signalChannel).not.toHaveBeenCalledWith('http://h.test', 101, 'US: ESPN HD', 'fail');
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'US: ESPN HD is down on DreamStreams — playing it from Vibez' }));
    expect(h.trackEvent).toHaveBeenCalledWith('live_failover', 'player', { found: true, auto: true });
    await sleep(1300);
    // Still the copy: the dead one was never started again.
    expect(isLoad(last(), 'http://v.test', 501)).toBe(true);
    expect(h.loads.slice(before).filter((u) => u.startsWith('http://h.test'))).toEqual([]);
  });
});
