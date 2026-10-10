/**
 * The remote over a full-screen channel, and Recently watched.
 *
 * Full screen with the bar hidden: ▶ opens Recently watched (the last 10
 * channels, newest first, on the channel before the one playing), OK
 * switches channel the normal way, one channel can be removed, Back closes
 * the panel first and the next Back leaves the picture for that channel's
 * category with it highlighted. ◀ opens the channel list over the picture on
 * the current channel in its own category; a channel picked there plays, and
 * Back lands on it in the list. ▶ at the list's right edge opens the same
 * panel over the list, solid, with the list's own highlight stepped aside.
 * Channels from two services play on their own line. Search finds no adult
 * channel, nor does a channel asked for by name (a search by voice).
 * Invented names only.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';

const h = vi.hoisted(() => ({ saved: [] as unknown[], back: [] as Array<() => void> }));

const SECOND_HOST = 'http://two.test';
const NEWS: XtreamLiveStream[] = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const SPORTS: XtreamLiveStream[] = [
  { stream_id: 201, name: 'Sports One', num: 3, category_id: '2' },
  { stream_id: 202, name: 'Sports Two', num: 4, category_id: '2' },
  { stream_id: 203, name: 'Branch Line Sports', num: 5, category_id: '2' },
  { stream_id: 204, name: 'Harborview Championship Final Live From The Coast 8 PM', num: 6, category_id: '2' },
];
const LATE: XtreamLiveStream[] = [{ stream_id: 901, name: 'Hot Encounters', num: 9, category_id: '9' }];
// The second service numbers its own way: its 101 is another channel.
const TWO: XtreamLiveStream[] = [
  { stream_id: 101, name: 'Valley One', num: 1, category_id: '5' },
  { stream_id: 502, name: 'Valley Two', num: 2, category_id: '5' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => h.saved,
  getLiveCategories: async (l: XtreamCreds) => (l.host === SECOND_HOST
    ? [{ category_id: '5', category_name: 'Valley' }]
    : [
      { category_id: '1', category_name: 'News' },
      { category_id: '2', category_name: 'Sports' },
      { category_id: '9', category_name: 'XXX | For Adults' },
    ]),
  getLiveStreams: async (l: XtreamCreds, cat?: string) => {
    if (l.host === SECOND_HOST) return TWO.map((c) => ({ ...c }));
    return (cat === '1' ? NEWS : cat === '2' ? SPORTS : cat === '9' ? LATE : [...NEWS, ...SPORTS, ...LATE]).map((c) => ({ ...c }));
  },
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 7, byCat: {} }),
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
vi.mock('@/lib/liveLayout', async (orig) => ({
  ...(await orig<typeof import('@/lib/liveLayout')>()),
  useLiveLayout: () => 'classic',
  hasLiveLayoutChoice: () => true,
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ data: null, error: null })) } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), getDeviceId: () => 'd' }));
// The real history on the box (nobody signed in: no account requests); a
// channel played is not written into it by these tests.
vi.mock('@/lib/watchHistory', async (orig) => ({ ...(await orig<typeof import('@/lib/watchHistory')>()), recordChannelWatch: vi.fn() }));
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
const toasts = vi.hoisted(() => ({ said: [] as string[] }));
vi.mock('@/hooks/use-toast', () => {
  const toast = (t: { title?: string }) => { toasts.said.push(String(t?.title ?? '')); };
  return { toast, useToast: () => ({ toast }) };
});
// The web player: a stand-in that says which stream it was given.
vi.mock('./VideoPlayer', async () => {
  const { useEffect } = await import('react');
  const ctrl = {
    play: () => {}, pause: () => {}, togglePlay: () => {}, seek: () => {},
    isPaused: () => false, isSeekable: () => false,
    getSubtitleTracks: () => [], setSubtitleTrack: () => {},
    getAudioTracks: () => [], setAudioTrack: () => {},
  };
  const Stub = ({ src, onReady }: { src?: string; onReady?: (c: typeof ctrl) => void }) => {
    useEffect(() => { onReady?.(ctrl); }, [onReady]);
    return <div data-testid="video" data-src={src} />;
  };
  return { default: Stub };
});
vi.mock('./ReportChannelDialog', () => ({ default: ({ channelName }: { channelName: string }) => <div data-testid="report">{channelName}</div> }));
// jsdom has no layout: every row is drawn.
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

import LiveSection from './LiveSection';
import { channelKey, loadWatchHistory, type WatchEntry } from '@/lib/watchHistory';
import { __setViewerForTests } from '@/lib/viewer';

const creds: XtreamCreds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' };
const second: XtreamCreds = { host: SECOND_HOST, username: 'v', password: 'q', output: 'ts', serverLabel: 'Valley TV' };
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (fn: () => boolean) => { for (let i = 0; i < 300 && !fn(); i++) await settle(20); return fn(); };
const down = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Escape' ? 27 : k === 'Enter' ? 13 : undefined }); });
const up = (k: string) => act(() => { fireEvent.keyUp(window, { key: k }); });
const press = (k: string) => { down(k); up(k); };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const text = () => document.body.textContent ?? '';
const panel = () => q('[data-recent-panel]');
const panelRows = () => [...document.querySelectorAll('[data-recent-row]')].map((r) => r.querySelector('p')?.textContent ?? '');
const panelFocus = () => q('[data-recent-row][data-focused="true"] p')?.textContent ?? null;
const overlay = () => q('[data-channel-overlay]');
const overlayFocus = () => overlay()?.querySelector('[data-overlay-channel][data-focused="true"]')?.textContent ?? '';
const barUp = () => !!q('[data-howto="bar.root"]');
const barTitle = () => q('[data-howto="bar.channel"] h2')?.textContent ?? '';
const playing = () => q('[data-testid="video"]')?.getAttribute('data-src') ?? '';
/** Full screen: the section's own lists are gone. */
const fullScreen = () => !q('[data-cat-idx]') && !!q('[data-testid="video"]');
/** The highlighted channel row in Live TV's list (not a category). */
const listFocus = () => [...document.querySelectorAll('[data-focused="true"]')]
  .filter((el) => !el.hasAttribute('data-cat-idx') && !el.closest('[data-recent-panel]'))
  .map((el) => el.textContent ?? '').join('|');
