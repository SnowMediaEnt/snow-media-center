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
  setError: null as null | ((e: { code?: string; message: string; forUrl?: string } | null) => void),
  url: null as string | null,
  /** Every address the player was given, in order. */
  urls: [] as string[],
  vibezCat: 'Vibez Sports',
}));

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const VIBEZ = { id: 'v', serverLabel: 'Vibez', host: 'http://v.test', username: 'vuser', password: 'vpw', output: 'm3u8', addedAt: 1 };
const DREAM = [
  { stream_id: 101, name: 'US: ESPN HD', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'ESPN 2', num: 3, category_id: '1' },
  { stream_id: 104, name: 'PPV 1', num: 4, category_id: '1' },
];
const VIBEZ_CH = [
  { stream_id: 501, name: 'USA | ESPN FHD', num: 1, category_id: '9' },
  { stream_id: 502, name: 'USA | ESPN 2', num: 2, category_id: '9' },
  { stream_id: 503, name: 'Movies Max', num: 3, category_id: '9' },
  { stream_id: 504, name: 'PPV 1', num: 4, category_id: '9' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => h.saved,
  getLiveCategories: async (c: { host: string }) => (c.host === 'http://v.test'
    ? [{ category_id: '9', category_name: h.vibezCat }]
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
vi.mock('@/hooks/useNativePlayer', async (orig) => {
  const React = await import('react');
  return {
    isOffAirAnswer: (await orig<typeof import('@/hooks/useNativePlayer')>()).isOffAirAnswer,
    useNativePlayer: (o: { active: boolean; url: string | null }) => {
      const [error, setError] = React.useState<{ code?: string; message: string; forUrl?: string } | null>(null);
      const was = React.useRef(o.url);
      React.useEffect(() => { if (was.current !== o.url) { was.current = o.url; setError(null); } }, [o.url]);
      h.setError = setError;
      h.url = o.active ? o.url : null;
      if (h.url && h.urls[h.urls.length - 1] !== h.url) h.urls.push(h.url);
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
const fail = () => act(() => { h.setError?.({ code: 'RECONNECT_EXHAUSTED', message: 'Source error', forUrl: h.url ?? undefined }); });
const playingOn = (host: string, id: number) => !!h.url && h.url.startsWith(host) && h.url.includes(`/${id}.`);
const failoverEvents = () => h.trackEvent.mock.calls.filter((c) => c[0] === 'live_failover');
const errorCard = () => text().includes('Playback Error');
const offer = () => document.querySelector('[data-failover-offer]') as HTMLElement | null;
const reportBtn = () => document.querySelector('[data-failover-report]') as HTMLElement | null;
const retryBtn = () => Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => (b.textContent ?? '').trim() === 'Retry') ?? null;
const dialog = () => document.querySelector('[role="dialog"]');
/** The plugin gave the channel up as off the air (DeadStreamRule.kt). */
const OFF_AIR = "This channel isn't on the air right now.";
const failOffAir = () => act(() => {
  (h.setError as unknown as (e: Record<string, unknown>) => void)?.({ code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: 404, forUrl: h.url ?? undefined });
});
const focusedOnCard = () => [retryBtn(), offer(), reportBtn()].filter(Boolean).map((b) => (b!.getAttribute('data-focused') === 'true' ? (b!.textContent ?? '').trim() : null)).filter(Boolean);

async function openSports(creds: typeof line & { outside?: true } = line) {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const r = render(<Live creds={creds} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await waitFor(() => expect(text()).toContain('Sports'));
  await sleep(50);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News Two'));
  await sleep(50);
  return { setActive: (on: boolean) => r.rerender(<Live creds={creds} isActive={on} onExitLeft={() => {}} onBack={() => {}} />) };
}
/** The whole Vibez line-up asked for (no category). */
const vibezWholeAsked = () => h.getLiveStreams.mock.calls.filter((c) => c[0].host === 'http://v.test' && !c[1]).length;
const bar = () => document.querySelector('[data-howto="bar.root"]');
const rowNamed = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-focused]')).find((el) => (el.textContent ?? '').includes(name));
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
  h.urls = [];
  h.vibezCat = 'Vibez Sports';
  h.getLiveStreams.mockReset();
  h.getLiveStreams.mockImplementation(async (c: { host: string }, catId?: string) =>
    (c.host === 'http://v.test' ? VIBEZ_CH : DREAM).filter((s) => !catId || s.category_id === catId).map((s) => ({ ...s })));
  h.signalChannel.mockClear(); h.trackEvent.mockClear(); h.toast.mockClear(); h.retry.mockClear();
});
afterEach(async () => {
  document.documentElement.className = '';
  const pm = await import('@/lib/phoneMode');
  pm.__setPhoneModeForTests({ touch: false, phone: false });
});

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

  it('the switch turned off: nothing is downloaded, and "Try on Vibez" is offered beside Retry from a list in hand', async () => {
    localStorage.setItem('smc-live-failover-v1', '0');
    h.vibezCat = 'Sports';
    await openSports();
    // The viewer looked at Vibez's Sports earlier: that list is in hand.
    press('ArrowLeft');
    for (let i = 0; i < 4; i++) press('ArrowDown');
    await sleep(20);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('USA | ESPN FHD'));
    press('ArrowLeft');
    for (let i = 0; i < 4; i++) press('ArrowUp');
    await sleep(20);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(50);
    await watch(0);
    const asked = h.getLiveStreams.mock.calls.length;
    fail();
    await waitFor(() => expect(offer()?.textContent).toBe('Try on Vibez'));
    expect(h.getLiveStreams.mock.calls.length).toBe(asked);
    expect(failoverEvents()).toEqual([['live_failover', 'player', { found: true, auto: false }]]);
    expect(playingOn('http://h.test', 101)).toBe(true);
    expect(h.toast).not.toHaveBeenCalled();
    expect(document.querySelector('[data-failover-looking]')).toBeNull();
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

  it('the switch turned off and nothing in hand: no download, no button', async () => {
    localStorage.setItem('smc-live-failover-v1', '0');
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(failoverEvents()).toEqual([['live_failover', 'player', { found: false, auto: false }]]));
    expect(vibezWholeAsked()).toBe(0);
    expect(offer()).toBeNull();
  });

  it('a low-memory box (every Fire TV) still looks the channel up on the other service', async () => {
    await openSports();
    document.documentElement.classList.add('native-low-memory');
    try {
      await watch(0);
      fail();
      await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
      expect(failoverEvents()).toEqual([['live_failover', 'player', { found: true, auto: true }]]);
    } finally {
      document.documentElement.classList.remove('native-low-memory');
    }
  });

  it('the channel\'s own category on the other line (same name) is asked for first: no whole line-up', async () => {
    h.vibezCat = 'US| SPORTS';
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    expect(h.getLiveStreams).toHaveBeenCalledWith(expect.objectContaining({ host: 'http://v.test' }), '9');
    expect(vibezWholeAsked()).toBe(0);
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

// The box holding the channel being watched (useHeldPreview) and failover
// meet when that held channel fails in the box: failover goes first, and a
// copy it finds is held in its place; with no copy the box lets go.
describe('a held preview box whose channel fails', () => {
  // Full screen shows one channel's name; the list shows them all.
  const fullScreen = () => !(text().includes('US: ESPN HD') && text().includes('News Two'));
  const backToList = async () => {
    for (let i = 0; i < 3 && fullScreen(); i++) { press('Escape'); await sleep(50); }
    await waitFor(() => expect(fullScreen()).toBe(false));
    await sleep(50);
  };

  it('plays the copy there and keeps holding it; OK on the viewer\'s own channel takes the copy full screen', async () => {
    await openSports();
    await watch(0); // ESPN full screen
    await backToList(); // the box holds ESPN
    press('ArrowDown'); // look at News Two: the box keeps ESPN
    await sleep(900);
    expect(playingOn('http://h.test', 101)).toBe(true);
    fail(); // ESPN fails in the box
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    // Still held: the highlight on News Two does not take the box over.
    await sleep(2500);
    expect(playingOn('http://v.test', 501)).toBe(true);
    expect(failoverEvents()).toHaveLength(1);
    // OK on ESPN's own row: the copy goes full screen, not the dead original.
    press('ArrowUp');
    await sleep(30);
    press('Enter');
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    await sleep(30);
    expect(playingOn('http://v.test', 501)).toBe(true);
  });

  it('with no copy anywhere, lets go once failover is done: the box follows the highlight again', async () => {
    await openSports();
    await watch(1); // News Two full screen: not on Vibez
    await backToList(); // the box holds News Two
    press('ArrowUp'); // look at ESPN
    await sleep(900);
    expect(playingOn('http://h.test', 102)).toBe(true);
    fail();
    await waitFor(() => expect(failoverEvents()).toEqual([['live_failover', 'player', { found: false, auto: false }]]));
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true), { timeout: 5000 });
  });
});

describe('review fixes', () => {
  it('an event slot (PPV 1) is never switched or offered, though the other service has a "PPV 1"', async () => {
    await openSports();
    await watch(3);
    expect(playingOn('http://h.test', 104)).toBe(true);
    fail();
    await waitFor(() => expect(failoverEvents()).toEqual([['live_failover', 'player', { found: false, auto: false }]]));
    expect(vibezWholeAsked()).toBe(0);
    expect(playingOn('http://h.test', 104)).toBe(true);
    expect(offer()).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('a touch screen: the box shows the copy, a tap on the failed channel goes full screen on the copy', async () => {
    await openSports();
    const pm = await import('@/lib/phoneMode');
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: true, portrait: false }));
    await waitFor(() => expect(rowNamed('US: ESPN HD')).toBeTruthy());
    act(() => { fireEvent.click(rowNamed('US: ESPN HD')!); });
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true));
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    const before = h.urls.length;
    act(() => { fireEvent.click(rowNamed('US: ESPN HD')!); });
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    await sleep(50);
    expect(playingOn('http://v.test', 501)).toBe(true);
    // The box was never sent back to the failed channel.
    expect(h.urls.slice(before).some((u) => u.startsWith('http://h.test'))).toBe(false);
  });

  it('full screen on the copy, OK on the failed channel in the list over the picture: the copy stays, nothing restarts', async () => {
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    await sleep(30);
    const before = h.urls.length;
    act(() => { fireEvent.keyDown(window, { key: 'ContextMenu' }); });
    await waitFor(() => expect(document.querySelector('[data-channel-overlay]')).not.toBeNull());
    expect(document.querySelector('[data-overlay-channel][data-focused="true"]')?.textContent).toContain('US: ESPN HD');
    press('Enter');
    await waitFor(() => expect(document.querySelector('[data-channel-overlay]')).toBeNull());
    await sleep(50);
    expect(playingOn('http://v.test', 501)).toBe(true);
    expect(h.urls.slice(before)).toEqual([]);
    expect(h.signalChannel.mock.calls.filter((c) => c[3] === 'fail')).toHaveLength(1);
    expect(failoverEvents()).toHaveLength(1);
  });

  it('leaving Live TV forgets it: back again, the box tries the viewer\'s own channel, and OK plays it', async () => {
    const { setActive } = await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    await sleep(30);
    for (let i = 0; i < 3 && !text().includes('News Two'); i++) { press('Escape'); await sleep(50); }
    await waitFor(() => expect(text()).toContain('News Two'));
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    act(() => setActive(false));
    await sleep(50);
    act(() => setActive(true));
    await waitFor(() => expect(playingOn('http://h.test', 101)).toBe(true));
    press('Enter');
    await waitFor(() => expect(document.querySelector('button[aria-label="Report channel"]')).not.toBeNull());
    await sleep(30);
    expect(playingOn('http://h.test', 101)).toBe(true);
  });

  it('◀ ▶ stay on the error card while "Try on…" is shown, the bar down: no channel list, no Recently watched', async () => {
    localStorage.setItem('smc-live-failover-v1', '0');
    h.vibezCat = 'Sports';
    await openSports();
    // Vibez's Sports in hand (see the switch-off test).
    press('ArrowLeft');
    for (let i = 0; i < 4; i++) press('ArrowDown');
    await sleep(20);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('USA | ESPN FHD'));
    press('ArrowLeft');
    for (let i = 0; i < 4; i++) press('ArrowUp');
    await sleep(20);
    press('ArrowRight');
    await waitFor(() => expect(text()).toContain('News Two'));
    await sleep(50);
    await watch(0);
    fail();
    await waitFor(() => expect(offer()).not.toBeNull());
    if (bar()) { press('Escape'); await sleep(30); }
    expect(bar()).toBeNull();
    expect(errorCard()).toBe(true);
    press('ArrowLeft'); // on Retry already
    await sleep(30);
    expect(document.querySelector('[data-channel-overlay]')).toBeNull();
    press('ArrowRight'); // "Try on…"
    press('ArrowRight'); // "Report it", the last
    press('ArrowRight'); // stays
    await sleep(30);
    expect(document.querySelector('[data-recent-panel]')).toBeNull();
    expect(focusedOnCard()).toEqual(['Report it']);
  });

  it('two lines on the same service: "your other DreamStreams line"', async () => {
    h.saved = [{ ...VIBEZ, serverLabel: 'Dreamstreams' }];
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'US: ESPN HD is down on DreamStreams — playing it from your other DreamStreams line' }));
    await sleep(30);
    fail();
    await waitFor(() => expect(errorCard()).toBe(true));
    await waitFor(() => expect(offer()?.textContent).toBe('Try on your other DreamStreams line'));
    expect(document.querySelector('[data-failover-both]')?.textContent).toBe("US: ESPN HD didn't play on either of your DreamStreams lines.");
  });
});

