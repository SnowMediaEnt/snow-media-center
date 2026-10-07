/**
 * Live TV reports: a whole category reported down (hold OK on a category),
 * and a channel reported down or buffering asks before it plays.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });

const status = vi.hoisted(() => ({ set: new Set<string>(), signalChannel: vi.fn(), signalCategory: vi.fn() }));
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
  useDownChannels: () => status.set,
  signalChannel: status.signalChannel,
  signalCategory: status.signalCategory,
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
const dialogRows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);
const warning = () => document.querySelector('[data-channel-warning]');
const playing = () => document.querySelector('button[aria-label="Report channel"]');

async function render_() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const warned = await import('./channelWarning');
  warned.__resetWarnedForTests();
  render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  await waitFor(() => expect(text()).toContain('News'));
  await sleep(30);
}
async function openNews() {
  await render_();
  down('ArrowRight'); up('ArrowRight');
  await waitFor(() => expect(text()).toContain('News One'));
  await sleep(50);
}
const holdOk = async () => { down('Enter'); await sleep(700); up('Enter'); await sleep(20); };

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  status.set = new Set(); status.signalChannel.mockClear(); status.signalCategory.mockClear();
});
afterEach(() => { document.documentElement.className = ''; });

describe('hold OK on a category', () => {
  it('opens its menu, and "Report category down" reports it on its own line', async () => {
    await render_();
    await holdOk();
    await waitFor(() => expect(dialogRows()).toEqual(['Report category down', 'Cancel']));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('News');
    // The highlight stays on the category: the channels did not open under it.
    expect(document.querySelector('[data-cat-idx][data-focused="true"]')).not.toBeNull();
    down('Enter'); up('Enter');
    await waitFor(() => expect(status.signalCategory).toHaveBeenCalledWith('http://h.test', '1', 'News', 'down', expect.objectContaining({ username: 'someuser' })));
  });

  it('a short OK still opens the category', async () => {
    await render_();
    down('Enter'); up('Enter');
    await waitFor(() => expect(text()).toContain('News One'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('one Back closes the menu only', async () => {
    await render_();
    await holdOk();
    await waitFor(() => expect(dialogRows()).toContain('Report category down'));
    down('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(status.signalCategory).not.toHaveBeenCalled();
    // Still on the categories: ▶ opens News.
    down('ArrowRight'); up('ArrowRight');
    await waitFor(() => expect(text()).toContain('News One'));
  });
});

describe('a category reported down', () => {
  it('marks the category and every channel in it, red', async () => {
    status.set = new Set(['h.test|cat:1']);
    await openNews();
    expect(document.querySelector('[data-category-down]')).not.toBeNull();
    const marks = Array.from(document.querySelectorAll('[data-report]')).map((n) => n.getAttribute('data-report'));
    expect(marks.filter((m) => m === 'category').length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('[data-report="category"]')?.getAttribute('class')).toContain('text-red-400');
    expect(text()).toContain('Its whole category was reported down');
  });

  it('asks before a channel in it plays', async () => {
    status.set = new Set(['h.test|cat:1']);
    await openNews();
    down('Enter'); up('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('category'));
    expect(text()).toContain('The whole News category was reported down recently');
    expect(playing()).toBeNull();
  });

  it('its menu offers "It’s working now", which clears it for everyone', async () => {
    status.set = new Set(['h.test|cat:1']);
    await render_();
    await holdOk();
    await waitFor(() => expect(dialogRows()[0]).toBe("It's working now — remove ⚠️"));
    down('Enter'); up('Enter');
    expect(status.signalCategory).toHaveBeenCalledWith('http://h.test', '1', 'News', 'clear');
  });
});

describe('a channel reported buffering', () => {
  it('shows amber, and OK asks first: Pick another stays on the list', async () => {
    status.set = new Set(['h.test|buf:101']);
    await openNews();
    const mark = document.querySelector('[data-report="buffering"]');
    expect(mark?.getAttribute('class')).toContain('text-amber-400');
    expect(text()).toContain('Reported buffering recently — it may not play well');
    down('Enter'); up('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    expect(text()).toContain('Watch anyway');
    // The highlight starts on Pick another.
    down('Enter'); up('Enter');
    expect(warning()).toBeNull();
    expect(playing()).toBeNull();
    expect(text()).toContain('News One');
  });

  it('Watch anyway plays it, and the same viewer is not asked again straight after', async () => {
    status.set = new Set(['h.test|buf:101']);
    await openNews();
    down('Enter'); up('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    down('ArrowLeft'); up('ArrowLeft');
    down('Enter'); up('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    expect(warning()).toBeNull();
  });

  it('a channel not reported plays at once', async () => {
    status.set = new Set(['h.test|buf:102']);
    await openNews();
    down('Enter'); up('Enter');
    await waitFor(() => expect(playing()).not.toBeNull());
    expect(warning()).toBeNull();
  });
});

describe('a channel reported down', () => {
  it('asks too, in red, and down outranks buffering', async () => {
    status.set = new Set(['h.test|101', 'h.test|buf:101']);
    await openNews();
    expect(document.querySelector('[data-report="down"]')?.getAttribute('class')).toContain('text-red-400');
    down('Enter'); up('Enter');
    await waitFor(() => expect(warning()?.getAttribute('data-channel-warning')).toBe('down'));
  });

  it('the report menu of a buffering channel reports buffering to the others', async () => {
    await openNews();
    await holdOk();
    await waitFor(() => expect(dialogRows()).toContain('Report Channel'));
    up('Enter');
    down('Enter'); up('Enter'); // Report Channel → reasons
    down('ArrowDown'); up('ArrowDown'); // Channel buffering
    down('Enter'); up('Enter');
    await waitFor(() => expect(text()).toContain('Submit a ticket'));
    down('ArrowDown'); up('ArrowDown');
    down('Enter'); up('Enter');
    await waitFor(() => expect(status.signalChannel).toHaveBeenCalledWith('http://h.test', 101, 'News One', 'buffering', expect.objectContaining({ username: 'someuser' })));
  });
});