const history = () => loadWatchHistory('device').map((e) => e.title);
/** The remote's Back as Capacitor delivers it, with no Player shell around
 *  the section to turn it into a key. */
const hwBack = async () => { await act(async () => { for (const f of [...h.back]) f(); }); await settle(20); };

const entry = (line: XtreamCreds, st: XtreamLiveStream, at: number, subtitle: string): WatchEntry => ({
  kind: 'channel', key: channelKey(line, st.stream_id), title: st.name, subtitle, watchedAt: at, count: 1,
  channel: { host: line.host, username: line.username, streamId: st.stream_id, categoryId: String(st.category_id), num: st.num, serverLabel: line.serverLabel },
});

/** Open Live TV on News's channels. */
const openList = async () => {
  render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
  await until(() => text().includes('News One'));
  press('ArrowRight'); // News → its channels
  await until(() => listFocus().includes('News One'));
};
/** News One full screen, the bar hidden. */
const watchNewsOne = async () => {
  await openList();
  press('Enter');
  // The web player is a lazy chunk: the first test waits for it to load.
  await until(() => barUp() && fullScreen());
  press('Escape'); // hides the bar
  expect(barUp()).toBe(false);
  expect(fullScreen()).toBe(true);
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); toasts.said = []; h.saved = []; h.back = [];
  __setViewerForTests('device');
  // Newest first: News One (on screen in most tests), Sports Two, an adult
  // channel (never listed), News Two.
  localStorage.setItem('snow-watch-history:device', JSON.stringify([
    entry(creds, NEWS[0], 400, 'News'), entry(creds, SPORTS[1], 300, 'Sports'), entry(creds, LATE[0], 250, 'XXX | For Adults'), entry(creds, NEWS[1], 100, 'News'),
  ]));
});
afterEach(() => { cleanup(); document.documentElement.className = ''; });

