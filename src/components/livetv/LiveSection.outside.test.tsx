// An outside service (Settings › Add another service, lib/outsideSource) in
// Live TV: its own group under the name the viewer gave it, with a small
// "Outside" tag, its favourites in "Favorites · all services" — and gone
// while the DreamStreams / Vibez line is expired (kept, back on renewal).
// Its channels' analytics say 'outside' and no names; when the line expires
// with one of them playing, it stops and the viewer is told why.
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });

const line = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'Dreamstreams' };
const CH = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const acc = vi.hoisted(() => ({
  status: 'Active',
  events: [] as Array<[string, string, Record<string, unknown>]>,
  timers: [] as Array<[string, string, string, Record<string, unknown>]>,
  toasts: [] as Array<{ title?: string }>,
  native: null as null | { url?: string | null; active?: boolean },
}));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadFavoritesData: () => new Map([[101, { stream_id: 101, name: 'News One', category_id: '1' }]]),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 2, byCat: {} }),
  loadPlayerAccount: async () => ({ serverLabel: 'Dreamstreams', host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'secretpw', expDate: null, status: acc.status, maxConnections: 2, lastCheckedAt: Date.now() }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  prepareLocalForLine: () => null,
  loadFavoritesForLine: (c: { outside?: boolean }) => c.outside
    ? new Map([[555, { stream_id: 555, name: 'Faraway Sports', category_id: '9' }]])
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
vi.mock('@/lib/analytics', () => ({
  trackEvent: (n: string, c: string, p: Record<string, unknown>) => { acc.events.push([n, c, p]); },
  startTimer: (k: string, n: string, c: string, p: Record<string, unknown>) => { acc.timers.push([k, n, c, p]); },
  stopTimer: vi.fn(),
  getDeviceId: () => 'd',
}));
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
vi.mock('@/hooks/useNativePlayer', () => ({ useNativePlayer: (o: { url?: string | null; active?: boolean }) => { acc.native = o; return { buffering: false, error: null, retry: () => {} }; } }));
vi.mock('@/hooks/use-toast', () => ({ toast: (t: { title?: string }) => { acc.toasts.push(t); }, useToast: () => ({ toast: vi.fn() }) }));
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
// Added on the line in use (its owner).
const SOURCE = [{ id: 'x:faraway.example|viewer', kind: 'xtream', name: 'Faraway TV', host: 'http://faraway.example:8000', username: 'viewer', password: 'pw-elsewhere', owner: 'dstreams.xyz|jsmith', addedAt: 1 }];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  acc.status = 'Active';
  acc.events = []; acc.timers = []; acc.toasts = []; acc.native = null;
  localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify(SOURCE));
});
afterEach(() => { document.documentElement.className = ''; });

describe('an outside service in Live TV', () => {
  it('is its own group under its name, tagged Outside, and its favourites join "Favorites · all services"', async () => {
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Faraway TV'));
    const header = Array.from(document.querySelectorAll('[data-cat-idx]')).find((el) => (el.textContent ?? '').includes('Faraway TV')) as HTMLElement;
    expect(header.querySelector('[data-outside-tag]')?.textContent).toBe('Outside');
    // Our own service's group has no tag.
    const ours = Array.from(document.querySelectorAll('[data-cat-idx]')).find((el) => (el.textContent ?? '').includes('Dreamstreams')) as HTMLElement;
    expect(ours.querySelector('[data-outside-tag]')).toBeNull();

    const all = Array.from(document.querySelectorAll('[data-focused]')).find((el) => (el.textContent ?? '').includes('Favorites · all services')) as HTMLElement;
    act(() => { fireEvent.click(all); });
    await sleep(50);
    await waitFor(() => expect(text()).toContain('Faraway Sports'));
    expect(text()).toContain('News One');
    const tags = Array.from(document.querySelectorAll('[data-service-tag]')).map((el) => el.textContent);
    expect(tags).toEqual(expect.arrayContaining(['Faraway TV']));
  }, 20000);

  it('is not shown while the DreamStreams / Vibez line is expired (the service stays saved)', async () => {
    acc.status = 'Expired';
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('News'));
    await sleep(100);
    expect(text()).not.toContain('Faraway TV');
    expect(document.querySelector('[data-outside-tag]')).toBeNull();
    expect(localStorage.getItem('snow-livetv-outside-sources-v1')).toContain('Faraway TV');
  });

  it('playing one of its channels: analytics say "outside" and no names; the line expiring hides the group, stops the channel and says why', async () => {
    vi.resetModules();
    const { default: Live } = await import('./LiveSection');
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Faraway TV'));
    // The outside group's own News (the last one listed).
    const news = Array.from(document.querySelectorAll('[data-cat-idx]')).filter((el) => (el.textContent ?? '').trim().startsWith('News'));
    act(() => { fireEvent.click(news[news.length - 1]); });
    const row = () => Array.from(document.querySelectorAll('[data-focused]')).find((el) => !el.hasAttribute('data-cat-idx') && (el.textContent ?? '').includes('News One')) as HTMLElement | undefined;
    await waitFor(() => expect(row()).toBeTruthy());
    act(() => { fireEvent.click(row()!); });
    await waitFor(() => expect(acc.native?.url ?? '').toContain('faraway.example'));
    const plays = acc.events.filter(([n]) => n === 'channel_play');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays[plays.length - 1][2]).toEqual({ server: 'outside' });
    const watch = acc.timers.filter(([, n]) => n === 'channel_watch');
    expect(watch[watch.length - 1][3]).toEqual({ server: 'outside' });
    expect(JSON.stringify(acc.events)).not.toMatch(/News One|faraway|Faraway TV/);

    // The DreamStreams line is found expired (the background check's refresh).
    acc.status = 'Expired';
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await waitFor(() => expect(acc.native?.url ?? null).toBeFalsy());
    expect(acc.toasts.map((t) => t.title)).toContain("Your DreamStreams/Vibez line isn't active, so Faraway TV channels are hidden.");
    await waitFor(() => expect(document.querySelector('[data-cat-idx]')).toBeTruthy());
    expect(document.querySelector('[data-outside-tag]')).toBeNull();
    expect(text()).not.toContain('Faraway TV');
  }, 20000);
});
