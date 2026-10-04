/**
 * Live TV VOD player: on a box, films and episodes play on the native
 * ExoPlayer (which decodes AC-3 / E-AC-3 / DTS sound the WebView drops); the
 * browser build keeps the HTML5 <video>. The end, errors (never an address),
 * retry, the sound-track language, and the control bar (VodControlBar):
 * OK opens it, play/pause, seeking, subtitles / audio through the native
 * track selection, volume to 150% (saved), Back's order, and long lists.
 */
import { setAudioPassthrough } from '@/lib/audioOutput';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { VideoTrackInfo } from './VideoPlayer';

type NativeArgs = {
  active: boolean; url: string | null; live?: boolean; volume: number; startPosition?: number;
  onEnded?: () => void; onTracksChanged?: () => void; onReload?: () => void;
};

const h = vi.hoisted(() => ({
  native: true,
  args: null as NativeArgs | null,
  calls: 0,
  error: null as { code?: string; message: string } | null,
  audioWarning: null as { codecs: string; ffmpegAvailable: boolean } | null,
  buffering: false,
  retry: vi.fn(),
  tracks: [] as VideoTrackInfo[],
  subs: [] as VideoTrackInfo[],
  setAudioTrack: vi.fn(),
  setSubtitleTrack: vi.fn(),
  togglePlay: vi.fn(),
  seekTo: vi.fn(async (_s: number) => {}),
  pos: 600,
  dur: 5400,
  paused: false,
  videoProps: null as Record<string, unknown> | null,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => h.native }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: NativeArgs) => {
    h.args = a;
    h.calls += 1;
    return {
      controller: {
        getAudioTracks: () => h.tracks, setAudioTrack: h.setAudioTrack,
        getSubtitleTracks: () => h.subs, setSubtitleTrack: h.setSubtitleTrack,
        togglePlay: h.togglePlay, play: () => {}, pause: () => {}, seek: () => {},
        isPaused: () => h.paused, isSeekable: () => true,
      },
      buffering: h.buffering, paused: h.paused, error: h.error, audioWarning: h.audioWarning, engineNotice: null,
      retry: h.retry, seekTo: h.seekTo, getPosition: async () => ({ position: h.pos, duration: h.dur, playing: !h.paused }),
    };
  },
}));
vi.mock('./VideoPlayer', () => ({
  default: (p: Record<string, unknown>) => { h.videoProps = p; return <div data-fake-video={String(p.src)} />; },
}));

import VodPlayer from './VodPlayer';

const URL_MKV = 'http://panel.example:8080/movie/user1/pass1/77.mkv';
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(() => {
  h.native = true; h.args = null; h.calls = 0; h.error = null; h.audioWarning = null; h.buffering = false;
  h.retry.mockReset(); h.setAudioTrack.mockReset(); h.tracks = []; h.videoProps = null;
  h.subs = []; h.setSubtitleTrack.mockReset(); h.togglePlay.mockReset(); h.seekTo.mockClear();
  h.pos = 600; h.dur = 5400; h.paused = false;
  localStorage.clear();
});
afterEach(async () => {
  document.documentElement.classList.remove('snowplayer-fullscreen');
  if (i18n.language !== 'en') await act(async () => { await i18n.changeLanguage('en'); });
});

