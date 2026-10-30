// Back on Home within REFRESH_MS: the saved bar stands (no media-bar-feed
// call, no rebuild of the viewer's rows), unless something was played
// meanwhile. A poster already shown sharp is not asked for again as a tiny
// `&w=60` copy.
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn(), build: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: h.invoke },
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
  },
}));
vi.mock('@/lib/contentBar', () => ({
  buildViewerBar: h.build,
  buildFavoritesBar: async () => ({ items: [], hasLines: true }),
}));
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { fn(); return () => {}; },
  onFirstInteraction: (fn: () => void) => { fn(); return () => {}; },
}));
vi.mock('@/utils/pausableInterval', () => ({ setPausableInterval: () => () => {} }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAppLaunch: vi.fn() }));

import MediaBar from './MediaBar';
import { WATCH_HISTORY_EVENT } from '@/lib/watchHistory';

const POSTER = 'https://x.test/functions/v1/poster-proxy?u=abc';
const titles = () => [...document.querySelectorAll('[data-media-bar] button[title]')].map((b) => b.getAttribute('title'));

beforeEach(() => {
  localStorage.clear();
  h.invoke.mockReset();
  h.invoke.mockResolvedValue({ data: { items: [{ id: 'plex-900', source: 'plex', kind: 'movie', title: 'Feed Movie', ratingKey: '900', poster: POSTER }] }, error: null });
  h.build.mockReset();
  h.build.mockResolvedValue({ viewer: 'device', items: [{ id: 'plex-h', source: 'history', kind: 'movie', title: 'Watched Movie', ratingKey: '11' }], hasLines: true, hasPlex: true });
});

describe('content bar: back on Home', () => {
  it('a fresh saved bar is shown as it is: no feed call, no viewer rebuild', async () => {
    const first = render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Movie', 'Feed Movie']));
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.build).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<MediaBar />);
    await act(async () => {});
    expect(titles()).toEqual(['Watched Movie', 'Feed Movie']);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.build).toHaveBeenCalledTimes(1);
  });

  it('something played while Home was away: only the viewer rows are rebuilt', async () => {
    const first = render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Movie', 'Feed Movie']));
    first.unmount();
    window.dispatchEvent(new Event(WATCH_HISTORY_EVENT));
    render(<MediaBar />);
    await waitFor(() => expect(h.build).toHaveBeenCalledTimes(2));
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it('an old saved bar is loaded again', async () => {
    const first = render(<MediaBar />);
    await waitFor(() => expect(titles()).toEqual(['Watched Movie', 'Feed Movie']));
    first.unmount();
    const key = 'snow-media-bar-cache-v6';
    const saved = JSON.parse(localStorage.getItem(key)!);
    localStorage.setItem(key, JSON.stringify({ ...saved, fetchedAt: Date.now() - 6 * 60 * 1000 }));
    render(<MediaBar />);
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  });

  it('a poster shown sharp once is not asked for again as a tiny copy', async () => {
    const first = render(<MediaBar />);
    await waitFor(() => expect(document.querySelector(`img[src="${POSTER}"]`)).toBeTruthy());
    expect(document.querySelector(`img[src="${POSTER}&w=60"]`)).toBeTruthy();
    fireEvent.load(document.querySelector(`img[src="${POSTER}"]`)!);
    expect(document.querySelector(`img[src="${POSTER}&w=60"]`)).toBeNull();
    first.unmount();

    render(<MediaBar />);
    await waitFor(() => expect(document.querySelector(`img[src="${POSTER}"]`)).toBeTruthy());
    expect(document.querySelector(`img[src="${POSTER}&w=60"]`)).toBeNull();
  });
});