describe('Recently watched over the picture (▶)', () => {
  it('▶ opens it newest first, on the channel before the one playing; no adult channel', async () => {
    await watchNewsOne();
    press('ArrowRight');
    expect(panel()?.getAttribute('data-recent-panel')).toBe('picture');
    expect(panelRows()).toEqual(['News One', 'Sports Two', 'News Two']);
    expect(panelFocus()).toBe('Sports Two');
    // The one on screen is marked.
    expect(q('[data-recent-row="h.test|u|101"] [aria-label="Playing"]')).not.toBeNull();
    press('ArrowDown');
    expect(panelFocus()).toBe('News Two');
    press('ArrowDown');
    expect(panelFocus()).toBe('News One'); // wraps
  });

  it('OK switches channel the normal way; Back then leaves the picture for its category, the channel highlighted', async () => {
    await watchNewsOne();
    press('ArrowRight');
    press('Enter'); // Sports Two
    await settle(20);
    expect(panel()).toBeNull();
    expect(fullScreen()).toBe(true);
    expect(playing()).toMatch(/\/202\.ts$/);
    await until(() => barTitle().includes('Sports Two'));
    expect(barTitle()).toBe('4 · Sports Two');
    press('Escape'); // hides the bar
    expect(fullScreen()).toBe(true);
    press('Escape'); // leaves the picture
    await until(() => listFocus().includes('Sports Two'));
    expect(fullScreen()).toBe(false);
    expect(listFocus()).toContain('Sports Two');
    expect(text()).toContain('Sports One');
    expect(text()).not.toContain('News Two');
  });

  it('Back (or ◀) closes it first, one step; the next Back leaves the picture for the list, the channel highlighted', async () => {
    await watchNewsOne();
    press('ArrowRight');
    expect(panel()).not.toBeNull();
    press('Escape');
    expect(panel()).toBeNull();
    expect(fullScreen()).toBe(true);
    expect(barUp()).toBe(false);
    press('ArrowRight');
    press('ArrowLeft');
    expect(panel()).toBeNull();
    expect(fullScreen()).toBe(true);
    press('Escape');
    await until(() => !fullScreen());
    expect(listFocus()).toContain('News One');
  });

  it('removes ONE channel: ▶ onto Remove then OK, or hold OK; the others stay, on the box too', async () => {
    await watchNewsOne();
    press('ArrowRight');
    press('ArrowRight'); // onto Sports Two's Remove
    expect(q('[data-recent-remove="h.test|u|202"][data-focused="true"]')).not.toBeNull();
    press('Enter');
    await settle(10);
    expect(panelRows()).toEqual(['News One', 'News Two']);
    expect(history()).not.toContain('Sports Two');
    expect(history()).toEqual(expect.arrayContaining(['News One', 'News Two']));
    // Nothing played: still News One, the panel still open.
    expect(panel()).not.toBeNull();
    expect(playing()).toMatch(/\/101\.ts$/);
    press('ArrowLeft'); // back onto the row
    expect(panelFocus()).toBe('News Two');
    // Hold OK on News Two.
    down('Enter');
    await settle(750);
    up('Enter');
    await settle(10);
    expect(panelRows()).toEqual(['News One']);
    expect(history()).not.toContain('News Two');
    expect(panel()).not.toBeNull();
    expect(playing()).toMatch(/\/101\.ts$/);
  });
});

describe('the remote\'s Back, as the box delivers it', () => {
  it('closes Recently watched, then the channel list over the picture, one step each; then the picture goes to the list', async () => {
    await watchNewsOne();
    press('ArrowRight');
    expect(panel()).not.toBeNull();
    await hwBack();
    expect(panel()).toBeNull();
    expect(fullScreen()).toBe(true);
    press('ArrowLeft');
    expect(overlay()).not.toBeNull();
    await hwBack();
    expect(overlay()).toBeNull();
    expect(fullScreen()).toBe(true);
    await hwBack();
    await until(() => !fullScreen());
    expect(listFocus()).toContain('News One');
  });
});

