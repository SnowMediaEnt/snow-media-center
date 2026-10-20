import { act, cleanup, configure, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds } from '@/lib/xtream';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';

configure({ asyncUtilTimeout: 6000 });

// Searching while a channel plays (owner, 2026-10-20: "How can we still watch
// tv while we search? If we have something on, can we make it like the
// preview window or part screen or something, maybe light opaque
// background").
// - Full screen: the channel list over the picture (◀) starts with a Search
//   row. ▲ from its first channel reaches it, OK types there; the picture
//   plays on behind (the native player keeps the same stream), the results
//   are the list's own search. The keyboard put away, the highlight is in the
//   results; OK on one plays it full screen the normal way and closes the
//   search and the list. Back, one layer at a time: the keyboard, the search,
//   the list.
// - The list layouts: a channel held in the preview box keeps playing there
//   while the viewer searches (useHeldPreview), in Classic and Compact.
// Invented names only.

const line = { host: 'http://h.test', username: 'someuser', password: 'secretpw', output: 'm3u8' as const, serverLabel: 'DreamStreams' };
const NEWS = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'News Three', num: 3, category_id: '1' },
];
const SPORTS = [
  { stream_id: 201, name: 'Sports One', num: 4, category_id: '2' },
  { stream_id: 202, name: 'Sports Two', num: 5, category_id: '2' },
];
const h = vi.hoisted(() => ({ back: [] as Array<() => void>, down: new Set<string>() }));
const player = vi.hoisted(() => ({ args: [] as Array<{ active: boolean; url: string | null; rect?: unknown }> }));
const layout = vi.hoisted(() => ({ id: 'classic' as 'classic' | 'compact' | 'grid' }));

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadFavoritesData: () => new Map(),
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }],
  getLiveStreams: async (_l: XtreamCreds, cat?: string) => (cat === '1' ? NEWS : cat === '2' ? SPORTS : [...NEWS, ...SPORTS]).map((c) => ({ ...c })),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 5, byCat: {} }),
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
  useDownChannels: () => h.down,
  signalChannel: vi.fn(),
  signalCategory: vi.fn(),
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
  useLiveLayout: () => layout.id,
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
// Every backButton listener the section registers, so a test can press the remote's Back.
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, cb: () => void) => {
      if (ev === 'backButton') h.back.push(cb);
      return { remove() { h.back = h.back.filter((f) => f !== cb); } };
    },
  },
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => true,
  SnowPlayer: { timeshiftStatus: async () => ({ state: 'off' }), timeshiftWipe: async () => {}, getEngines: async () => ({}), getStats: async () => ({}) },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  notifyRecordingsChanged: () => {},
  hasRecorder: () => false,
  SnowRecorder: {
    getVolumes: async () => ({ volumes: [] }),
    listSchedules: async () => ({ schedules: [] }),
    active: async () => ({ jobs: [] }),
    list: async () => ({ recordings: [], volumes: [] }),
    start: vi.fn(),
  },
}));
// The native player: what it was last asked to play, and where (no rect: full screen).
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: { active: boolean; url: string | null; rect?: unknown }) => {
    player.args.push(a);
    return { buffering: false, error: null, retry: () => {}, paused: false, controller: null };
  },
}));
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

