/**
 * Live TV films and episodes by finger (VodPlayer + VodControlBar): a tap on
 * the picture brings the bar up and puts it away, a tap on a button does what
 * OK does on it (without also toggling the bar), the seek bar takes a tap or
 * a drag and the film jumps where the finger lifts, menu rows and the volume
 * level take a finger. On a TV none of it is attached.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import type { VideoTrackInfo } from './VideoPlayer';

type NativeArgs = { active: boolean; url: string | null; live?: boolean; volume: number };

const h = vi.hoisted(() => ({
  args: null as NativeArgs | null,
  error: null as { code?: string; message: string } | null,
  subs: [] as VideoTrackInfo[],
  setSubtitleTrack: vi.fn(),
  togglePlay: vi.fn(),
  seekTo: vi.fn(async (_s: number) => {}),
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => true }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: NativeArgs) => {
    h.args = a;
    return {
      controller: {
        getAudioTracks: () => [], setAudioTrack: () => {},
        getSubtitleTracks: () => h.subs, setSubtitleTrack: h.setSubtitleTrack,
        togglePlay: h.togglePlay, play: () => {}, pause: () => {}, seek: () => {},
        isPaused: () => false, isSeekable: () => true,
      },
      buffering: false, paused: false, error: h.error, audioWarning: null, engineNotice: null,
      retry: () => {}, seekTo: h.seekTo, getPosition: async () => ({ position: 600, duration: 5400, playing: true }),
    };
  },
}));

import VodPlayer from './VodPlayer';

const URL_MKV = 'http://panel.example:8080/movie/user1/pass1/77.mkv';
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const bar = () => q('[data-vod-bar]');
const focusedName = () => q('[data-bar-control] button[data-focused="true"]')?.getAttribute('aria-label');
const button = (label: string) => q(`[data-bar-control] button[aria-label="${label}"]`)!;
const rect = (el: Element, left: number, width: number) =>
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left, width, top: 0, height: 6, right: left + width, bottom: 6, x: left, y: 0, toJSON: () => ({}) });

const at = (x: number, y: number) => [{ identifier: 0, clientX: x, clientY: y }];
const finger = async (el: Element, x: number, y: number) => {
  await act(async () => {
    fireEvent.touchStart(el, { touches: at(x, y), changedTouches: at(x, y) });
    fireEvent.touchEnd(el, { touches: [], changedTouches: at(x, y) });
  });
  await settle();
};
/** A tap on a button or row, as a phone sends it: the touch, then the click. */
const tap = async (el: Element) => {
  await finger(el, 5, 5);
  await act(async () => { fireEvent.click(el); });
  await settle();
};
const picture = () => q('[data-vod-player]')!;

beforeEach(() => {
  h.args = null; h.error = null; h.subs = [];
  h.setSubtitleTrack.mockReset(); h.togglePlay.mockReset(); h.seekTo.mockClear();
  localStorage.clear();
});
afterEach(() => {
  act(() => { __setPhoneModeForTests({ touch: false, phone: false }); });
  document.documentElement.classList.remove('snowplayer-fullscreen');
});

describe('the film bar on a phone', () => {
  beforeEach(() => { act(() => { __setPhoneModeForTests({ touch: true, phone: true }); }); });

  it('a tap on the picture brings the bar up on Play, the next puts it away', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} title="Big Film" />);
    expect(bar()).toBeNull();
    await finger(picture(), 400, 200);
    expect(bar()).not.toBeNull();
    expect(focusedName()).toBe('Pause');
    expect(h.togglePlay).not.toHaveBeenCalled();
    await finger(picture(), 400, 200);
    expect(bar()).toBeNull();
  });

  it('a tap on a button does what OK does on it, and the bar stays', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await finger(picture(), 400, 200);
    await tap(button('Pause'));
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    expect(bar()).not.toBeNull();
    await tap(button('Back 10 seconds'));
    expect(h.seekTo).toHaveBeenLastCalledWith(590);
    expect(focusedName()).toBe('Back 10 seconds');
    expect(bar()).not.toBeNull();
  });

  it('the seek bar: a drag moves the marker, the film jumps where the finger lifts', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await finger(picture(), 400, 200);
    const line = q('[data-vod-timeline]')!;
    expect(line.hasAttribute('data-touch-track')).toBe(true);
    rect(line, 100, 1000);
    await act(async () => {
      fireEvent.touchStart(line, { touches: at(200, 3), changedTouches: at(200, 3) });
      fireEvent.touchMove(line, { touches: at(350, 3), changedTouches: at(350, 3) });
    });
    // 25% of 1:30:00, shown but not jumped to yet.
    expect(q('[data-vod-time]')?.textContent).toContain('22:30');
    expect(h.seekTo).not.toHaveBeenCalled();
    await act(async () => { fireEvent.touchEnd(line, { touches: [], changedTouches: at(600, 3) }); });
    await settle();
    expect(h.seekTo).toHaveBeenLastCalledWith(2700);
    expect(bar()).not.toBeNull();
    expect(focusedName()).toBe('Pause');
  });

  it('subtitles: a tap opens the menu, a tap on a row picks it', async () => {
    h.subs = [{ id: 7, label: 'English', language: 'en', active: false }];
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await finger(picture(), 400, 200);
    await tap(button('Subtitles'));
    const rows = Array.from(document.querySelectorAll('[data-vod-menu="cc"] [data-vod-menu-list] > div'));
    expect(rows.map((r) => r.textContent)).toEqual(['Off●', 'English']);
    await tap(rows[1]);
    expect(h.setSubtitleTrack).toHaveBeenLastCalledWith(7);
    expect(q('[data-vod-menu]')).toBeNull();
    expect(bar()).not.toBeNull();
  });

  it('volume: a finger on the level sets it (to 150% on the native player)', async () => {
    const onVolumeChange = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={0.5} onVolumeChange={onVolumeChange} />);
    await finger(picture(), 400, 200);
    await tap(button('Volume 50%'));
    const readout = q('[data-vod-menu="vol"] [data-vod-vol-level]')!;
    const track = readout.closest('.px-2')!.querySelector('.rounded-full')!;
    rect(track, 0, 300);
    // The readout ("50%") above the track is not part of it: no jump to 150%.
    await finger(readout, 290, 10);
    expect(onVolumeChange).not.toHaveBeenCalled();
    // The track (and the room around it) takes the finger.
    await finger(track.parentElement!, 200, 20);
    expect(onVolumeChange).toHaveBeenLastCalledWith(1);
    expect(h.args?.volume).toBe(1);
  });

  it('with the error card up, a tap on the picture leaves the bar down', async () => {
    h.error = { message: 'Network' };
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await finger(picture(), 400, 200);
    expect(bar()).toBeNull();
  });
});

describe('the same bar on a TV', () => {
  it('has no touch handlers or markers: taps and clicks do nothing, OK still works', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await finger(picture(), 400, 200);
    expect(bar()).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); });
    await settle();
    expect(bar()).not.toBeNull();
    await tap(button('Pause'));
    expect(h.togglePlay).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();
    expect(document.querySelector('[data-touch-chrome], [data-touch-track]')).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: 'Enter' }); });
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
  });
});
