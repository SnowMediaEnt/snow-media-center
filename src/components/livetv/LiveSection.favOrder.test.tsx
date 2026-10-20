/**
 * Favorites in your own order (a TiviMate viewer's ask): hold OK on a
 * favourite → Move lifts it, ▲▼ carry it (held: it keeps going, stopping at
 * the ends), OK or Back put it down and the order is saved; nothing else
 * acts meanwhile. Sort A–Z / Sort my way from the same menu, the own order
 * kept. CH ▲▼ full screen walks the list in its order. With two services the
 * shared Favorites and each service's own agree. A touch screen gets Move up
 * / Move down.
 */
import { act, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

configure({ asyncUtilTimeout: 4000 });
// A fresh LiveSection import and two held OKs (700 ms each) run past the 5 s
// default on a busy machine; a timed-out test would then press keys in the next.
vi.setConfig({ testTimeout: 20_000 });

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const MAIN = 'h.test|someuser';
const VIBEZ = 'v.test|vuser';
const fav = (stream_id: number, name: string) => ({ stream_id, name, category_id: '1' });

const cfg = vi.hoisted(() => ({
  layout: 'classic' as string,
  saved: [] as unknown[],
  favs: {} as Record<string, Array<{ stream_id: number; name: string; category_id: string }>>,
}));
const favMap = (host: string) => new Map((cfg.favs[host] ?? []).map((f) => [f.stream_id, { ...f }]));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => cfg.saved,
  loadFavoritesData: () => favMap('http://h.test'),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => [{ stream_id: 900, name: 'Other', num: 1, category_id: '1' }],
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 1, byCat: {} }),
  loadPlayerAccount: async () => ({ host: 'http://h.test', username: 'someuser', password: 'secretpw', maxConnections: 2 }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => ({
  ...(await orig<typeof import('@/lib/favoritesSync')>()),
  scheduleFavoritesPushForLine: vi.fn(),
  prepareLocalForLine: () => null,
  loadFavoritesForLine: (c: { host: string }) => favMap(c.host),
  saveFavoritesForLine: vi.fn(),
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
  useLiveLayout: () => cfg.layout,
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
    getVolumes: async () => ({ volumes: [] }),
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
const press = (k: string) => { down(k); up(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const menuRows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'News One', 'News Two', 'Vibez Sports', 'Other'];
const IDS: Record<string, string> = { 1: 'Alpha', 2: 'Bravo', 3: 'Charlie', 4: 'Delta', 101: 'News One', 102: 'News Two', 555: 'Vibez Sports' };
const nameIn = (el: Element | null | undefined) => NAMES.find((n) => (el?.textContent ?? '').includes(n));
/** The channel list, top to bottom (rows, or the logo wall's tiles). */
const listed = () => Array.from(document.querySelectorAll('[data-howto="live.channels"] [data-focused]')).map(nameIn);
const highlighted = () => nameIn(document.querySelector('[data-howto="live.channels"] [data-focused="true"]'));
/** The favourite drawn lifted (the mark over its row says which). */
const lifted = () => {
  const id = document.querySelector('[data-fav-moving]')?.getAttribute('data-fav-moving');
  return id ? IDS[id] : undefined;
};
const savedOrder = (profile = 'main') => {
  const raw = localStorage.getItem(`snow-livetv-fav-order-v1:${profile}`);
  if (!raw) return null;
  const o = JSON.parse(raw) as { mode: string; keys: Array<[string, number, string]> };
  return { mode: o.mode, names: o.keys.map((k) => k[2]) };
};
const saveOrder = (mode: 'mine' | 'az', keys: Array<[string, number, string]>) =>
  localStorage.setItem('snow-livetv-fav-order-v1:main', JSON.stringify({ mode, keys }));

async function freshLive() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  return Live;
}
/** Live TV open on a Favorites list (the `steps`-th entry above the first category), the remote in the channels. */
async function openFavorites(Live: Awaited<ReturnType<typeof freshLive>>, steps: number, expectFirst: string) {
  const view = render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  // The pane lands on the first real category once the categories are in.
  await waitFor(() => expect(text()).toContain('News'));
  await sleep(30);
  for (let i = 0; i < steps; i++) press('ArrowUp');
  press('ArrowRight');
  await waitFor(() => expect(listed()[0]).toBe(expectFirst));
  await sleep(30);
  return view;
}
/** Hold OK on the highlighted favourite and pick Move: it is lifted. */
async function liftHighlighted() {
  const name = highlighted();
  await holdOk();
  pick('Move');
  await waitFor(() => expect(lifted()).toBe(name));
}
/** Hold OK past the hold time (600 ms), then let go; the menu is armed. */
async function holdOk() {
  down('Enter');
  await sleep(700);
  up('Enter');
  await waitFor(() => expect(menuRows()).toContain('Cancel'));
  up('Enter');
}
/** OK on the menu row with this label. */
function pick(label: string) {
  const rows = menuRows();
  const at = rows.indexOf(label);
  expect(at).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < at; i++) press('ArrowDown');
  press('Enter');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  cfg.layout = 'classic';
  cfg.saved = [];
  // Added in this order: Delta, Alpha, Charlie, Bravo.
  cfg.favs = { 'http://h.test': [fav(4, 'Delta'), fav(1, 'Alpha'), fav(3, 'Charlie'), fav(2, 'Bravo')] };
});
afterEach(async () => {
  document.documentElement.className = '';
  const pm = await import('@/lib/phoneMode');
  pm.__setPhoneModeForTests({ touch: false, phone: false });
});

describe('Favorites: Move', () => {
  it('the menu of a favourite offers Move and Sort A–Z', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    expect(listed()).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);
    press('ArrowDown');
    await holdOk();
    expect(menuRows()).toEqual(['Report Channel', 'Remove from Favorites', 'Move', 'Sort A–Z', 'Record…', 'Refresh channel link', 'Cancel']);
  });

  it('a channel of a category gets the menu as ever', async () => {
    const Live = await freshLive();
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('News'));
    await sleep(30);
    press('ArrowRight');
    await waitFor(() => expect(listed()).toEqual(['Other']));
    await sleep(30);
    await holdOk();
    expect(menuRows()).toEqual(['Report Channel', 'Add to Favorites', 'Record…', 'Cancel']);
  });

  it('▲▼ carry the lifted favourite (held: it keeps going, stopping at the end); OK puts it down and saves', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    press('ArrowDown');
    expect(highlighted()).toBe('Alpha');
    await holdOk();
    pick('Move');
    await waitFor(() => expect(lifted()).toBe('Alpha'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    press('ArrowDown');
    expect(listed()).toEqual(['Delta', 'Charlie', 'Alpha', 'Bravo']);
    expect(highlighted()).toBe('Alpha');
    // Held: the key repeats, and the favourite goes on to the end and stays there.
    down('ArrowDown', { repeat: true });
    down('ArrowDown', { repeat: true });
    down('ArrowDown', { repeat: true });
    up('ArrowDown');
    expect(listed()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
    expect(lifted()).toBe('Alpha');
    // Nothing is saved until it is put down.
    expect(savedOrder()).toBeNull();

    // Meanwhile nothing else acts: ◀ ▶ (categories, Recently watched), F (favourite), Menu.
    press('ArrowLeft');
    press('ArrowRight');
    press('f');
    down('ContextMenu');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(lifted()).toBe('Alpha');
    expect(highlighted()).toBe('Alpha');
    expect(listed()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);

    press('ArrowUp');
    expect(listed()).toEqual(['Delta', 'Charlie', 'Alpha', 'Bravo']);
    press('Enter');
    expect(lifted()).toBeUndefined();
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Delta', 'Charlie', 'Alpha', 'Bravo'] });
    // Back to the list as ever: ▲ moves the highlight, OK plays.
    press('ArrowUp');
    expect(highlighted()).toBe('Charlie');
    expect(listed()).toEqual(['Delta', 'Charlie', 'Alpha', 'Bravo']);
  });

  it('Back puts it down too, and stays in the list (one Back, one step)', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    press('ArrowDown'); press('ArrowDown'); press('ArrowDown');
    expect(highlighted()).toBe('Bravo');
    await holdOk();
    pick('Move');
    await waitFor(() => expect(lifted()).toBe('Bravo'));
    press('ArrowUp'); press('ArrowUp'); press('ArrowUp');
    // At the top: ▲ does not wrap round to the bottom.
    press('ArrowUp');
    expect(listed()).toEqual(['Bravo', 'Delta', 'Alpha', 'Charlie']);
    press('Escape');
    expect(lifted()).toBeUndefined();
    expect(highlighted()).toBe('Bravo');
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Bravo', 'Delta', 'Alpha', 'Charlie'] });
  });

  it('Sort A–Z keeps the own order; Sort my way (no Move while A–Z) brings it back', async () => {
    saveOrder('mine', [[MAIN, 3, 'Charlie'], [MAIN, 4, 'Delta'], [MAIN, 1, 'Alpha'], [MAIN, 2, 'Bravo']]);
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Charlie');
    expect(listed()).toEqual(['Charlie', 'Delta', 'Alpha', 'Bravo']);
    press('ArrowDown');
    await holdOk();
    pick('Sort A–Z');
    await waitFor(() => expect(listed()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']));
    // The highlight stayed on the channel it was on.
    expect(highlighted()).toBe('Delta');
    expect(savedOrder()?.mode).toBe('az');
    expect(savedOrder()?.names).toEqual(['Charlie', 'Delta', 'Alpha', 'Bravo']);

    await holdOk();
    expect(menuRows()).toContain('Sort my way');
    expect(menuRows()).not.toContain('Move');
    pick('Sort my way');
    await waitFor(() => expect(listed()).toEqual(['Charlie', 'Delta', 'Alpha', 'Bravo']));
    expect(highlighted()).toBe('Delta');
    expect(savedOrder()?.mode).toBe('mine');
  });

  it('a favourite added since goes at the end of the own order', async () => {
    saveOrder('mine', [[MAIN, 2, 'Bravo'], [MAIN, 1, 'Alpha']]);
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Bravo');
    expect(listed()).toEqual(['Bravo', 'Alpha', 'Delta', 'Charlie']);
  });
});

describe('Favorites: a move cut short is put down where it got to, and saved', () => {
  it('a voice "put on …" playing full screen', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    await liftHighlighted();
    press('ArrowDown');
    expect(listed()).toEqual(['Alpha', 'Delta', 'Charlie', 'Bravo']);
    act(() => { window.dispatchEvent(new CustomEvent('smc:live-play', { detail: 'Other' })); });
    await waitFor(() => expect(document.querySelector('h2.text-lg')?.textContent ?? '').toContain('Other'));
    expect(lifted()).toBeUndefined();
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Delta', 'Charlie', 'Bravo'] });
    // CH ▼ full screen is a channel change, not a move.
    press('ArrowDown');
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Delta', 'Charlie', 'Bravo'] });
  });

  it('the assistant opening search', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    await liftHighlighted();
    press('ArrowDown'); press('ArrowDown');
    act(() => { window.dispatchEvent(new CustomEvent('smc:live-report', { detail: { search: 'Other', issue: 'down' } })); });
    await waitFor(() => expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Charlie', 'Delta', 'Bravo'] }));
    expect(lifted()).toBeUndefined();
  });

  it('Live TV losing the remote (the side menu, a prompt over the Player)', async () => {
    const Live = await freshLive();
    const { rerender } = await openFavorites(Live, 2, 'Delta');
    press('ArrowDown');
    await liftHighlighted();
    press('ArrowUp');
    rerender(<Live creds={line} isActive={false} onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(lifted()).toBeUndefined());
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Delta', 'Charlie', 'Bravo'] });
    // Back with the remote: the list as left, nothing lifted, ▼ just moves the highlight.
    rerender(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await sleep(20);
    press('ArrowDown');
    expect(lifted()).toBeUndefined();
    expect(listed()).toEqual(['Alpha', 'Delta', 'Charlie', 'Bravo']);
  });

  it('an air mouse’s long press or right click on another row is ignored mid-move', async () => {
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    await liftHighlighted();
    press('ArrowDown');
    const charlie = Array.from(document.querySelectorAll('[data-howto="live.channels"] [data-focused]')).find((el) => nameIn(el) === 'Charlie') as HTMLElement;
    act(() => { fireEvent.contextMenu(charlie); });
    act(() => { fireEvent.click(charlie); });
    await sleep(50);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(lifted()).toBe('Delta');
    expect(highlighted()).toBe('Delta');
    press('ArrowDown');
    press('Enter');
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Charlie', 'Delta', 'Bravo'] });
  });
});

describe('Favorites: Move on the logo wall', () => {
  it('◀▶ one place, ▲▼ a row (held at the ends), OK puts it down', async () => {
    cfg.layout = 'grid';
    localStorage.setItem('snow-view-size', 'large');
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Delta');
    await liftHighlighted();
    expect(document.querySelector('[data-fav-moving]')?.textContent).toContain('◀ ▲▼ ▶');
    press('ArrowRight');
    expect(listed()).toEqual(['Alpha', 'Delta', 'Charlie', 'Bravo']);
    press('ArrowRight');
    expect(listed()).toEqual(['Alpha', 'Charlie', 'Delta', 'Bravo']);
    press('ArrowLeft');
    expect(listed()).toEqual(['Alpha', 'Delta', 'Charlie', 'Bravo']);
    // A row down: past the last tile, so it stops there.
    press('ArrowDown');
    expect(listed()).toEqual(['Alpha', 'Charlie', 'Bravo', 'Delta']);
    press('ArrowUp');
    expect(listed()).toEqual(['Delta', 'Alpha', 'Charlie', 'Bravo']);
    // ◀ at the first tile stays (no categories mid-move).
    press('ArrowLeft');
    expect(highlighted()).toBe('Delta');
    press('ArrowRight'); press('ArrowRight');
    press('Enter');
    expect(lifted()).toBeUndefined();
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Charlie', 'Delta', 'Bravo'] });
  });
});

describe('Favorites: channel ▲▼ full screen walks the list in its order', () => {
  it('in the own order, and A–Z when sorted', async () => {
    saveOrder('mine', [[MAIN, 3, 'Charlie'], [MAIN, 1, 'Alpha'], [MAIN, 4, 'Delta'], [MAIN, 2, 'Bravo']]);
    const Live = await freshLive();
    await openFavorites(Live, 2, 'Charlie');
    press('Enter');
    const bar = () => document.querySelector('h2.text-lg')?.textContent ?? '';
    await waitFor(() => expect(bar()).toContain('Charlie'));
    press('ArrowDown');
    expect(bar()).toContain('Alpha');
    press('ArrowDown');
    expect(bar()).toContain('Delta');
    press('ArrowUp');
    press('ArrowUp');
    expect(bar()).toContain('Charlie');
    // Sorted A–Z (another screen, or the menu): the next channel follows it.
    const { saveFavOrder, loadFavOrder } = await import('@/lib/favoritesOrder');
    act(() => saveFavOrder({ ...loadFavOrder(), mode: 'az' }));
    press('ArrowDown');
    expect(bar()).toContain('Delta');
    press('ArrowUp');
    press('ArrowUp');
    expect(bar()).toContain('Bravo');
  });
});

describe('Favorites with two services', () => {
  it('the shared Favorites and each service’s own follow one order; a move in the shared one is saved for both', async () => {
    cfg.saved = [{ id: 'v', serverLabel: 'Vibez', host: 'http://v.test', username: 'vuser', password: 'vpw', output: 'm3u8', addedAt: 1 }];
    cfg.favs = {
      'http://h.test': [fav(101, 'News One'), fav(102, 'News Two')],
      'http://v.test': [fav(555, 'Vibez Sports')],
    };
    saveOrder('mine', [[VIBEZ, 555, 'Vibez Sports'], [MAIN, 102, 'News Two'], [MAIN, 101, 'News One']]);
    const Live = await freshLive();
    render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
    await waitFor(() => expect(text()).toContain('Favorites · all services'));
    await sleep(30);
    // Categories: Favorites · all services, DreamStreams, Favorites, All channels, News, …
    const cats = () => Array.from(document.querySelectorAll('[data-cat-idx]')).map((el) => el.textContent ?? '');
    const at = (label: string) => cats().findIndex((c) => c.startsWith(label));
    await waitFor(() => expect(at('News')).toBeGreaterThan(0));
    const toFavs = at('News') - at('Favorites · all services');
    for (let i = 0; i < toFavs; i++) press('ArrowUp');
    press('ArrowRight');
    await waitFor(() => expect(listed()).toEqual(['Vibez Sports', 'News Two', 'News One']));

    // News One to the top of the shared list.
    press('ArrowDown'); press('ArrowDown');
    await holdOk();
    pick('Move');
    await waitFor(() => expect(lifted()).toBe('News One'));
    press('ArrowUp'); press('ArrowUp');
    press('Enter');
    expect(listed()).toEqual(['News One', 'Vibez Sports', 'News Two']);
    expect(savedOrder()?.names).toEqual(['News One', 'Vibez Sports', 'News Two']);

    // DreamStreams' own Favorites: the same order, Vibez left out.
    press('ArrowLeft');
    press('ArrowDown'); press('ArrowDown');
    press('ArrowRight');
    await waitFor(() => expect(listed()).toEqual(['News One', 'News Two']));
  });
});

describe('Favorites on a touch screen', () => {
  it('Move up / Move down, one place a tap (no ▲▼ to carry it); none past the ends', async () => {
    const Live = await freshLive();
    // The module LiveSection was loaded with (freshLive starts a new set).
    const pm = await import('@/lib/phoneMode');
    act(() => pm.__setPhoneModeForTests({ touch: true, phone: false }));
    await openFavorites(Live, 2, 'Delta');
    const row = (name: string) => Array.from(document.querySelectorAll('[data-howto="live.channels"] [data-focused]')).find((el) => nameIn(el) === name) as HTMLElement;
    act(() => { fireEvent.contextMenu(row('Delta')); });
    await waitFor(() => expect(menuRows()).toContain('Cancel'));
    expect(menuRows()).toContain('Move down');
    expect(menuRows()).not.toContain('Move up');
    expect(menuRows()).not.toContain('Move');
    const button = (label: string) => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent === label) as HTMLElement;
    act(() => { fireEvent.click(button('Move down')); });
    await waitFor(() => expect(listed()).toEqual(['Alpha', 'Delta', 'Charlie', 'Bravo']));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(savedOrder()).toEqual({ mode: 'mine', names: ['Alpha', 'Delta', 'Charlie', 'Bravo'] });

    act(() => { fireEvent.contextMenu(row('Bravo')); });
    await waitFor(() => expect(menuRows()).toContain('Move up'));
    expect(menuRows()).not.toContain('Move down');
    act(() => { fireEvent.click(button('Move up')); });
    await waitFor(() => expect(listed()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']));
  });
});
