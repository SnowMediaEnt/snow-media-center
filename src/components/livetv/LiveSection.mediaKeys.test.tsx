/**
 * The remote's Rewind / Fast-forward in a full-screen live channel go back /
 * forward 10 s (held: repeated), through the channel's rewind or, as here, a
 * seekable stream; they no longer change channel. CH+ / CH- (and Next /
 * Previous) change channel. With no rewind and nothing to seek, they say why.
 * The bar is the plain one when there is no rewind or recorder.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';

const h = vi.hoisted(() => ({
  seek: vi.fn(),
  toast: vi.fn(),
  seekable: true,
}));

const CH: XtreamLiveStream[] = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
];
const SPORTS: XtreamLiveStream[] = [{ stream_id: 201, name: 'Sports One', num: 3, category_id: '2' }];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }],
  getLiveStreams: async (_l: unknown, cat?: string) => (cat === '1' ? CH.map((c) => ({ ...c })) : cat === '2' ? SPORTS.map((c) => ({ ...c })) : [...CH, ...SPORTS]),
  getShortEpg: async () => ({ epg_listings: [] }),
  countLiveStreams: async () => ({ total: 3, byCat: {} }),
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
vi.mock('@/hooks/use-toast', () => ({ toast: h.toast, useToast: () => ({ toast: h.toast }) }));
// The web player: a stand-in with a controller and no stream.
vi.mock('./VideoPlayer', async () => {
  const { useEffect } = await import('react');
  const ctrl = {
    play: () => {}, pause: () => {}, togglePlay: () => {}, seek: (s: number) => { h.seek(s); },
    isPaused: () => false, isSeekable: () => h.seekable,
    getSubtitleTracks: () => [{ id: 0, label: 'English CC', active: false }],
    setSubtitleTrack: () => {},
    getAudioTracks: () => [{ id: 0, label: 'Stereo', active: true }],
    setAudioTrack: () => {},
  };
  const Stub = ({ onReady }: { onReady?: (c: typeof ctrl) => void }) => {
    useEffect(() => { onReady?.(ctrl); }, [onReady]);
    return <div data-testid="video" />;
  };
  return { default: Stub };
});
vi.mock('./ReportChannelDialog', () => ({
  default: ({ channelName }: { channelName: string }) => <div data-testid="report">{channelName}</div>,
}));

import LiveSection from './LiveSection';

const creds: XtreamCreds = { host: 'http://h.test', username: 'u', password: 'p', output: 'ts', serverLabel: 'Acme TV' };
const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const press = (k: string) => {
  act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
  act(() => { fireEvent.keyUp(window, { key: k }); });
};
const media = async (k: string) => { await act(async () => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: k })); await Promise.resolve(); }); };
const until = async (sel: string) => {
  for (let i = 0; i < 100 && !document.querySelector(sel); i++) await settle(20);
};
const text = () => document.body.textContent ?? '';
const barButtons = () => Array.from(document.querySelectorAll('button[aria-label]')).map((n) => n.getAttribute('aria-label'));

const watchNewsOne = async () => {
  render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
  await settle(10);
  press('ArrowRight');
  await settle(10);
  for (let i = 0; i < 100 && !text().includes('News One'); i++) await settle(20);
  press('Enter');
  await until('[data-testid="video"]');
  await settle(10);
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.seek.mockClear(); h.toast.mockClear(); h.seekable = true;
});
afterEach(() => { document.documentElement.className = ''; });

describe('remote media keys in a live channel', () => {
  it('Rewind / Fast-forward go back / forward 10 s and keep the channel', async () => {
    await watchNewsOne();
    expect(text()).toContain('News One');
    await media('rw');
    await settle(10);
    expect(h.seek).toHaveBeenCalledWith(-10);
    await media('ff');
    await settle(10);
    expect(h.seek).toHaveBeenLastCalledWith(10);
    expect(text()).toContain('News One');
    expect(text()).not.toContain('News Two');
  });

  it('CH+ / CH- change channel and never seek', async () => {
    await watchNewsOne();
    await media('chup');
    await settle(10);
    expect(text()).toContain('News Two');
    await media('chdown');
    await settle(10);
    expect(text()).toContain('News One');
    expect(h.seek).not.toHaveBeenCalled();
  });

  it('Next / Previous change channel too', async () => {
    await watchNewsOne();
    await media('next');
    await settle(10);
    expect(text()).toContain('News Two');
    await media('prev');
    await settle(10);
    expect(text()).toContain('News One');
    expect(h.seek).not.toHaveBeenCalled();
  });

  it('with no rewind and nothing to seek, Rewind says why instead of doing nothing', async () => {
    h.seekable = false;
    await watchNewsOne();
    await media('rw');
    await settle(10);
    expect(h.seek).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith({ title: 'Rewind is off. Turn on Rewind live TV in Live TV settings.' });
    expect(text()).toContain('News One');
  });
});

describe('the bar without rewind or a recorder', () => {
  it('is the plain one, with Stats last', async () => {
    await watchNewsOne();
    expect(barButtons()).toEqual([
      'Previous channel', 'Back 10s', 'Pause', 'Forward 10s', 'Next channel', 'Subtitles', 'Audio', expect.stringMatching(/^Volume \d+%$/), 'Stats',
    ]);
    expect(barButtons()).not.toContain('Go live');
    expect(barButtons()).not.toContain('Record');
    expect(document.querySelector('[data-rewind-timeline]')).toBeNull();
    expect(text()).toContain('LIVE');
  });
});
