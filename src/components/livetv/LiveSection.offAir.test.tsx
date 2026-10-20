/**
 * A channel off the air (offair-status), through Live TV with the real
 * channel status (lib/channelStatus) and a fake server: the provider's "not
 * here" for the stream sends 'offair' (not 'fail') and marks the row at
 * once; a channel another box marked a moment ago asks before it plays, the
 * reports being asked for again first; Watch anyway that plays fine for 12 s
 * clears it for everyone.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 20_000 });

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  list: { ok: true, down: [] as string[], offair: [] as string[] } as Record<string, unknown>,
  url: null as string | null,
  setError: null as null | ((e: { code?: string; message: string; httpStatus?: number; forUrl?: string } | null) => void),
  /** Favourites on the line (none unless a test says). */
  favs: [] as Array<{ stream_id: number; name: string; category_id: string }>,
}));
const favMap = () => new Map(h.favs.map((f) => [f.stream_id, { ...f }]));
const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadFavoritesData: () => favMap(),
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
  loadFavoritesForLine: () => favMap(),
  saveFavoritesForLine: vi.fn(),
  reconcileFavoritesForLine: vi.fn(async () => null),
  flushFavoritesPush: vi.fn(),
}));
// The real channel status; the server is this fake.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (name: string, { body }: { body: Record<string, unknown> }) => {
        if (name !== 'channel-status') return { data: null, error: null };
        h.calls.push(body);
        return body.op === 'list' ? { data: h.list, error: null } : { data: { ok: true }, error: null };
      }),
    },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({}),
  },
}));
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => 'classic',
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'device-12345678' }));
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
  SnowRecorder: { listSchedules: async () => ({ schedules: [] }), active: async () => ({ jobs: [] }) },
}));
// The native player: its error is the test's to set; the off-air rule is the real one.
vi.mock('@/hooks/useNativePlayer', async (orig) => {
  const React = await import('react');
  return {
    isOffAirAnswer: (await orig<typeof import('@/hooks/useNativePlayer')>()).isOffAirAnswer,
    useNativePlayer: (o: { active: boolean; url: string | null }) => {
      const [error, setError] = React.useState<{ code?: string; message: string; httpStatus?: number; forUrl?: string } | null>(null);
      const was = React.useRef(o.url);
      React.useEffect(() => { if (was.current !== o.url) { was.current = o.url; setError(null); } }, [o.url]);
      h.setError = setError;
      h.url = o.active ? o.url : null;
      return { buffering: false, error, retry: () => setError(null), audioWarning: null, controller: null, paused: false, engineNotice: null };
    },
  };
});
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
const press = (k: string) => { down(k); up(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const warning = () => document.querySelector('[data-channel-warning]');
const playing = () => document.querySelector('button[aria-label="Report channel"]');
const lists = () => h.calls.filter((c) => c.op === 'list');
const signals = () => h.calls.filter((c) => c.op === 'signal');
const OFF_AIR = "This channel isn't on the air right now.";

async function openNews() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  (await import('./channelWarning')).__resetWarnedForTests();
  render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  await waitFor(() => expect(text()).toContain('News'));
  await sleep(30);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News One'));
  await waitFor(() => expect(lists().length).toBeGreaterThan(0));
  await sleep(50);
}
const realNow = Date.now.bind(Date);
/** The list on the box gets older than the 15 s an open trusts. */
const later = () => vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 20_000);

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.calls.length = 0;
  h.list = { ok: true, down: [], offair: [] };
  h.url = null;
  h.favs = [];
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.documentElement.className = ''; });

