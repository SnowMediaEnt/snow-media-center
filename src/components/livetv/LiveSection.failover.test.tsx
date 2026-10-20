/**
 * A channel that won't start, played from the viewer's other service
 * (useChannelFailover): once by itself with a note; a copy that fails too
 * gets the error screen saying both were tried; no copy, or the switch off,
 * is the error screen as before (with "Try on…" when a copy exists); one
 * line changes nothing. No panel is contacted: the lists are fixtures.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });
// Each test loads Live TV afresh (vi.resetModules): slow on a busy machine.
vi.setConfig({ testTimeout: 20_000 });

const h = vi.hoisted(() => ({
  saved: [] as Array<Record<string, unknown>>,
  getLiveStreams: vi.fn(),
  signalChannel: vi.fn(),
  trackEvent: vi.fn(),
  toast: vi.fn(),
  retry: vi.fn(),
  setError: null as null | ((e: { code?: string; message: string } | null) => void),
  url: null as string | null,
}));

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const VIBEZ = { id: 'v', serverLabel: 'Vibez', host: 'http://v.test', username: 'vuser', password: 'vpw', output: 'm3u8', addedAt: 1 };
const DREAM = [
  { stream_id: 101, name: 'US: ESPN HD', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'ESPN 2', num: 3, category_id: '1' },
];
const VIBEZ_CH = [
  { stream_id: 501, name: 'USA | ESPN FHD', num: 1, category_id: '9' },
  { stream_id: 502, name: 'USA | ESPN 2', num: 2, category_id: '9' },
  { stream_id: 503, name: 'Movies Max', num: 3, category_id: '9' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => h.saved,
  getLiveCategories: async (c: { host: string }) => (c.host === 'http://v.test'
    ? [{ category_id: '9', category_name: 'Vibez Sports' }]
    : [{ category_id: '1', category_name: 'Sports' }]),
  getLiveStreams: h.getLiveStreams,
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 3, byCat: {} }),
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
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: { timeshiftStatus: async () => ({ state: 'off' }), timeshiftWipe: async () => {}, getEngines: async () => ({}), getStats: async () => ({}) },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => {},
  hasRecorder: () => false,
  SnowRecorder: { listSchedules: async () => ({ schedules: [] }), active: async () => ({ jobs: [] }), list: async () => ({ recordings: [], volumes: [] }) },
}));
// The native player: the address it was asked to play, and an error the test
// raises. A new address clears the error a render later, as the real one does.
vi.mock('@/hooks/useNativePlayer', async () => {
  const React = await import('react');
  return {
    useNativePlayer: (o: { active: boolean; url: string | null }) => {
      const [error, setError] = React.useState<{ code?: string; message: string } | null>(null);
      const was = React.useRef(o.url);
      React.useEffect(() => { if (was.current !== o.url) { was.current = o.url; setError(null); } }, [o.url]);
      h.setError = setError;
      h.url = o.active ? o.url : null;
      return { buffering: false, error, retry: h.retry, audioWarning: null, controller: null, paused: false, engineNotice: null };
    },
  };
});
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast, useToast: () => ({ toast: h.toast }) }));
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
/** The channel won't start: what the native player says after its own retries. */
const fail = () => act(() => { h.setError?.({ code: 'RECONNECT_EXHAUSTED', message: 'Source error' }); });
const playingOn = (host: string, id: number) => !!h.url && h.url.startsWith(host) && h.url.includes(`/${id}.`);
const failoverEvents = () => h.trackEvent.mock.calls.filter((c) => c[0] === 'live_failover');
const errorCard = () => text().includes('Playback Error');
const offer = () => document.querySelector('[data-failover-offer]') as HTMLElement | null;

async function openSports() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await waitFor(() => expect(text()).toContain('Sports'));
  await sleep(50);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News Two'));
  await sleep(50);
}
/** OK on the n-th channel of the list: it plays full screen. */
async function watch(n: number) {
  for (let i = 0; i < n; i++) press('ArrowDown');
  await sleep(20);
  press('Enter');
  await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
  await sleep(20);
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.saved = [VIBEZ];
  h.url = null;
  h.getLiveStreams.mockReset();
  h.getLiveStreams.mockImplementation(async (c: { host: string }, catId?: string) =>
    (c.host === 'http://v.test' ? VIBEZ_CH : DREAM).filter((s) => !catId || s.category_id === catId).map((s) => ({ ...s })));
  h.signalChannel.mockClear(); h.trackEvent.mockClear(); h.toast.mockClear(); h.retry.mockClear();
});
afterEach(() => { document.documentElement.className = ''; });

