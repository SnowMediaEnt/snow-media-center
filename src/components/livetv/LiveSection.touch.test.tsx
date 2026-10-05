/**
 * "Tapping the menu doesn't pop up at all" (the owner, on his iPhone): a full
 * screen channel by finger. A tap on the picture toggles the bar, a tap on a
 * bar button does what OK does on it (and does not also toggle the bar), the
 * sub-menu rows take a tap, a swipe changes channel, and a tap on the
 * preview box plays its channel. On a TV (no touch UI) none of it is
 * attached: taps and clicks on the picture and the bar do nothing.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

const h = vi.hoisted(() => ({
  togglePlay: vi.fn(),
  setSubtitleTrack: vi.fn(),
}));

const CH: XtreamLiveStream[] = [
  { stream_id: 101, name: 'News One', num: 1, category_id: '1' },
  { stream_id: 102, name: 'News Two', num: 2, category_id: '1' },
  { stream_id: 103, name: 'News Three', num: 3, category_id: '1' },
];

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }],
  getLiveStreams: async () => CH.map((c) => ({ ...c })),
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
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn(), useToast: () => ({ toast: vi.fn() }) }));
// The web player: a stand-in with a controller and no stream.
vi.mock('./VideoPlayer', async () => {
  const { useEffect } = await import('react');
  const ctrl = {
    play: () => {}, pause: () => {}, togglePlay: () => { h.togglePlay(); }, seek: () => {},
    isPaused: () => false, isSeekable: () => true,
    getSubtitleTracks: () => [{ id: 0, label: 'English CC', active: false }],
    setSubtitleTrack: (i: number) => { h.setSubtitleTrack(i); },
    getAudioTracks: () => [{ id: 0, label: 'Stereo', active: true }],
    setAudioTrack: () => {},
  };
  const Stub = ({ onReady, muted }: { onReady?: (c: typeof ctrl) => void; muted?: boolean }) => {
    useEffect(() => { onReady?.(ctrl); }, [onReady]);
    return <div data-testid={muted ? 'preview' : 'video'} />;
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
const until = async (sel: string) => {
  for (let i = 0; i < 100 && !document.querySelector(sel); i++) await settle(20);
};
const text = () => document.body.textContent ?? '';
const q = (sel: string) => document.querySelector(sel) as HTMLElement;
const barUp = () => document.querySelector('[data-bar-control]') !== null;
const focusedBar = () => document.querySelector('[data-bar-control] button[data-focused="true"]')?.getAttribute('aria-label');
const button = (label: string) => document.querySelector(`[data-bar-control] button[aria-label="${label}"]`) as HTMLElement;

const at = (x: number, y: number) => [{ identifier: 0, clientX: x, clientY: y }];
/** A finger down and up on `el` (a tap where it lands; a swipe if it moved). */
const finger = (el: Element, x: number, y: number, x2 = x, y2 = y) => act(() => {
  fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) });
  fireEvent.touchEnd(el, { touches: [], changedTouches: at(x2, y2) });
});
/** A tap on a button, as a phone sends it: the touch, then the click. */
const tapButton = (el: Element) => {
  finger(el, 10, 10);
  act(() => { fireEvent.click(el); });
};

const openList = async () => {
  render(<LiveSection creds={creds} isActive onExitLeft={vi.fn()} onBack={vi.fn()} />);
  await settle(10);
  press('ArrowRight');
  await settle(10);
  for (let i = 0; i < 100 && !text().includes('News One'); i++) await settle(20);
};
const watchNewsOne = async () => {
  await openList();
  press('Enter');
  await until('[data-testid="video"]');
  await settle(10);
};

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  h.togglePlay.mockClear(); h.setSubtitleTrack.mockClear();
});
afterEach(() => {
  act(() => { __setPhoneModeForTests({ touch: false, phone: false }); });
  document.documentElement.className = '';
});