const down = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : undefined }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const press = (k: string) => { down(k); up(k); };
const sleep = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const text = () => document.body.textContent ?? '';
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const fullScreen = () => q('.z-\\[60\\]');
const overlay = () => q('[data-channel-overlay]');
const searchRow = () => q('[data-overlay-search]');
const field = () => q<HTMLInputElement>('[data-overlay-search-input]');
const typing = () => overlay()?.getAttribute('data-overlay-typing') === 'true';
const overlayRows = () => [...document.querySelectorAll('[data-overlay-channel]')].map((r) => r.querySelector('p')?.textContent ?? '');
const overlayFocus = () => q('[data-overlay-channel][data-focused="true"] p')?.textContent ?? '';
const hint = () => q('[data-overlay-hint]')?.textContent ?? '';
const barUp = () => !!q('[data-howto="bar.root"]');
const row = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-howto="live.channels"] [data-focused]')).find((el) => (el.textContent ?? '').includes(name));
const playingTag = () => q('[data-preview-playing]')?.textContent ?? null;
/** The stream the native player has, as a stream id (null: none). */
const inPlayer = (): number | null => {
  const a = player.args[player.args.length - 1];
  const m = a?.active && a.url ? /\/(\d+)\.ts/.exec(a.url) : null;
  return m ? Number(m[1]) : null;
};
/** Full screen (the native player has no box to fit). */
const playerFull = () => { const a = player.args[player.args.length - 1]; return !!a?.active && a.rect === undefined; };
/** The remote's Back as Capacitor delivers it, with no Player shell around the section. */
const hwBack = async () => { await act(async () => { for (const f of [...h.back]) f(); }); await sleep(20); };
/** A remote button the box reports as a media key (CH+ is 'chup'). */
const media = async (k: string) => { await act(async () => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: k })); await Promise.resolve(); }); await sleep(20); };
const warning = () => q('[data-channel-warning]');
/** What the viewer types, as the field takes it. */
const type = (value: string) => act(() => { fireEvent.change(field()!, { target: { value } }); });

async function openNews() {
  vi.resetModules();
  const { default: Live } = await import('./LiveSection');
  const r = render(<Live creds={line} isActive onExitLeft={() => {}} onBack={() => {}} />);
  await sleep(20);
  press('ArrowRight');
  await waitFor(() => expect(text()).toContain('News Three'));
  await sleep(50);
  return r;
}
/** News One full screen, the bar down, the list over the picture open on it. */
async function overPicture() {
  await openNews();
  press('Enter');
  await waitFor(() => expect(fullScreen()).not.toBeNull());
  await waitFor(() => expect(barUp()).toBe(true));
  press('Escape'); // the bar
  press('ArrowLeft'); // the list over the picture
  await waitFor(() => expect(overlay()).not.toBeNull());
  expect(overlayFocus()).toBe('News One');
  expect(inPlayer()).toBe(101);
}
/** ▲ onto Search, OK: the keyboard up on the field. */
async function startTyping() {
  press('ArrowUp');
  expect(searchRow()?.getAttribute('data-focused')).toBe('true');
  press('Enter');
  await sleep(10);
  expect(typing()).toBe(true);
  expect(document.activeElement).toBe(field());
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  player.args.length = 0;
  h.back = [];
  h.down = new Set();
  layout.id = 'classic';
});
afterEach(() => { cleanup(); document.documentElement.className = ''; });

