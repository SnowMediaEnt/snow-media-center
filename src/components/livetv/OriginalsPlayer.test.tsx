/**
 * Snow Originals player: the native ExoPlayer on a box (upright videos in a
 * centred rect with the blurred still in two side bands, sideways full
 * screen), the HTML5 <video> only without it; OK / ◀ ▶ / ▼ ▲ / Back; Up next
 * with its countdown; the error card and retry; the §0 analytics events.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';

type NativeArgs = { active: boolean; url: string | null; live?: boolean; startPosition?: number; onEnded?: () => void; rect?: { x: number; y: number; width: number; height: number } | null };

const h = vi.hoisted(() => ({
  native: true,
  demo: false,
  kids: null as string | null,
  mode: 'fit',
  resume: {} as Record<string, number>,
  error: null as { message: string } | null,
  args: null as NativeArgs | null,
  allArgs: [] as NativeArgs[],
  togglePlay: vi.fn(),
  retry: vi.fn(),
  seekTo: vi.fn(async (_s: number) => {}),
  setResizeMode: vi.fn(async (o: { mode: string }) => ({ mode: o.mode })),
  track: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  saveProgress: vi.fn(),
  clearProgress: vi.fn(),
  videoProps: null as Record<string, unknown> | null,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  hasNativePlayer: () => h.native,
  SnowPlayer: {
    getResizeMode: async () => ({ mode: h.mode }),
    setResizeMode: h.setResizeMode,
  },
}));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: NativeArgs) => {
    h.args = a;
    h.allArgs.push(a);
    return {
      controller: { togglePlay: h.togglePlay }, buffering: false, paused: false, error: h.error,
      audioWarning: null, engineNotice: null, retry: h.retry, seekTo: h.seekTo,
      getPosition: async () => ({ position: 50, duration: 100, playing: true }),
    };
  },
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: h.track, startTimer: h.startTimer, stopTimer: h.stopTimer }));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/lib/kidsFilter', () => ({ kidsLevel: () => h.kids }));
vi.mock('@/lib/originalsProgress', () => ({
  resumeAt: (id: string) => h.resume[id] ?? 0,
  saveProgress: h.saveProgress,
  clearProgress: h.clearProgress,
}));
vi.mock('./VideoPlayer', () => ({
  default: (p: Record<string, unknown>) => { h.videoProps = p; return <div data-fake-video={String(p.src)} />; },
}));

import OriginalsPlayer from './OriginalsPlayer';

type Item = Parameters<typeof OriginalsPlayer>[0]['items'][number];
const item = (id: string, over: Partial<Item> = {}): Item => ({
  id, title: `Clip ${id}`, description: null, videoUrl: `https://cdn.example/${id}.mp4`,
  posterUrl: `https://cdn.example/p-${id}.jpg`, backdropUrl: `https://cdn.example/b-${id}.jpg`,
  durationSec: 60, width: 1920, height: 1080, portrait: false, kidFriendly: false,
  publishedAt: null, createdAt: '2026-09-30T00:00:00Z', sort: 0, ...over,
});
const upright = (id: string, over: Partial<Item> = {}) => item(id, { width: 720, height: 1280, portrait: true, ...over });

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const key = (k: string, extra: Record<string, unknown> = {}) => { act(() => { fireEvent.keyDown(window, { key: k, ...extra }); }); };
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const calls = (name: string) => h.track.mock.calls.filter((c) => c[0] === name).map((c) => c[2]);

function mount(items: Item[], startId = items[0].id) {
  const onClose = vi.fn();
  const r = render(<OriginalsPlayer items={items} startId={startId} onClose={onClose} />);
  return { onClose, ...r, again: () => r.rerender(<OriginalsPlayer items={items} startId={startId} onClose={onClose} />) };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 960 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 540 });
  h.native = true; h.demo = false; h.kids = null; h.mode = 'fit'; h.resume = {}; h.error = null;
  h.args = null; h.allArgs = []; h.videoProps = null;
  for (const f of [h.togglePlay, h.retry, h.seekTo, h.setResizeMode, h.track, h.startTimer, h.stopTimer, h.saveProgress, h.clearProgress]) f.mockClear();
  delete (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt;
});
afterEach(() => { vi.useRealTimers(); document.documentElement.classList.remove('snowplayer-fullscreen'); });

describe('OriginalsPlayer: native picture', () => {
  it('puts an upright video in a centred box and draws the blurred still in two side bands', () => {
    mount([upright('a')]);
    expect(h.args).toMatchObject({ active: true, url: 'https://cdn.example/a.mp4', live: false });
    // 540 high, 720:1280 → 304 wide, centred in 960.
    expect(h.args?.rect).toEqual({ x: 328, y: 0, width: 304, height: 540 });
    const left = q('[data-originals-band="left"]')!;
    const right = q('[data-originals-band="right"]')!;
    expect(left.style.left).toBe('0px');
    expect(left.style.width).toBe('328px');
    expect(right.style.left).toBe('632px');
    expect(right.style.width).toBe('328px');
    // One full-screen layer seen through two windows: the still is screen-sized and offset.
    expect(left.style.backgroundImage).toContain('b-a.jpg');
    expect(left.style.backgroundSize).toBe('960px 540px');
    expect(right.style.backgroundPosition).toBe('-632px 0px');
    // The native picture shows through: transparent root, the fullscreen class on <html>.
    expect(q('[data-originals-player]')!.className).toMatch(/bg-transparent/);
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(true);
  });

  it('uses the poster for the sides when there is no backdrop', () => {
    mount([upright('a', { backdropUrl: null })]);
    expect(q('[data-originals-band="left"]')!.style.backgroundImage).toContain('p-a.jpg');
  });

  it('plays a sideways video full screen: no rect, no bands', () => {
    mount([item('a')]);
    expect(h.args?.rect).toBeUndefined();
    expect(q('[data-originals-band="left"]')).toBeNull();
    expect(q('[data-originals-player]')!.getAttribute('data-orientation')).toBe('landscape');
  });

  it('shows an upright video at fit when the viewer chose "wide", and gives "wide" back on close', async () => {
    h.mode = 'wide';
    const { unmount } = mount([upright('a')]);
    await settle();
    expect(h.setResizeMode).toHaveBeenLastCalledWith({ mode: 'fit' });
    unmount();
    expect(h.setResizeMode).toHaveBeenLastCalledWith({ mode: 'wide' });
  });

  it('leaves the screen format alone otherwise', async () => {
    mount([upright('a')]);
    await settle();
    expect(h.setResizeMode).not.toHaveBeenCalled();
  });
});

describe('OriginalsPlayer: remote', () => {
  it('OK toggles pause (a held OK does not), ◀ ▶ seek 10 s', async () => {
    mount([item('a')]);
    key('Enter');
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    key('Enter', { repeat: true });
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    key('ArrowLeft');
    await settle();
    expect(h.seekTo).toHaveBeenLastCalledWith(40);
    key('ArrowRight');
    await settle();
    expect(h.seekTo).toHaveBeenLastCalledWith(60);
  });

  it('▼ plays the next video and ▲ the previous one, within the list', () => {
    mount([item('a'), item('b'), item('c')], 'b');
    expect(h.args?.url).toBe('https://cdn.example/b.mp4');
    key('ArrowDown');
    expect(h.args?.url).toBe('https://cdn.example/c.mp4');
    key('ArrowDown'); // last one: stays
    expect(h.args?.url).toBe('https://cdn.example/c.mp4');
    key('ArrowUp');
    key('ArrowUp');
    expect(h.args?.url).toBe('https://cdn.example/a.mp4');
    key('ArrowUp'); // first one: stays
    expect(h.args?.url).toBe('https://cdn.example/a.mp4');
  });

  it('Back calls onClose once, with the video on screen, after stamping the overlay guard', () => {
    const { onClose } = mount([item('a'), item('b')]);
    key('ArrowDown');
    key('Escape');
    key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('b');
    expect((window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt).toBeGreaterThan(0);
  });

  it('starts at the saved place and says so', () => {
    h.resume = { a: 130 };
    mount([item('a', { durationSec: 200 })]);
    expect(h.args?.startPosition).toBe(130);
    expect(q('[data-originals-resumed]')).not.toBeNull();
  });

  it('keeps the place when leaving a video', async () => {
    const { onClose } = mount([item('a', { durationSec: 200 })]);
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)); });
    key('Escape');
    expect(onClose).toHaveBeenCalledWith('a');
    expect(h.saveProgress).toHaveBeenCalledWith('a', 50, 100);
  });
});

describe('OriginalsPlayer: the end', () => {
  it('shows Up next, and the countdown plays the next video', () => {
    vi.useFakeTimers();
    mount([item('a'), upright('b')]);
    act(() => { h.args?.onEnded?.(); });
    expect(q('[data-originals-upnext]')).not.toBeNull();
    expect(q('[data-originals-countdown]')!.textContent).toBe('5');
    expect(h.clearProgress).toHaveBeenCalledWith('a');
    expect(calls('originals_finish')).toEqual([{ id: 'a', title: 'Clip a' }]);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(q('[data-originals-countdown]')!.textContent).toBe('3');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(h.args?.url).toBe('https://cdn.example/b.mp4');
    expect(q('[data-originals-upnext]')).toBeNull();
    expect(calls('originals_play')[1]).toMatchObject({ id: 'b', orientation: 'portrait', autoplay: true });
  });

  it('OK on Up next plays now; Back closes to the list', () => {
    const first = mount([item('a'), item('b')]);
    act(() => { h.args?.onEnded?.(); });
    key('Enter');
    expect(h.args?.url).toBe('https://cdn.example/b.mp4');
    expect(calls('originals_play')[1]).toMatchObject({ id: 'b', autoplay: false });
    first.unmount();

    const second = mount([item('a'), item('b')]);
    act(() => { h.args?.onEnded?.(); });
    key('Escape');
    expect(second.onClose).toHaveBeenCalledWith('a');
  });

  it('closes after the last video', () => {
    const { onClose } = mount([item('a'), item('b')], 'b');
    act(() => { h.args?.onEnded?.(); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('b');
    expect(q('[data-originals-upnext]')).toBeNull();
  });
});

describe('OriginalsPlayer: errors', () => {
  it('shows the retry card, OK retries, and player_error never carries the address', () => {
    const m = mount([item('a')]);
    h.error = { message: 'Source error https://cdn.example/a.mp4 (404)' };
    m.again();
    expect(q('[data-originals-error]')).not.toBeNull();
    key('Enter');
    expect(h.retry).toHaveBeenCalledTimes(1);
    expect(h.togglePlay).not.toHaveBeenCalled();
    const [err] = calls('player_error');
    expect(err).toMatchObject({ kind: 'originals', channel_or_title: 'Clip a' });
    expect(String(err.message)).not.toContain('cdn.example');
    expect(String(err.message).length).toBeLessThanOrEqual(200);
  });
});

describe('OriginalsPlayer: analytics', () => {
  it('originals_play and the watch timer carry the §0 props', () => {
    h.kids = 'kids';
    h.resume = { a: 30 };
    mount([upright('a', { durationSec: 150 })]);
    expect(calls('originals_play')).toEqual([{ id: 'a', title: 'Clip a', orientation: 'portrait', kid_profile: true, resumed: true, autoplay: false }]);
    expect(h.startTimer).toHaveBeenCalledWith('watch', 'originals_watch', 'player', { id: 'a', title: 'Clip a' });
  });

  it('sends nothing in demo mode', () => {
    h.demo = true;
    mount([item('a'), item('b')]);
    act(() => { h.args?.onEnded?.(); });
    expect(h.track).not.toHaveBeenCalled();
    expect(h.startTimer).not.toHaveBeenCalled();
  });
});

describe('OriginalsPlayer: without the native player', () => {
  it('plays in the HTML5 <video>, in the centred box for an upright video', async () => {
    h.native = false;
    mount([upright('a'), item('b')]);
    await settle();
    expect(h.allArgs.every((a) => !a.active && a.url === null)).toBe(true);
    expect(q('[data-originals-player]')!.getAttribute('data-engine')).toBe('html5');
    expect(q('[data-originals-player]')!.className).toMatch(/bg-black/);
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(false);
    const video = q('[data-fake-video]')!;
    expect(video.getAttribute('data-fake-video')).toBe('https://cdn.example/a.mp4');
    const box = video.parentElement!;
    expect(box.style.left).toBe('328px');
    expect(box.style.width).toBe('304px');
    expect(q('[data-originals-band="full"]')).not.toBeNull();
    // Its end goes to Up next like the native one.
    act(() => { (h.videoProps?.onEnded as () => void)(); });
    expect(q('[data-originals-upnext]')).not.toBeNull();
  });

  it('an HTML5 error shows the retry card and OK mounts a fresh player', async () => {
    h.native = false;
    mount([item('a')]);
    await settle();
    const before = h.videoProps;
    act(() => { (h.videoProps?.onError as (m: string) => void)('formatUnsupported'); });
    expect(q('[data-originals-error]')).not.toBeNull();
    expect(calls('player_error')[0]).toMatchObject({ kind: 'originals', channel_or_title: 'Clip a', message: 'formatUnsupported' });
    key('Enter');
    await settle();
    expect(q('[data-originals-error]')).toBeNull();
    expect(h.videoProps).not.toBe(before);
    expect(h.retry).not.toHaveBeenCalled();
  });
});

describe('OriginalsPlayer: by finger (phones and tablets only)', () => {
  const at = (x: number, y: number) => [{ identifier: 0, clientX: x, clientY: y }];
  const finger = (x: number, y: number, x2 = x, y2 = y) => act(() => {
    const el = q('[data-originals-player]')!;
    fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(x2, y2) });
  });
  afterEach(() => { act(() => { __setPhoneModeForTests({ touch: false, phone: false }); }); });

  it('a tap is OK (pause / play), a swipe up the next video and a swipe down the previous one', () => {
    act(() => { __setPhoneModeForTests({ touch: true, phone: true }); });
    mount([item('a'), item('b')]);
    finger(400, 300);
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    finger(400, 400, 405, 150);
    expect(h.args?.url).toBe('https://cdn.example/b.mp4');
    finger(400, 150, 400, 400);
    expect(h.args?.url).toBe('https://cdn.example/a.mp4');
  });

  it('on a TV a finger does nothing', () => {
    mount([item('a'), item('b')]);
    finger(400, 300);
    finger(400, 400, 405, 150);
    expect(h.togglePlay).not.toHaveBeenCalled();
    expect(h.args?.url).toBe('https://cdn.example/a.mp4');
  });
});