describe('◀ over the picture: the channel list on the current channel', () => {
  it('opens on the playing channel; ▼ then OK plays the next one, and Back lands on it in the list', async () => {
    await watchNewsOne();
    press('ArrowLeft');
    expect(overlay()).not.toBeNull();
    expect(overlayFocus()).toContain('News One');
    expect(barUp()).toBe(false);
    press('ArrowDown');
    expect(overlayFocus()).toContain('News Two');
    press('Enter');
    await settle(20);
    expect(overlay()).toBeNull();
    expect(playing()).toMatch(/\/102\.ts$/);
    press('Escape'); // the bar the new channel brought up
    press('Escape'); // leaves the picture
    await until(() => !fullScreen());
    expect(listFocus()).toContain('News Two');
  });

  it('in its own category, even when the list behind shows another (a channel asked for by voice)', async () => {
    await openList(); // News
    await act(async () => { window.dispatchEvent(new CustomEvent('smc:live-play', { detail: 'Sports Two' })); });
    await until(() => barUp() && barTitle().includes('Sports Two'));
    press('Escape');
    press('ArrowLeft');
    expect(overlay()).not.toBeNull();
    await until(() => overlayFocus().includes('Sports Two'));
    expect(overlayFocus()).toContain('Sports Two');
    expect(overlay()!.textContent).toContain('Sports One');
    expect(panel()).toBeNull();
  });

  it('◀ goes to its categories, ▼ rests on the next one, OK opens it; Back closes the list and the picture plays on', async () => {
    await watchNewsOne();
    press('ArrowLeft');
    press('ArrowLeft'); // its categories
    expect(overlay()!.querySelector('[data-overlay-cat][data-focused="true"]')?.textContent).toContain('News');
    press('ArrowDown');
    expect(overlay()!.querySelector('[data-overlay-cat][data-focused="true"]')?.textContent).toContain('Sports');
    press('Enter');
    await until(() => overlayFocus().includes('Sports One'));
    expect(overlay()!.textContent).toContain('Branch Line Sports');
    press('Escape');
    expect(overlay()).toBeNull();
    expect(fullScreen()).toBe(true);
    expect(playing()).toMatch(/\/101\.ts$/);
  });

  it('a long name is a step smaller on up to two lines, never a scrolling one', async () => {
    await watchNewsOne();
    press('ArrowLeft');
    press('ArrowLeft');
    press('ArrowDown'); // Sports
    press('Enter');
    await until(() => !!overlay()?.querySelector('[data-overlay-channel="204"]'));
    const longName = overlay()!.querySelector('[data-overlay-channel="204"] p')!;
    expect(longName.className).toContain('line-clamp-2');
    expect(longName.className).toContain('text-[13px]');
    const shortName = overlay()!.querySelector('[data-overlay-channel="201"] p')!;
    expect(shortName.className).toContain('truncate');
    expect(shortName.className).not.toContain('line-clamp-2');
  });
});

describe('the channel list: ▶ at its right edge', () => {
  it('opens Recently watched over the list, solid, the list\'s highlight stepped aside; OK plays that channel full screen', async () => {
    await openList();
    press('ArrowRight');
    expect(panel()?.getAttribute('data-recent-panel')).toBe('list');
    expect(panel()!.className).not.toContain('bg-black/90');
    expect(fullScreen()).toBe(false);
    // One highlight on screen: the panel's.
    expect(listFocus()).toBe('');
    expect(panelFocus()).toBe('News One'); // nothing playing: the newest
    press('ArrowDown');
    press('Enter'); // Sports Two
    await until(barUp);
    expect(barTitle()).toBe('4 · Sports Two');
    expect(panel()).toBeNull();
    press('Escape');
    press('Escape');
    await until(() => listFocus().includes('Sports Two'));
    expect(listFocus()).toContain('Sports Two');
  });

  it('Back closes it and stays on the list, its highlight back', async () => {
    await openList();
    press('ArrowRight');
    press('Escape');
    expect(panel()).toBeNull();
    expect(listFocus()).toContain('News One');
    expect(fullScreen()).toBe(false);
  });
});