describe('search over the picture', () => {
  it('the Search row is the list\'s first row: ▲ from the first channel, ▼ from the last comes round to it', async () => {
    await overPicture();
    expect(searchRow()).not.toBeNull();
    expect(searchRow()!.getAttribute('data-focused')).toBe('false');
    expect(field()!.placeholder).toBe('Search channels');
    expect(field()!.readOnly).toBe(true);
    // It sits above the channels, in the same see-through list.
    const rows = [...overlay()!.querySelectorAll('[data-overlay-search], [data-overlay-channel]')];
    expect(rows[0]).toBe(searchRow());
    expect(overlay()!.className.split(' ')).toContain('bg-black/60');
    press('ArrowUp');
    expect(searchRow()!.getAttribute('data-focused')).toBe('true');
    expect(overlayFocus()).toBe('');
    expect(hint()).toBe('OK search · ▼ channels · ◀ categories · Back close');
    press('ArrowDown');
    expect(overlayFocus()).toBe('News One');
    press('ArrowDown');
    press('ArrowDown');
    expect(overlayFocus()).toBe('News Three');
    press('ArrowDown');
    expect(searchRow()!.getAttribute('data-focused')).toBe('true');
    press('ArrowUp'); // round to the last
    expect(overlayFocus()).toBe('News Three');
    // Nothing of this touched the picture.
    expect(inPlayer()).toBe(101);
    expect(playerFull()).toBe(true);
  }, 20000);

  it('types over the picture: the results come in while the same channel plays; ▼ into them, OK plays one full screen and closes the list', async () => {
    await overPicture();
    await startTyping();
    expect(hint()).toBe('Type a channel name · Back to the results');
    type('two');
    await waitFor(() => expect(overlayRows()).toEqual(['News Two', 'Sports Two']));
    // The picture plays on, full screen, on the same stream.
    expect(inPlayer()).toBe(101);
    expect(playerFull()).toBe(true);
    expect(fullScreen()).not.toBeNull();
    // Still typing: the field and the results, no row highlighted, no heading.
    expect(typing()).toBe(true);
    expect(overlayFocus()).toBe('');
    expect(overlay()!.textContent).not.toContain('1 / 2');
    // ▼ puts the keyboard away: the highlight is in the results.
    press('ArrowDown');
    expect(typing()).toBe(false);
    expect(document.activeElement).not.toBe(field());
    expect(field()!.readOnly).toBe(true);
    expect(field()!.value).toBe('two');
    expect(overlayFocus()).toBe('News Two');
    expect(hint()).toBe('▲▼ channel · OK watch · Hold OK options · ◀ categories · Back channels');
    press('ArrowDown');
    expect(overlayFocus()).toBe('Sports Two');
    // Past the moment an Enter is taken for the keyboard's parting one.
    await sleep(750);
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(202));
    expect(overlay()).toBeNull();
    expect(fullScreen()).not.toBeNull();
    expect(playerFull()).toBe(true);
    // The list behind followed it to its own category, the search closed:
    // Back from the picture lands on it there.
    await waitFor(() => expect(barUp()).toBe(true));
    press('Escape'); // the bar
    press('Escape'); // the picture
    await waitFor(() => expect(fullScreen()).toBeNull());
    await waitFor(() => expect(row('Sports Two')?.getAttribute('data-focused')).toBe('true'));
    expect(text()).toContain('Sports One');
    expect(text()).not.toContain('News Three');
    expect(q('input[type="text"]')).toBeNull();
  }, 20000);

  it('while typing, the field and the first 4 results only, a little smaller; then the list as ever', async () => {
    await overPicture();
    await startTyping();
    type('s');
    await waitFor(() => expect(overlayRows().length).toBe(4));
    const first = q('[data-overlay-channel]')!;
    expect(first.style.height).toBe('40px');
    expect(searchRow()!.style.height).toBe('44px');
    // Back (the keyboard's own on a box) puts it away, into the results.
    press('Escape');
    expect(typing()).toBe(false);
    expect(overlay()).not.toBeNull();
    expect(overlayRows().length).toBe(5); // the Search row and all 5 fit in the list's 7 places
    expect(q('[data-overlay-channel]')!.style.height).toBe('52px');
    // Best matches first: the names that start with it.
    expect(overlayRows()).toEqual(['Sports One', 'Sports Two', 'News One', 'News Two', 'News Three']);
    expect(overlayFocus()).toBe('Sports One');
  }, 20000);

  it('the keyboard\'s parting Enter as it goes away plays nothing; the very next OK does', async () => {
    await overPicture();
    await startTyping();
    type('sports');
    await waitFor(() => expect(overlayRows()).toEqual(['Sports One', 'Sports Two']));
    press('Escape'); // the keyboard away …
    press('Enter'); // … and the Enter it sends as it goes
    await sleep(50);
    expect(overlay()).not.toBeNull();
    expect(inPlayer()).toBe(101);
    // Only that one: the viewer's OK straight after is a press.
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(201));
    expect(overlay()).toBeNull();
  }, 20000);

  it('CH+ / CH- while a search is open close it and the list first, then zap through the list the viewer was in, not the results', async () => {
    await overPicture();
    await startTyping();
    type('sports');
    await waitFor(() => expect(overlayRows()).toEqual(['Sports One', 'Sports Two']));
    // Mid-typing: CH+ is News Two (after News One in News), never Sports One.
    await media('chup');
    await waitFor(() => expect(inPlayer()).toBe(102));
    expect(overlay()).toBeNull();
    expect(playerFull()).toBe(true);
    // The search is gone: the list over the picture opens on News again.
    await media('chdown');
    await waitFor(() => expect(inPlayer()).toBe(101));
    press('Escape'); // the bar the zap brought up
    press('ArrowLeft');
    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(overlayRows()).toEqual(['News One', 'News Two', 'News Three']);
    expect(overlayFocus()).toBe('News One');
    expect(field()!.value).toBe('');
    // Results walked into: CH- wraps through News too (News Three), not the results.
    await sleep(750); // the keyboard CH+ put away may still send its Enter
    press('ArrowUp');
    press('Enter');
    type('sports');
    await waitFor(() => expect(overlayRows()).toEqual(['Sports One', 'Sports Two']));
    press('ArrowDown');
    await media('chdown');
    await waitFor(() => expect(inPlayer()).toBe(103));
    expect(overlay()).toBeNull();
  }, 20000);

  it('a search pick reported down asks first over the list; Pick another comes back to the results, Watch anyway plays it', async () => {
    h.down = new Set(['h.test|202']);
    await overPicture();
    await startTyping();
    type('two');
    await waitFor(() => expect(overlayRows()).toEqual(['News Two', 'Sports Two']));
    press('ArrowDown'); // the keyboard away
    press('ArrowDown');
    expect(overlayFocus()).toBe('Sports Two');
    await sleep(750); // past the keyboard's parting Enter
    press('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    // The list and the search are still there under it, the picture on.
    expect(overlay()).not.toBeNull();
    expect(overlayRows()).toEqual(['News Two', 'Sports Two']);
    expect(inPlayer()).toBe(101);
    press('Escape'); // Pick another
    await waitFor(() => expect(warning()).toBeNull());
    expect(overlay()).not.toBeNull();
    expect(overlayRows()).toEqual(['News Two', 'Sports Two']);
    expect(overlayFocus()).toBe('Sports Two');
    expect(field()!.value).toBe('two');
    expect(inPlayer()).toBe(101);
    // Another go: Watch anyway (left of Pick another) plays it and closes them.
    press('Enter');
    await waitFor(() => expect(warning()).not.toBeNull());
    press('ArrowLeft');
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(202));
    expect(warning()).toBeNull();
    expect(overlay()).toBeNull();
    expect(playerFull()).toBe(true);
  }, 20000);

  it('a pick the list behind already holds (All channels) stays there, rather than moving to its own category', async () => {
    await openNews();
    press('ArrowLeft'); // the categories
    press('ArrowUp'); // All channels
    press('Enter');
    await waitFor(() => expect(text()).toContain('Sports Two'));
    await sleep(50);
    press('Enter'); // News One, full screen
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    await waitFor(() => expect(barUp()).toBe(true));
    press('Escape');
    press('ArrowLeft');
    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(overlayRows()).toContain('Sports Two'); // All channels
    await startTyping();
    type('sports two');
    await waitFor(() => expect(overlayRows()).toEqual(['Sports Two']));
    press('ArrowDown');
    await sleep(750);
    press('Enter');
    await waitFor(() => expect(inPlayer()).toBe(202));
    press('Escape'); // the bar
    press('Escape'); // the picture
    await waitFor(() => expect(fullScreen()).toBeNull());
    // Still All channels (News One is in it, not in Sports), on Sports Two.
    await waitFor(() => expect(row('Sports Two')?.getAttribute('data-focused')).toBe('true'));
    expect(row('News One')).toBeDefined();
  }, 20000);

  it('Back closes one layer at a time: the keyboard, the search (the list as it was), the list; the picture plays on', async () => {
    await overPicture();
    await startTyping();
    type('two');
    await waitFor(() => expect(overlayRows()).toEqual(['News Two', 'Sports Two']));
    // 1: the keyboard.
    press('Escape');
    expect(typing()).toBe(false);
    expect(overlay()).not.toBeNull();
    expect(overlayRows()).toEqual(['News Two', 'Sports Two']);
    // 2: the search — News again, the highlight on the Search row it was opened from.
    press('Escape');
    expect(overlay()).not.toBeNull();
    await waitFor(() => expect(overlayRows()).toEqual(['News One', 'News Two', 'News Three']));
    expect(searchRow()!.getAttribute('data-focused')).toBe('true');
    expect(field()!.value).toBe('');
    expect(hint()).toBe('OK search · ▼ channels · ◀ categories · Back close');
    expect(inPlayer()).toBe(101);
    // 3: the list (the remote's Back as the box delivers it).
    await hwBack();
    expect(overlay()).toBeNull();
    expect(fullScreen()).not.toBeNull();
    expect(inPlayer()).toBe(101);
    expect(playerFull()).toBe(true);
    // And the next Back leaves the picture for the list, on the channel.
    await hwBack();
    await waitFor(() => expect(fullScreen()).toBeNull());
    await waitFor(() => expect(row('News One')?.getAttribute('data-focused')).toBe('true'));
  }, 20000);

  it('the remote\'s Back as the box delivers it leaves the search too, one step', async () => {
    await overPicture();
    await startTyping();
    type('sports');
    await waitFor(() => expect(overlayRows()).toEqual(['Sports One', 'Sports Two']));
    press('ArrowDown'); // the keyboard away, into the results
    await hwBack();
    await waitFor(() => expect(overlayRows()).toEqual(['News One', 'News Two', 'News Three']));
    expect(overlay()).not.toBeNull();
    expect(inPlayer()).toBe(101);
  }, 20000);

  it('Backspace while typing deletes a letter, it is not Back', async () => {
    await overPicture();
    await startTyping();
    type('two');
    await waitFor(() => expect(overlayRows()).toEqual(['News Two', 'Sports Two']));
    down('Backspace');
    expect(typing()).toBe(true);
    expect(overlay()).not.toBeNull();
    expect(field()!.value).toBe('two');
  }, 20000);

  it('its categories opened over the results fold away first; then the search, then the list', async () => {
    await overPicture();
    await startTyping();
    type('two');
    await waitFor(() => expect(overlayRows()).toEqual(['News Two', 'Sports Two']));
    press('ArrowDown'); // the keyboard away
    press('ArrowLeft'); // the categories beside the results
    expect(overlay()!.querySelector('[data-overlay-cat]')).not.toBeNull();
    press('Escape');
    expect(overlay()!.querySelector('[data-overlay-cat]')).toBeNull();
    expect(overlayRows()).toEqual(['News Two', 'Sports Two']);
    expect(overlayFocus()).toBe('News Two');
    press('Escape');
    await waitFor(() => expect(overlayRows()).toEqual(['News One', 'News Two', 'News Three']));
    press('Escape');
    expect(overlay()).toBeNull();
    expect(inPlayer()).toBe(101);
  }, 20000);
});