describe('VodPlayer routing', () => {
  it('a box plays the film on the native player, as a film (not live), with no <video>', () => {
    const { unmount } = render(<VodPlayer src={URL_MKV} volume={1.3} />);
    expect(q('[data-vod-player]')?.getAttribute('data-engine')).toBe('native');
    expect(h.args).toMatchObject({ active: true, url: URL_MKV, live: false, volume: 1.3 });
    expect(q('[data-fake-video]')).toBeNull();
    expect(document.querySelector('video')).toBeNull();
    // The picture shows through the page.
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(true);
    expect(q('[data-vod-player]')?.className).toContain('bg-transparent');
    unmount();
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(false);
  });

  it('the browser build keeps the HTML5 player and never touches the native one', async () => {
    h.native = false;
    render(<VodPlayer src={URL_MKV} volume={0.7} />);
    await settle();
    expect(q('[data-vod-player]')?.getAttribute('data-engine')).toBe('html5');
    expect(q('[data-fake-video]')?.getAttribute('data-fake-video')).toBe(URL_MKV);
    expect(h.videoProps).toMatchObject({ src: URL_MKV, volume: 0.7 });
    expect(h.calls).toBe(0);
    expect(document.documentElement.classList.contains('snowplayer-fullscreen')).toBe(false);
  });

  it('a new episode is a new url on the same native player', () => {
    const { rerender } = render(<VodPlayer src={URL_MKV} volume={1} />);
    const next = URL_MKV.replace('/movie/', '/series/').replace('77.mkv', '78.mp4');
    rerender(<VodPlayer src={next} volume={1} />);
    expect(h.args).toMatchObject({ url: next, live: false });
  });
});

describe('VodPlayer on a box', () => {
  it('passes the end through (next episode)', () => {
    const onEnded = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1} onEnded={onEnded} />);
    act(() => { h.args?.onEnded?.(); });
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('reports an error without the address and retries from the card', () => {
    h.error = { code: 'IO', message: `Unable to connect to ${URL_MKV}` };
    const onError = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1} onError={onError} />);
    expect(onError).toHaveBeenCalledTimes(1);
    const msg = onError.mock.calls[0][0] as string;
    expect(msg).toContain('IO');
    expect(msg).not.toContain('pass1');
    expect(msg).not.toContain('panel.example');
    expect(q('[data-vod-error]')?.textContent).not.toContain('pass1');
    fireEvent.click(q('[data-vod-error] button')!);
    expect(h.retry).toHaveBeenCalledTimes(1);
  });

  it('says so when the sound cannot be decoded at all', () => {
    h.audioWarning = { codecs: 'audio/vnd.dts.uhd', ffmpegAvailable: true };
    render(<VodPlayer src={URL_MKV} volume={1} />);
    expect(q('[data-vod-nosound]')?.textContent).toContain('audio/vnd.dts.uhd');
  });

  it('starts on the viewer\'s language when the file has it, once per stream', async () => {
    await act(async () => { await i18n.changeLanguage('es'); });
    h.tracks = [
      { id: 0, label: 'English 5.1', language: 'en', active: true },
      { id: 1, label: 'Español', language: 'es', active: false },
    ];
    render(<VodPlayer src={URL_MKV} volume={1} />);
    act(() => { h.args?.onTracksChanged?.(); });
    act(() => { h.args?.onTracksChanged?.(); });
    expect(h.setAudioTrack).toHaveBeenCalledTimes(1);
    // The app's own pick, marked so: the native player may still lighten it.
    expect(h.setAudioTrack).toHaveBeenCalledWith(1, { auto: true });
  });

  it('leaves the file\'s default track when the viewer\'s language is not in it', () => {
    h.tracks = [
      { id: 0, label: 'Italiano', language: 'it', active: true },
      { id: 1, label: 'Français', language: 'fr', active: false },
    ];
    render(<VodPlayer src={URL_MKV} volume={1} />);
    act(() => { h.args?.onTracksChanged?.(); });
    expect(h.setAudioTrack).not.toHaveBeenCalled();
  });
});

const key = async (k: string, extra: Record<string, unknown> = {}) => {
  await act(async () => { fireEvent.keyDown(window, { key: k, ...extra }); });
  await settle();
};
const bar = () => q('[data-vod-bar]');
/** The highlighted button's name (the line under it). */
const focusedName = () => q('[data-bar-control] button[data-focused="true"]')?.getAttribute('aria-label');
const track = (id: number, label: string, active = false): VideoTrackInfo => ({ id, label, language: label.slice(0, 2).toLowerCase(), active });

