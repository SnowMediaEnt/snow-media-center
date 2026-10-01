/**
 * A channel handed to Live TV from outside its list (Game Day's Watch, a
 * kickoff reminder, the content bar) plays full screen, and the player bar
 * names THAT channel — its own number, name and guide — never the first row
 * of whatever category the list is open on (the Fire TV showed the Golf
 * Channel's picture under "1 · [USA] A&E – Ozark Law"). The list then follows
 * the channel to its own category, so CH+ / CH- walk its neighbours.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { handLiveDeeplink } from '@/lib/appActions';

const h = vi.hoisted(() => ({ saved: [] as unknown[], epgAsked: [] as string[] }));

const NEWS: XtreamLiveStream[] = [
  { stream_id: 101, name: '[USA] A&E', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const SPORTS: XtreamLiveStream[] = [
  { stream_id: 201, name: 'Golf Channel', num: 7, category_id: '2' },
  { stream_id: 202, name: 'Sports Two', num: 8, category_id: '2' },
];
// The second line (another service) numbers its channels its own way: its
// 101 is a golf channel too, and in a category not listed here.
const SECOND_HOST = 'http://two.test';

const b64 = (s: string) => btoa(s);
const nowShow = (title: string) => {
  const now = Math.floor(Date.now() / 1000);
  return { title: b64(title), description: '', start_timestamp: String(now - 600), stop_timestamp: String(now + 3000) };
};
const GUIDE: Record<string, string> = {
  'http://h.test:101': 'Ozark Law',
  'http://h.test:102': 'Evening News',
  'http://h.test:201': 'The Open Championship',
  'http://h.test:202': 'Fight Night',
  'http://h.test:301': 'Owner Feed Show',
  [`${SECOND_HOST}:101`]: 'Ryder Cup Live',
};

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => h.saved,
  getLiveCategories: async (l: XtreamCreds) => (l.host === SECOND_HOST
    ? [{ category_id: '5', category_name: 'Two News' }]
    : [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }]),
  getLiveStreams: async (l: XtreamCreds, cat?: string) => {
    if (l.host === SECOND_HOST) return [{ stream_id: 501, name: 'Two One', num: 1, category_id: '5' }];
    return cat === '1' ? NEWS.map((c) => ({ ...c })) : cat === '2' ? SPORTS.map((c) => ({ ...c })) : [...NEWS, ...SPORTS];
  },
  getShortEpg: async (l: XtreamCreds, id: number) => {
    h.epgAsked.push(`${l.host}:${id}`);
    const title = GUIDE[`${l.host}:${id}`];
    return { epg_listings: title ? [nowShow(title)] : [] };
  },
  countLiveStreams: async () => ({ total: 4, byCat: {} }),
}));
vi.mock('@/lib/favoritesSync', async (orig) => {
  const o = await orig<typeof import('@/lib/favoritesSync')>();
  return {
    ...o,
    scheduleFavoritesPushForLine: vi.fn(),
    reconcileFavoritesForLine: vi.fn(async () => null),
    flushFavoritesPush: vi.fn(),
  };
});
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
vi.mock('@/lib/watchHistory', () => ({ recordChannelWatch: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
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

import LiveSection from './LiveSection';

const creds: XtreamCreds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' };
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const text = () => document.body.textContent ?? '';
const barTitle = () => document.querySelector('[data-howto="bar.channel"] h2')?.textContent ?? '';
const playing = () => document.querySelector('[data-testid="video"]')?.getAttribute('data-src') ?? '';
const media = async (k: string) => { await act(async () => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: k })); await Promise.resolve(); }); };
const waitFor = async (ok: () => boolean) => { for (let i = 0; i < 150 && !ok(); i++) await settle(20); };

/** Live TV open on News (its first row: "1 · [USA] A&E"), as on the box. */
const openLiveTv = async () => {
  render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
  await waitFor(() => text().includes('[USA] A&E'));
  expect(text()).toContain('[USA] A&E');
};
const hand = async (d: Parameters<typeof handLiveDeeplink>[0]) => {
  await act(async () => { handLiveDeeplink(d); await Promise.resolve(); });
  await waitFor(() => !!document.querySelector('[data-testid="video"]'));
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.saved = []; h.epgAsked = [];
});
afterEach(() => { document.documentElement.className = ''; });

describe('a channel handed over by Game Day', () => {
  it('the bar names the channel playing, with its own guide, not the first row of the open category', async () => {
    await openLiveTv();
    await hand({ host: creds.host, username: creds.username, streamId: 201, name: 'Golf Channel', num: 7, categoryId: '2' });
    expect(playing()).toMatch(/\/201\.ts$/);
    await waitFor(() => text().includes('The Open Championship'));
    expect(barTitle()).toBe('7 · Golf Channel');
    expect(text()).toContain('The Open Championship');
    expect(text()).not.toContain('[USA] A&E');
    expect(text()).not.toContain('Ozark Law');
    expect(h.epgAsked).toContain('http://h.test:201');
  });

  it('CH+ / CH- then walk the channel\'s own category', async () => {
    await openLiveTv();
    await hand({ host: creds.host, username: creds.username, streamId: 201, name: 'Golf Channel', num: 7, categoryId: '2' });
    // The list follows the channel to Sports once that category is read.
    await settle(400);
    await media('chup');
    await settle(10);
    expect(playing()).toMatch(/\/202\.ts$/);
    expect(barTitle()).toBe('8 · Sports Two');
    await media('chdown');
    await settle(10);
    expect(playing()).toMatch(/\/201\.ts$/);
    expect(barTitle()).toBe('7 · Golf Channel');
  });

  it('an owner-added channel in no list keeps its own name; CH+ goes to the focused row, not past it', async () => {
    await openLiveTv();
    await hand({ host: creds.host, username: creds.username, streamId: 301, name: 'Owner Feed' });
    await waitFor(() => text().includes('Owner Feed Show'));
    expect(barTitle()).toBe('Owner Feed');
    expect(text()).toContain('Owner Feed Show');
    expect(text()).not.toContain('Ozark Law');
    await media('chup');
    await settle(10);
    expect(playing()).toMatch(/\/101\.ts$/);
    expect(barTitle()).toBe('1 · [USA] A&E');
  });

  it('a link on another line: its own name and guide, even when this line has a channel with the same id', async () => {
    h.saved = [{ id: 'two', serverLabel: 'Two TV', host: SECOND_HOST, username: 'v', password: 'q', output: 'ts', addedAt: 1 }];
    await openLiveTv();
    await hand({ host: SECOND_HOST, username: 'v', streamId: 101, name: 'Golf Two', num: 44, categoryId: '9' });
    expect(playing()).toContain(SECOND_HOST);
    await waitFor(() => text().includes('Ryder Cup Live'));
    expect(barTitle()).toBe('44 · Golf Two');
    expect(text()).toContain('Ryder Cup Live');
    expect(text()).not.toContain('Ozark Law');
    expect(text()).not.toContain('[USA] A&E');
  });
});

describe('a channel played from the list (unchanged)', () => {
  it('the bar names the focused channel and CH+ moves to the next row', async () => {
    await openLiveTv();
    act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    act(() => { fireEvent.keyUp(window, { key: 'ArrowRight' }); });
    await settle(10);
    act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
    act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
    await waitFor(() => text().includes('Ozark Law'));
    expect(barTitle()).toBe('1 · [USA] A&E');
    await media('chup');
    await settle(10);
    expect(barTitle()).toBe('2 · News Two');
  });
});