describe('a full-screen channel on a phone', () => {
  beforeEach(() => { act(() => { __setPhoneModeForTests({ touch: true, phone: true }); }); });

  it('a tap on the picture hides the bar, and the next brings it back on Play', async () => {
    await watchNewsOne();
    expect(barUp()).toBe(true);
    finger(q('[data-testid="video"]'), 200, 200);
    expect(barUp()).toBe(false);
    finger(q('[data-testid="video"]'), 200, 200);
    expect(barUp()).toBe(true);
    expect(focusedBar()).toBe('Pause');
  });

  it('a tap on a bar button does what OK does on it, and the bar stays', async () => {
    await watchNewsOne();
    // Play / pause.
    tapButton(button('Pause'));
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    expect(barUp()).toBe(true);
    // Report: the highlight moves there and the report flow opens for the channel.
    tapButton(button('Report channel'));
    await until('[data-testid="report"]');
    expect(q('[data-testid="report"]').textContent).toBe('News One');
    expect(focusedBar()).toBe('Report channel');
    expect(barUp()).toBe(true);
  });

  it('Next channel by tap is Next channel by OK', async () => {
    await watchNewsOne();
    tapButton(button('Next channel'));
    await settle(10);
    expect(text()).toContain('News Two');
    expect(barUp()).toBe(true);
  });

  it('the subtitles menu opens by tap, a row takes a tap, a second tap on the button closes it', async () => {
    await watchNewsOne();
    tapButton(button('Subtitles'));
    expect(text()).toContain('English CC');
    const row = Array.from(document.querySelectorAll('div')).find((d) => d.textContent === 'English CC' && d.hasAttribute('data-focused'))!;
    tapButton(row);
    expect(h.setSubtitleTrack).toHaveBeenCalledWith(0);
    expect(text()).not.toContain('English CC');
    // Open, then the same button again: closed, bar still up.
    tapButton(button('Subtitles'));
    expect(text()).toContain('English CC');
    tapButton(button('Subtitles'));
    expect(text()).not.toContain('English CC');
    expect(barUp()).toBe(true);
  });

  it('a tap on the picture with a menu open closes the menu, not the bar', async () => {
    await watchNewsOne();
    tapButton(button('Subtitles'));
    expect(text()).toContain('English CC');
    finger(q('[data-testid="video"]'), 200, 100);
    expect(text()).not.toContain('English CC');
    expect(barUp()).toBe(true);
  });

  it('a swipe up is the next channel, a swipe down the previous one', async () => {
    await watchNewsOne();
    finger(q('[data-testid="video"]'), 300, 400, 305, 200);
    await settle(10);
    expect(text()).toContain('News Two');
    finger(q('[data-testid="video"]'), 300, 100, 300, 300);
    await settle(10);
    expect(text()).toContain('News One');
    expect(text()).not.toContain('News Two');
  });

  it('a tap on the preview box plays its channel full screen (OK)', async () => {
    await openList();
    expect(q('[data-testid="video"]')).toBeNull();
    act(() => { fireEvent.click(q('[data-howto="live.preview"]')); });
    await until('[data-testid="video"]');
    expect(barUp()).toBe(true);
    expect(text()).toContain('News One');
  });
});

describe('the same screen on a TV', () => {
  it('has no touch handlers: taps, swipes and clicks do nothing; the remote still works', async () => {
    await watchNewsOne();
    expect(barUp()).toBe(true);
    finger(q('[data-testid="video"]'), 200, 200);
    expect(barUp()).toBe(true);
    finger(q('[data-testid="video"]'), 300, 400, 300, 200);
    await settle(10);
    expect(text()).toContain('News One');
    expect(text()).not.toContain('News Two');
    // No click handler on the bar (Enter on a DOM-focused button would fire it a second time).
    act(() => { fireEvent.click(button('Pause')); });
    act(() => { fireEvent.click(button('Report channel')); });
    await settle(10);
    expect(h.togglePlay).not.toHaveBeenCalled();
    expect(q('[data-testid="report"]')).toBeNull();
    expect(document.querySelector('[data-touch-chrome]')).toBeNull();
    // OK still presses the highlighted button.
    press('Enter');
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('a click on the preview box does nothing', async () => {
    await openList();
    act(() => { fireEvent.click(q('[data-howto="live.preview"]')); });
    await settle(50);
    expect(q('[data-testid="video"]')).toBeNull();
    expect(barUp()).toBe(false);
  });
});