describe('a channel another box found off the air', () => {
  it('says "Off the air" on its row, in red, and OK asks first', async () => {
    h.list = { ok: true, down: ['h.test|101'], offair: ['h.test|101'] };
    await openNews();
    await waitFor(() => expect(document.querySelector('[data-report="offair"]')).not.toBeNull());
    expect(document.querySelector('[data-report="offair"]')?.getAttribute('class')).toContain('text-red-400');
    expect(text()).toContain("Off the air right now — it won't play until it's back");
    press('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(text()).toContain("This channel isn't on the air right now — it won't play until it's back.");
    expect(playing()).toBeNull();
  });

  it('marked a moment ago, after the last list: the reports are asked for again before it plays, and it asks first', async () => {
    await openNews();
    expect(document.querySelector('[data-report]')).toBeNull();
    const before = lists().length;
    // Another box got the provider's "not here" for News One just now.
    h.list = { ok: true, down: ['h.test|101'], offair: ['h.test|101'] };
    later();
    press('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('offair'));
    expect(lists().length).toBe(before + 1);
    expect(playing()).toBeNull();
  });

  it('Watch anyway that plays fine for 12 s clears it for everyone', async () => {
    h.list = { ok: true, down: ['h.test|101'], offair: ['h.test|101'] };
    await openNews();
    press('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    expect(signals()).toEqual([]);
    await act(async () => { vi.advanceTimersByTime(12_500); });
    await waitFor(() => expect(signals()).toEqual([expect.objectContaining({ kind: 'ok', host: 'h.test', stream_id: 101 })]));
  });
});

describe('the provider says the stream is not there', () => {
  it('sends "off the air" with the status (never a plain fail), and the row says so at once', async () => {
    await openNews();
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    expect(h.url).toContain('102');
    act(() => { h.setError!({ code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: 404, forUrl: h.url! }); });
    await waitFor(() => expect(signals()).toHaveLength(1));
    expect(signals()[0]).toMatchObject({ kind: 'offair', host: 'h.test', stream_id: 102, http_status: 404 });
    expect(JSON.stringify(signals())).not.toContain('secretpw');
    // On this box straight away, before any list: back on the list, its row says so.
    expect(lists().length).toBe(1);
    for (let i = 0; i < 4 && !text().includes('News One'); i++) { press('Escape'); await sleep(50); }
    await waitFor(() => expect(document.querySelector('[data-report="offair"]')).not.toBeNull());
    expect(lists().length).toBe(1);
  });

  it('a late error of the channel before is not this channel off the air: a plain fail', async () => {
    await openNews();
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    act(() => { h.setError!({ code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: 404, forUrl: 'http://h.test/live/someuser/secretpw/101.m3u8' }); });
    await waitFor(() => expect(signals()).toHaveLength(1));
    expect(signals()[0]).toMatchObject({ kind: 'fail', stream_id: 102 });
    expect(signals()[0]).not.toHaveProperty('http_status');
  });

  it('a stream that failed for another reason is a plain fail', async () => {
    await openNews();
    press('ArrowDown');
    press('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    act(() => { h.setError!({ code: 'ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', message: 'x', forUrl: h.url! }); });
    await waitFor(() => expect(signals()).toHaveLength(1));
    expect(signals()[0]).toMatchObject({ kind: 'fail', stream_id: 102 });
  });
});

describe('Favorites', () => {
  it('a favourite off the air says so in Favorites too', async () => {
    h.favs = [{ stream_id: 101, name: 'News One', category_id: '1' }, { stream_id: 102, name: 'News Two', category_id: '1' }];
    h.list = { ok: true, down: ['h.test|101'], offair: ['h.test|101'] };
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Favorites'));
    await sleep(30);
    // Up to Favorites, then into its list.
    for (let i = 0; i < 4 && !document.querySelector('[data-cat-idx][data-focused="true"]')?.textContent?.includes('Favorites'); i++) { press('ArrowUp'); await sleep(20); }
    expect(document.querySelector('[data-cat-idx][data-focused="true"]')?.textContent).toContain('Favorites');
    press('ArrowRight');
    await waitFor(() => expect(document.querySelector('[data-report="offair"]')).not.toBeNull());
    const rows = [...document.querySelectorAll('[data-report="offair"]')];
    expect(rows).toHaveLength(1);
    expect(text()).toContain("Off the air right now — it won't play until it's back");
  });
});
