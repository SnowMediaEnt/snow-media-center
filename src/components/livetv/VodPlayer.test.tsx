/**
 * Live TV VOD player: on a box, films and episodes play on the native
 * ExoPlayer (which decodes AC-3 / E-AC-3 / DTS sound the WebView drops); the
 * browser build keeps the HTML5 <video>. The end, errors (never an address),
 * retry, the sound-track language and the volume pill.
 */
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
  setAudioTrack: vi.fn(),
  videoProps: null as Record<string, unknown> | null,
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => h.native }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: (a: NativeArgs) => {
    h.args = a;
    h.calls += 1;
    return {
      controller: { getAudioTracks: () => h.tracks, setAudioTrack: h.setAudioTrack },
      buffering: h.buffering, paused: false, error: h.error, audioWarning: h.audioWarning, engineNotice: null,
      retry: h.retry, seekTo: async () => {}, getPosition: async () => ({ position: 0, duration: 0, playing: true }),
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
    expect(h.setAudioTrack).toHaveBeenCalledWith(1);
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

describe('VodPlayer volume pill', () => {
  it('shows the level when the volume changes, not on start', () => {
    const { rerender } = render(<VodPlayer src={URL_MKV} volume={1} />);
    expect(q('[data-vod-volume]')).toBeNull();
    rerender(<VodPlayer src={URL_MKV} volume={1.05} />);
    expect(q('[data-vod-volume]')?.textContent).toContain('105');
  });

  it('the browser player tops out at 100%', () => {
    h.native = false;
    const { rerender } = render(<VodPlayer src={URL_MKV} volume={1} />);
    rerender(<VodPlayer src={URL_MKV} volume={1.2} />);
    expect(q('[data-vod-volume]')?.textContent).toContain('100');
  });
});