describe('VodPlayer control bar', () => {
  it('OK brings the bar up on Play, with the time, the length and the button names', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} title="Big Film" />);
    expect(bar()).toBeNull();
    await key('Enter');
    expect(bar()).not.toBeNull();
    expect(bar()?.textContent).toContain('Big Film');
    expect(q('[data-vod-time]')?.textContent).toBe('10:00');
    expect(q('[data-vod-duration]')?.textContent).toBe('1:30:00');
    expect(focusedName()).toBe('Pause');
    // The name is drawn under the highlighted button only, and every button keeps its slot.
    const names = Array.from(document.querySelectorAll('[data-bar-name]'));
    expect(names.filter((n) => !n.className.includes('invisible')).map((n) => n.textContent)).toEqual(['Pause']);
    expect(Array.from(document.querySelectorAll('[data-bar-control]')).map((n) => n.getAttribute('data-bar-control')))
      .toEqual(['rew', 'play', 'fwd', 'cc', 'audio', 'vol', 'stats']);
  });

  it('▲ ▼ open it too, and it hides by itself after a few seconds', async () => {
    vi.useFakeTimers();
    try {
      render(<VodPlayer src={URL_MKV} volume={1} />);
      act(() => { fireEvent.keyDown(window, { key: 'ArrowDown' }); });
      expect(bar()).not.toBeNull();
      act(() => { vi.advanceTimersByTime(5100); });
      expect(bar()).toBeNull();
      act(() => { fireEvent.keyDown(window, { key: 'ArrowUp' }); });
      expect(bar()).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('stays up while paused', async () => {
    vi.useFakeTimers();
    try {
      h.paused = true;
      render(<VodPlayer src={URL_MKV} volume={1} />);
      // A pause (from anywhere) brings it up on Play.
      expect(bar()).not.toBeNull();
      expect(focusedName()).toBe('Play');
      act(() => { vi.advanceTimersByTime(20000); });
      expect(bar()).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it('OK on Play/Pause pauses and plays', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter'); // opens the bar: no action yet
    expect(h.togglePlay).not.toHaveBeenCalled();
    await key('Enter');
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
    await key('Enter', { repeat: true }); // a held OK doesn't flicker it
    expect(h.togglePlay).toHaveBeenCalledTimes(1);
  });

  it('back 10 s / forward 30 s from the buttons', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    await key('ArrowLeft');
    expect(focusedName()).toBe('Back 10 seconds');
    await key('Enter');
    expect(h.seekTo).toHaveBeenLastCalledWith(590);
    await key('ArrowRight');
    await key('ArrowRight');
    expect(focusedName()).toBe('Forward 30 seconds');
    await key('Enter');
    expect(h.seekTo).toHaveBeenLastCalledWith(630);
  });

  it('◀ ▶ with the bar hidden seek, and leave the volume alone', async () => {
    const onVolumeChange = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1.2} onVolumeChange={onVolumeChange} />);
    await key('ArrowRight');
    expect(h.seekTo).toHaveBeenLastCalledWith(630);
    await key('ArrowLeft');
    expect(h.seekTo).toHaveBeenLastCalledWith(590);
    expect(bar()).toBeNull();
    expect(q('[data-vod-seek]')).not.toBeNull();
    expect(h.args?.volume).toBe(1.2);
    expect(onVolumeChange).not.toHaveBeenCalled();
  });

  it('the seek bar: ▲ reaches it, ◀ ▶ move the marker, OK jumps there', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    await key('ArrowUp');
    expect(q('[data-vod-timeline]')?.getAttribute('data-focused')).toBe('true');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(h.seekTo).not.toHaveBeenCalled();
    expect(q('[data-vod-time]')?.textContent).toContain('10:20');
    await key('Enter');
    expect(h.seekTo).toHaveBeenLastCalledWith(620);
    await key('ArrowDown');
    expect(focusedName()).toBe('Pause');
  });

  it('the seek bar jumps by itself a moment after the last press', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    await key('ArrowUp');
    vi.useFakeTimers();
    try {
      act(() => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });
      expect(h.seekTo).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1100); });
      expect(h.seekTo).toHaveBeenLastCalledWith(590);
    } finally { vi.useRealTimers(); }
  });

  it('subtitles: the player\'s tracks plus Off, picked through the native track selection', async () => {
    h.subs = [track(0, 'English'), track(1, 'Español')];
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    await key('ArrowRight'); // forward
    await key('ArrowRight'); // subtitles
    expect(focusedName()).toBe('Subtitles');
    await key('Enter');
    const rows = () => Array.from(document.querySelectorAll('[data-vod-menu="cc"] [data-vod-menu-list] > div')).map((r) => r.textContent);
    expect(rows()).toEqual(['Off●', 'English', 'Español']);
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Enter');
    expect(h.setSubtitleTrack).toHaveBeenLastCalledWith(1);
    expect(q('[data-vod-menu]')).toBeNull();
    await key('Enter');
    await key('ArrowUp');
    await key('ArrowUp');
    await key('Enter');
    expect(h.setSubtitleTrack).toHaveBeenLastCalledWith(-1);
  });

  it('audio: choose a language, kept over the automatic pick', async () => {
    h.tracks = [track(0, 'English 5.1', true), track(1, 'Français')];
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    // No subtitles in this file: that button is greyed out and skipped.
    await key('ArrowRight');
    await key('ArrowRight');
    expect(focusedName()).toBe('Audio');
    await key('Enter');
    expect(q('[data-vod-menu="audio"]')?.textContent).toContain('Français');
    await key('ArrowDown');
    await key('Enter');
    expect(h.setAudioTrack).toHaveBeenLastCalledWith(1);
    // A reload starts on the file's default: the viewer's choice comes back.
    h.setAudioTrack.mockClear();
    act(() => { h.args?.onReload?.(); h.args?.onTracksChanged?.(); });
    expect(h.setAudioTrack).toHaveBeenLastCalledWith(1);
  });

  it('volume: up to 150%, shown, saved and passed to the player', async () => {
    const onVolumeChange = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1.2} onVolumeChange={onVolumeChange} />);
    await key('Enter');
    // Subtitles and audio have nothing to offer here: greyed out and skipped.
    await key('ArrowRight');
    await key('ArrowRight');
    expect(focusedName()).toBe('Volume 120%');
    await key('Enter');
    expect(q('[data-vod-menu="vol"]')).not.toBeNull();
    for (let i = 0; i < 5; i++) await key('ArrowRight');
    expect(h.args?.volume).toBe(1.5);
    expect(localStorage.getItem('snow-player-volume-v1')).toBe('1.5');
    expect(onVolumeChange).toHaveBeenLastCalledWith(1.5);
    expect(q('[data-vod-vol-level]')?.textContent).toContain('150%');
    await key('ArrowLeft');
    expect(h.args?.volume).toBe(1.4);
    await key('Enter'); // closes the slider
    expect(q('[data-vod-menu]')).toBeNull();
    expect(focusedName()).toBe('Volume 140%');
  });

  it('volume with Dolby / DTS passed through: the slider says to use the TV or receiver', async () => {
    render(<VodPlayer src={URL_MKV} volume={1} />);
    await key('Enter');
    await key('ArrowRight');
    await key('ArrowRight');
    await key('Enter');
    expect(q('[data-vod-menu="vol"]')).not.toBeNull();
    expect(q('[data-volume-passthrough]')).toBeNull();
    act(() => { setAudioPassthrough(true); });
    expect(q('[data-volume-passthrough]')?.textContent).toContain('Volume on your TV or receiver');
    act(() => { setAudioPassthrough(false); });
    expect(q('[data-volume-passthrough]')).toBeNull();
  });

  it('volume past 100% on a bitstream: no "Boost" label (no boost reaches it)', async () => {
    render(<VodPlayer src={URL_MKV} volume={1.3} />);
    await key('Enter');
    await key('ArrowRight');
    await key('ArrowRight');
    await key('Enter');
    expect(q('[data-vod-vol-level]')?.textContent).toContain('Boost');
    act(() => { setAudioPassthrough(true); });
    expect(q('[data-vod-vol-level]')?.textContent).toBe('130%');
    act(() => { setAudioPassthrough(false); });
  });

  it('Back closes the menu, then the stats, then the bar, then the player', async () => {
    const onClose = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1} onClose={onClose} />);
    await key('Enter');
    await key('ArrowRight');
    await key('ArrowRight');
    await key('Enter'); // the volume slider
    expect(q('[data-vod-menu]')).not.toBeNull();
    await key('Escape');
    expect(q('[data-vod-menu]')).toBeNull();
    expect(bar()).not.toBeNull();
    await key('Escape');
    expect(bar()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Back and OK are the error card\'s while it is up', async () => {
    h.error = { code: 'IO', message: 'boom' };
    const onClose = vi.fn();
    render(<VodPlayer src={URL_MKV} volume={1} onClose={onClose} />);
    await key('Enter');
    expect(bar()).toBeNull();
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a series gets Next episode, greyed out on the last one', async () => {
    const onNext = vi.fn();
    const { rerender } = render(<VodPlayer src={URL_MKV} volume={1} onNext={onNext} hasNext />);
    await key('Enter');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(focusedName()).toBe('Next episode');
    await key('Enter');
    expect(onNext).toHaveBeenCalledTimes(1);
    rerender(<VodPlayer src={URL_MKV} volume={1} onNext={onNext} hasNext={false} />);
    await settle();
    const next = q('[data-bar-control="next"] button');
    expect(next?.className).toContain('text-white/30');
    // Still in its slot: nothing moved.
    expect(Array.from(document.querySelectorAll('[data-bar-control]')).map((n) => n.getAttribute('data-bar-control')))
      .toEqual(['rew', 'play', 'fwd', 'next', 'cc', 'audio', 'vol', 'stats']);
  });

  it('a long list scrolls so the highlighted row stays in sight', async () => {
    h.subs = Array.from({ length: 14 }, (_, i) => track(i, `Track ${i + 1}`));
    // jsdom lays nothing out: the list is 200 px tall at y=100, rows 50 px
    // apart from y=108 (its padding).
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      const mk = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
      if (el.hasAttribute('data-vod-menu-list')) return mk(100, 200);
      const list = el.parentElement;
      if (list?.hasAttribute('data-vod-menu-list')) return mk(108 + Array.from(list.children).indexOf(el) * 50 - list.scrollTop, 44);
      return mk(0, 0);
    });
    try {
      render(<VodPlayer src={URL_MKV} volume={1} />);
      await key('Enter');
      await key('ArrowRight');
      await key('ArrowRight');
      await key('Enter');
      const list = q('[data-vod-menu-list]')!;
      expect(list.scrollTop).toBe(0);
      for (let i = 0; i < 12; i++) await key('ArrowDown');
      const row = list.querySelector('[data-focused="true"]') as HTMLElement;
      expect(row.textContent).toBe('Track 12');
      expect(list.scrollTop).toBeGreaterThan(0);
      const r = row.getBoundingClientRect();
      expect(r.top).toBeGreaterThanOrEqual(100);
      expect(r.bottom).toBeLessThanOrEqual(300);
      // And back up to the top.
      for (let i = 0; i < 12; i++) await key('ArrowUp');
      const top = list.querySelector('[data-focused="true"]') as HTMLElement;
      expect(top.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
    } finally { spy.mockRestore(); }
  });

  it('the browser build gets the same bar, its volume stopping at 100%', async () => {
    h.native = false;
    render(<VodPlayer src={URL_MKV} volume={0.9} />);
    await settle();
    await key('Enter');
    expect(bar()).not.toBeNull();
    // No stats on the browser player.
    expect(q('[data-bar-control="stats"]')).toBeNull();
    await key('ArrowRight');
    await key('ArrowRight');
    await key('Enter');
    for (let i = 0; i < 4; i++) await key('ArrowRight');
    expect(h.videoProps?.volume).toBe(1);
  });
});