describe('"Report it" on the error card', () => {
  it('an off-air channel: Retry and Report it; ◀ ▶ between them; OK opens the channel report for it, "Channel down" picked; closed, the remote is back on Retry', async () => {
    h.saved = [];
    await openSports();
    await watch(0);
    failOffAir();
    await waitFor(() => expect(reportBtn()?.textContent?.trim()).toBe('Report it'));
    expect(text()).toContain(OFF_AIR);
    expect(focusedOnCard()).toEqual(['Retry']);
    press('ArrowRight');
    expect(focusedOnCard()).toEqual(['Report it']);
    press('ArrowRight'); // the last one: stays
    expect(focusedOnCard()).toEqual(['Report it']);
    expect(document.querySelector('[data-recent-panel]')).toBeNull();
    press('ArrowLeft');
    expect(focusedOnCard()).toEqual(['Retry']);
    press('ArrowLeft'); // the first one: stays, no channel list
    expect(document.querySelector('[data-channel-overlay]')).toBeNull();
    press('ArrowRight');
    press('Enter');
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(h.retry).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('US: ESPN HD');
    // Straight at the reasons, on "Channel down".
    const down = Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-focused]')).find((el) => (el.textContent ?? '').includes('Channel down'));
    expect(down?.getAttribute('data-focused')).toBe('true');
    // Closed (Back to its menu, Back again): the card, on Retry.
    press('Escape');
    press('Escape');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(errorCard()).toBe(true);
    expect(focusedOnCard()).toEqual(['Retry']);
    press('Enter');
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('with "Try on…" too: Retry, Try on…, Report it, in that order; the report is for the channel that failed (the copy)', async () => {
    await openSports();
    await watch(0);
    fail();
    await waitFor(() => expect(playingOn('http://v.test', 501)).toBe(true));
    await sleep(30);
    failOffAir();
    await waitFor(() => expect(offer()?.textContent).toBe('Try on DreamStreams'));
    const order = Array.from(document.querySelectorAll<HTMLElement>('button')).map((b) => (b.textContent ?? '').trim()).filter((x) => ['Retry', 'Try on DreamStreams', 'Report it'].includes(x));
    expect(order).toEqual(['Retry', 'Try on DreamStreams', 'Report it']);
    press('ArrowRight');
    expect(focusedOnCard()).toEqual(['Try on DreamStreams']);
    press('ArrowRight');
    expect(focusedOnCard()).toEqual(['Report it']);
    press('Enter');
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(dialog()?.textContent).toContain('USA | ESPN FHD');
    // Nothing switched.
    expect(playingOn('http://v.test', 501)).toBe(true);
  });

  it('any channel that would not start gets it (not only off air); this box\'s own trouble does not', async () => {
    h.saved = [];
    await openSports();
    await watch(0);
    fail(); // RECONNECT_EXHAUSTED, no status
    await waitFor(() => expect(reportBtn()).not.toBeNull());
    act(() => { (h.setError as unknown as (e: Record<string, unknown>) => void)?.({ code: 'NO_PICTURE', message: 'x', forUrl: h.url ?? undefined }); });
    await waitFor(() => expect(errorCard()).toBe(true));
    expect(reportBtn()).toBeNull();
    act(() => { (h.setError as unknown as (e: Record<string, unknown>) => void)?.({ code: 'AUDIO_DECODE', message: 'x', forUrl: h.url ?? undefined }); });
    await sleep(20);
    expect(reportBtn()).toBeNull();
  });

  it('an outside service\'s channel: no button, the note says who to ask', async () => {
    h.saved = [];
    await openSports({ ...line, outside: true });
    await watch(0);
    failOffAir();
    await waitFor(() => expect(errorCard()).toBe(true));
    await sleep(20);
    expect(reportBtn()).toBeNull();
    expect(document.querySelector('[data-outside-note]')?.textContent).toBe('Outside service — report problems to that provider.');
    // ◀ ▶ are not taken by a card with Retry alone.
    expect(focusedOnCard()).toEqual(['Retry']);
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