describe('two services', () => {
  it('Recently watched lists both, each named; a pick on the second plays on its own line and the list follows it', async () => {
    h.saved = [{ id: 'two', serverLabel: second.serverLabel, host: second.host, username: second.username, password: second.password, output: 'ts', addedAt: 1 }];
    localStorage.setItem('snow-watch-history:device', JSON.stringify([
      entry(creds, NEWS[0], 400, 'News'), entry(second, TWO[0], 300, 'Valley'),
    ]));
    render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    await until(() => text().includes('Valley TV') && text().includes('News One'));
    press('ArrowRight');
    await until(() => listFocus().includes('News One'));
    press('Enter');
    await until(barUp);
    press('Escape');
    press('ArrowRight');
    expect(panelRows()).toEqual(['News One', 'Valley One']);
    // Same stream id, other service: not marked as the one playing.
    expect(q('[data-recent-row="two.test|v|101"] [aria-label="Playing"]')).toBeNull();
    expect(q('[data-recent-row="two.test|v|101"]')?.textContent).toContain('Valley TV');
    press('Enter'); // Valley One
    await until(() => playing().includes('two.test'));
    expect(playing()).toContain('two.test');
    expect(playing()).toMatch(/\/101\.ts$/);
    // The bar names the new channel (the same id as the one before, on another line).
    await until(() => barTitle().includes('Valley One'));
    expect(barTitle()).toBe('1 · Valley One');
    press('Escape'); // hides the bar
    // ◀: the list over the picture, on Valley One in its service's category.
    press('ArrowLeft');
    await until(() => overlayFocus().includes('Valley One'));
    expect(overlay()!.textContent).toContain('Valley TV · Valley');
    press('Escape'); // closes it
    expect(overlay()).toBeNull();
    press('Escape');
    await until(() => listFocus().includes('Valley One'));
    expect(listFocus()).toContain('Valley One');
  });
});

describe('search finds no adult channel', () => {
  it('"nc" lists the channels named so, never one from an adult category; "xxx" / "adult" find none', async () => {
    render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
    await until(() => text().includes('Search channels'));
    act(() => { fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Search channels'))!); });
    await until(() => !!q('input[type="text"]'));
    const box = q('input[type="text"]') as HTMLInputElement;
    act(() => { fireEvent.change(box, { target: { value: 'nc' } }); });
    await until(() => text().includes('Branch Line Sports'));
    expect(text()).toContain('Branch Line Sports');
    expect(text()).not.toContain('Hot Encounters');
    for (const words of ['encounters', 'xxx', 'adult']) {
      act(() => { fireEvent.change(box, { target: { value: words } }); });
      await settle(250);
      expect(text()).not.toContain('Hot Encounters');
    }
  });
});

describe('a channel asked for by name (voice, the assistant)', () => {
  const ask = (name: string) => act(async () => { window.dispatchEvent(new CustomEvent('smc:live-play', { detail: name })); });

  it('never an adult channel: "not found", nothing plays; others as before', async () => {
    await openList();
    await ask('Hot Encounters');
    await until(() => toasts.said.length > 0);
    expect(fullScreen()).toBe(false);
    await ask('Sports Two');
    await until(() => barTitle().includes('Sports Two'));
    expect(fullScreen()).toBe(true);
  });

  it('nor one in a category hidden in Hide Categories', async () => {
    localStorage.setItem('snow-livetv-hidden:h.test|u', JSON.stringify(['2']));
    await openList();
    await ask('Sports Two');
    await until(() => toasts.said.length > 0);
    expect(fullScreen()).toBe(false);
  });
});