describe('the list\'s own search with a channel held in the preview box', () => {
  /** OK on News One, then Back twice (the bar, then the picture): News One stays in the box. */
  async function watchNewsOneAndComeBack() {
    press('Enter');
    await waitFor(() => expect(fullScreen()).not.toBeNull());
    press('Escape');
    press('Escape');
    await waitFor(() => expect(fullScreen()).toBeNull());
    await waitFor(() => expect(text()).toContain('News Three'));
  }
  /** Search channels (above the categories), OK, then what is typed. */
  async function searchFor(words: string) {
    press('ArrowLeft'); // the categories
    // Up past Favorites and All channels to Search channels.
    for (let i = 0; i < 5 && !q('[data-howto="live.searchBtn"][data-focused="true"]'); i++) press('ArrowUp');
    expect(q('[data-howto="live.searchBtn"][data-focused="true"]')).not.toBeNull();
    press('Enter');
    await waitFor(() => expect(q('input[type="text"]')).not.toBeNull());
    const box = q<HTMLInputElement>('input[type="text"]')!;
    act(() => { box.focus(); });
    act(() => { fireEvent.change(box, { target: { value: words } }); });
  }

  for (const id of ['classic', 'compact'] as const) {
    it(`${id}: the box keeps playing the held channel while the viewer searches and walks the results`, async () => {
      layout.id = id;
      await openNews();
      await watchNewsOneAndComeBack();
      expect(inPlayer()).toBe(101);
      await searchFor('sports');
      await waitFor(() => expect(text()).toContain('Sports Two'));
      await sleep(900); // past the preview's dwell
      // Still News One, in the box (a rect: not full screen), on screen with the field.
      expect(inPlayer()).toBe(101);
      expect(playerFull()).toBe(false);
      expect(q('[data-howto="live.preview"]')).not.toBeNull();
      expect(playingTag()).toBe('Playing: News One');
      // Into the results and along them: still News One.
      act(() => { fireEvent.keyDown(q('input[type="text"]')!, { key: 'ArrowDown' }); });
      press('ArrowDown');
      await sleep(900);
      expect(inPlayer()).toBe(101);
      expect(playingTag()).toBe('Playing: News One');
    }, 30000);
  }
});
