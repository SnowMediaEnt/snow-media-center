// The content bar for each Source and Show (Settings › Home screen):
// a sensible row every time, a short hint when a row has nothing, and the
// remote's OK — a press opens the tile, a hold the bar's menu.
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ch = (id: number, name: string) => ({ host: 'http://a.test', username: 'ua', streamId: id, name });
let viewerItems: unknown[] = [];
let favItems: unknown[] = [];
let favHasLines = true;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: async () => ({ data: { items: [{ id: 'plex-900', source: 'plex', kind: 'movie', title: 'Feed Movie', ratingKey: '900' }] }, error: null }) },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  },
}));
vi.mock('@/lib/contentBar', () => ({
  buildViewerBar: async () => ({ viewer: 'device', items: viewerItems, hasLines: true, hasPlex: true }),
  buildFavoritesBar: async () => ({ items: favItems, hasLines: favHasLines }),
}));
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { fn(); return () => {}; },
  onFirstInteraction: (fn: () => void) => { fn(); return () => {}; },
}));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAppLaunch: vi.fn() }));

import MediaBar from './MediaBar';
import { saveBarPrefs } from '@/lib/homeBar';

const titles = () => [...document.querySelectorAll('[data-media-bar] button[title]')].map((b) => b.getAttribute('title'));
const heading = () => document.querySelector('[data-media-bar] h2')!.textContent;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  viewerItems = [
    { id: 'ch-1', source: 'history', kind: 'channel', title: 'Watched Channel', channel: ch(1, 'Watched Channel') },
    { id: 'plex-h', source: 'history', kind: 'movie', title: 'Watched Movie', ratingKey: '11' },
    { id: 'ch-2', source: 'live', kind: 'channel', title: 'Live Channel', channel: ch(2, 'Live Channel') },
    { id: 'plex-f', source: 'foryou', kind: 'movie', title: 'For You Movie', ratingKey: '12' },
  ];
  favItems = [
    { id: 'ch-7', source: 'favorite', kind: 'channel', title: 'Fav Channel', subtitle: 'The Late Show', channel: ch(7, 'Fav Channel') },
    { id: 'plex-55', source: 'favorite', kind: 'movie', title: 'My List Movie', ratingKey: '55' },
  ];
  favHasLines = true;
});
afterEach(() => { vi.useRealTimers(); });

describe('content bar: Source × Show', () => {
  it('Live TV and Plex, Recommendations: today\'s bar (viewer rows, then the feed)', async () => {
    render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Channel', 'Watched Movie', 'Live Channel', 'For You Movie', 'Feed Movie']));
    expect(heading()).toBe('Recommended');
  });

  it('Live TV only: the channels; Plex only: the rest', async () => {
    saveBarPrefs({ source: 'live', show: 'recommended' });
    const a = render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Channel', 'Live Channel']));
    a.unmount();
    saveBarPrefs({ source: 'plex', show: 'recommended' });
    render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Movie', 'For You Movie', 'Feed Movie']));
  });

  it('Continue watching only', async () => {
    saveBarPrefs({ source: 'both', show: 'continue' });
    render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Channel', 'Watched Movie']));
    expect(heading()).toBe('Continue watching');
  });

  it('Favorites: their channels with what is on now, then My List; OK plays a channel like any bar channel', async () => {
    saveBarPrefs({ source: 'both', show: 'favorites' });
    const onOpenPlayer = vi.fn();
    render(<MediaBar active onOpenPlayer={onOpenPlayer} onHoldMenu={vi.fn()} />);
    await waitFor(() => expect(titles()).toEqual(['Fav Channel', 'My List Movie']));
    expect(heading()).toBe('Favorites');
    expect(screen.getByText('The Late Show')).toBeTruthy();
    await act(async () => {}); // the bar's key handler reads the page from its refs (set in effects)
    // A press: down and let go before the hold.
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
    expect(onOpenPlayer).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem('smc-live-deeplink')!)).toMatchObject({ streamId: 7, host: 'http://a.test' });
  });

  it('an empty row says why, and how to change it', async () => {
    favItems = [];
    favHasLines = false;
    saveBarPrefs({ source: 'live', show: 'favorites' });
    render(<MediaBar onHoldMenu={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('[data-bar-empty]')).toBeTruthy());
    expect(screen.getByText('Sign in to Live TV to see your channels here.')).toBeTruthy();
    expect(screen.getByText('Hold OK here to change what the bar shows.')).toBeTruthy();
  });
});

describe('content bar: hold OK', () => {
  it('held, the bar\'s menu (once, the OK still down); the release after it opens nothing', async () => {
    const onHoldMenu = vi.fn();
    const onOpenPlayer = vi.fn();
    render(<MediaBar active onHoldMenu={onHoldMenu} onOpenPlayer={onOpenPlayer} />);
    await waitFor(() => expect(titles().length).toBe(5));
    await act(async () => {});
    vi.useFakeTimers();
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    act(() => { fireEvent.keyDown(window, { key: 'Enter', repeat: true }); });
    act(() => { vi.advanceTimersByTime(650); });
    expect(onHoldMenu).toHaveBeenCalledTimes(1);
    expect(onHoldMenu).toHaveBeenCalledWith(true);
    act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
    expect(onOpenPlayer).not.toHaveBeenCalled();
  });

  it('OK on an empty bar opens Customize', async () => {
    favItems = [];
    saveBarPrefs({ source: 'both', show: 'favorites' });
    const onCustomize = vi.fn();
    render(<MediaBar active onHoldMenu={vi.fn()} onCustomize={onCustomize} />);
    await waitFor(() => expect(document.querySelector('[data-bar-empty]')).toBeTruthy());
    await act(async () => {});
    act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
    act(() => { fireEvent.keyUp(window, { key: 'Enter' }); });
    expect(onCustomize).toHaveBeenCalledWith(false);
  });
});