describe('a channel that won\'t start, with a second service', () => {
  it('plays the same channel from the other service once, with a note; the copy failing too shows the error, tried on both', async () => {
    await openSports();
    await watch(0);
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true));

    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'US: ESPN HD is down on DreamStreams — playing it from Vibez', duration: 5000 }));
    expect(failoverEvents()).toEqual([['live_failover', 'player', { found: true, auto: true }]]);
    // The original is reported on its own line, as before; never the copy on it.
    expect(h.signalChannel).toHaveBeenCalledWith('http://h.test', 101, 'US: ESPN HD', 'fail');
    expect(h.signalChannel).not.toHaveBeenCalledWith('http://h.test', 501, expect.anything(), expect.anything());
    // What is watched now is the copy, on its own service.
    expect(h.trackEvent).toHaveBeenCalledWith('channel_play', 'player', expect.objectContaining({ channel: 'USA | ESPN FHD', server: 'Vibez' }));
    await sleep(30);
    expect(errorCard()).toBe(false);

    // The copy fails too: no switch back, the error screen says both were tried.
    fail();
    await waitFor(() => expect(errorCard()).toBe(true));
    await sleep(50);
    expect(playingOn('http://v.test', 501)).toBe(true);
    expect(document.querySelector('[data-failover-both]')?.textContent).toBe("US: ESPN HD didn't play on DreamStreams or on Vibez.");
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(failoverEvents()).toHaveLength(1);
    // The copy is reported on its own line.
    expect(h.signalChannel).toHaveBeenCalledWith('http://v.test', 501, 'USA | ESPN FHD', 'fail');
    // Retry stays, and going back is the viewer's call.
    expect(text()).toContain('Retry');
    expect(offer()?.textContent).toBe('Try on DreamStreams');
  });

  it('CH+ after the switch goes on through the list the viewer was in', async () => {
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    await sleep(30);
    press('ArrowDown');
    await waitFor(() => expect(playingOn('http://h.test', 102)).toBe(true));
    press('ArrowUp');
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true));
  });

  it('Back from the copy: the list is on the viewer\'s own channel and the box keeps the copy, not the channel that failed', async () => {
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    await sleep(30);
    // Back hides the bar, Back again leaves the picture.
    for (let i = 0; i < 3 && !text().includes('News Two'); i++) { press('Escape'); await sleep(50); }
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(800);
    expect(playingOn('http://v.test', 501)).toBe(true);
    expect(document.querySelector('[data-focused="true"]')?.textContent).toContain('US: ESPN HD');
    expect(failoverEvents()).toHaveLength(1);
  });

  it('no copy on the other service: the error screen as before', async () => {
    await openSports();
    await watch(1); // News Two: not on Vibez
    fail();
    await waitFor(() => expect(errorCard()).toBe(true));
    await waitFor(() => expect(failoverEvents()).toEqual([['live_failover', 'player', { found: false, auto: false }]]));
    await sleep(30);
    expect(playingOn('http://h.test', 102)).toBe(true);
    expect(offer()).toBeNull();
    expect(document.querySelector('[data-failover-both]')).toBeNull();
    expect(document.querySelector('[data-failover-looking]')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
    // OK is still Retry.
    press('Enter');
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('never plays a different channel: ESPN 2 is not ESPN', async () => {
    h.getLiveStreams.mockImplementation(async (c: { host: string }, catId?: string) =>
      (c.host === 'http://v.test' ? VIBEZ_CH.filter((s) => s.stream_id !== 501) : DREAM).filter((s) => !catId || s.category_id === catId).map((s) => ({ ...s })));
    await openSports();
    await watch(0); // US: ESPN HD; Vibez has only ESPN 2
    fail();
    await waitFor(() => expect(failoverEvents()).toEqual([['live_failover', 'player', { found: false, auto: false }]]));
    expect(playingOn('http://h.test', 101)).toBe(true);
    expect(offer()).toBeNull();
  });

  it('the switch turned off: the error screen offers "Try on Vibez" beside Retry instead', async () => {
    localStorage.setItem('smc-live-failover-v1', '0');
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(offer()?.textContent).toBe('Try on Vibez'));
    expect(failoverEvents()).toEqual([['live_failover', 'player', { found: true, auto: false }]]);
    expect(playingOn('http://h.test', 101)).toBe(true);
    expect(h.toast).not.toHaveBeenCalled();
    expect(text()).toContain('Retry');
    // ▶ onto it, OK: the copy plays.
    expect(offer()?.getAttribute('data-focused')).toBe('false');
    press('ArrowRight');
    expect(offer()?.getAttribute('data-focused')).toBe('true');
    press('ArrowLeft');
    expect(offer()?.getAttribute('data-focused')).toBe('false');
    press('ArrowRight');
    press('Enter');
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    expect(h.retry).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('the preview box: a highlighted channel that fails plays from the other service there, and OK takes that copy full screen', async () => {
    await openSports();
    // The highlight rests on ESPN: the box plays it.
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true));
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'US: ESPN HD is down on DreamStreams — playing it from Vibez' }));
    expect(document.querySelector('button[aria-label="Report channel"]')).toBeNull();
    // OK on the highlighted (failed) channel: the picture the box shows goes full screen.
    press('Enter');
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    await sleep(30);
    expect(playingOn('http://v.test', 501)).toBe(true);
    expect(failoverEvents()).toHaveLength(1);
  });
});

describe('one service only', () => {
  it('nothing new: no lookup, no note, no button', async () => {
    h.saved = [];
    await openSports();
    await watch(0);
    const calls = h.getLiveStreams.mock.calls.length;
    fail();
    await waitFor(() => expect(errorCard()).toBe(true));
    await sleep(50);
    expect(h.getLiveStreams.mock.calls.length).toBe(calls);
    expect(failoverEvents()).toHaveLength(0);
    expect(offer()).toBeNull();
    expect(document.querySelector('[data-failover-looking]')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
    expect(playingOn('http://h.test', 101)).toBe(true);
    expect(localStorage.getItem('smc-live-line-count-v1')).toBe('1');
  });
});
