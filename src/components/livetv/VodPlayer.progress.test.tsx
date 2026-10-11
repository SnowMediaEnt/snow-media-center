/**
 * Live TV VOD player: where the film or episode is goes to the section that
 * opened it (onProgress), about every 10 s and once more as it closes, from
 * the native player on a box and from the <video> in the browser build. The
 * watched marks (lib/watchedMarks) are made from it. When the next episode
 * replaces this one, the last place goes to the episode that played it.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  pos: 0,
  dur: 0,
  getPosition: vi.fn(),
}));

vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => h.native }));
vi.mock('@/hooks/useNativePlayer', () => ({
  useNativePlayer: () => ({
    controller: {
      getAudioTracks: () => [], setAudioTrack: () => {}, getSubtitleTracks: () => [], setSubtitleTrack: () => {},
      togglePlay: () => {}, play: () => {}, pause: () => {}, seek: () => {}, isPaused: () => false, isSeekable: () => true,
    },
    buffering: false, paused: false, error: null, audioWarning: null, engineNotice: null,
    retry: () => {}, seekTo: async () => {}, getPosition: h.getPosition,
  }),
}));
// The browser build's player: a real <video>, its clock set by the test.
vi.mock('./VideoPlayer', () => ({
  default: (p: { src: string }) => (
    <video
      data-fake-video={p.src}
      ref={(v) => {
        if (!v) return;
        Object.defineProperty(v, 'currentTime', { configurable: true, get: () => h.pos });
        Object.defineProperty(v, 'duration', { configurable: true, get: () => (h.dur > 0 ? h.dur : NaN) });
        Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
      }}
    />
  ),
}));

import VodPlayer, { VOD_PROGRESS_MS } from './VodPlayer';

const FILM = 'http://panel.example:8080/movie/user1/pass1/77.mkv';
const EP1 = 'http://panel.example:8080/series/user1/pass1/101.mp4';
const EP2 = 'http://panel.example:8080/series/user1/pass1/102.mp4';

/** The film plays on to `pos` of `dur`, and the next report comes. */
const playTo = async (pos: number, dur: number) => {
  h.pos = pos; h.dur = dur;
  await act(async () => { vi.advanceTimersByTime(VOD_PROGRESS_MS); });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  vi.useFakeTimers();
  h.native = true; h.pos = 0; h.dur = 0;
  h.getPosition.mockReset();
  h.getPosition.mockImplementation(async () => ({ position: h.pos, duration: h.dur, playing: true }));
});
afterEach(() => {
  vi.useRealTimers();
  document.documentElement.classList.remove('snowplayer-fullscreen');
});

describe('VodPlayer progress', () => {
  it('a box: the native player\'s place every 10 s, nothing before it starts, the last place once more on close', async () => {
    const onProgress = vi.fn();
    const { unmount } = render(<VodPlayer src={FILM} volume={1} onProgress={onProgress} />);
    await playTo(0, 0); // still loading
    expect(onProgress).not.toHaveBeenCalled();
    await playTo(65, 5400);
    expect(onProgress).toHaveBeenLastCalledWith(65, 5400);
    await playTo(75, 5400);
    expect(onProgress).toHaveBeenLastCalledWith(75, 5400);
    expect(onProgress).toHaveBeenCalledTimes(2);
    // The app went to the background and the player answers 0: the place stands.
    h.pos = 0;
    unmount();
    expect(onProgress).toHaveBeenLastCalledWith(75, 5400);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it('the browser build: the <video>\'s place, its length once known', async () => {
    h.native = false;
    const onProgress = vi.fn();
    render(<VodPlayer src={FILM} volume={1} onProgress={onProgress} />);
    // The lazy player arrives.
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(document.querySelector('video')).not.toBeNull();
    await playTo(30, 0);
    expect(onProgress).toHaveBeenLastCalledWith(30, 0);
    await playTo(5200, 5400);
    expect(onProgress).toHaveBeenLastCalledWith(5200, 5400);
    expect(h.getPosition).not.toHaveBeenCalled();
  });

  it("the next episode: the last place goes to the one that played it, not to the next", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<VodPlayer src={EP1} volume={1} onProgress={first} />);
    await playTo(2350, 2400);
    expect(first).toHaveBeenLastCalledWith(2350, 2400);
    h.pos = 3; // the next one has just started
    rerender(<VodPlayer src={EP2} volume={1} onProgress={second} />);
    expect(first).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenLastCalledWith(2350, 2400);
    expect(second).not.toHaveBeenCalled();
    await playTo(70, 2500);
    expect(second).toHaveBeenLastCalledWith(70, 2500);
    expect(first).toHaveBeenCalledTimes(2);
  });

  it('no onProgress: plays as before', async () => {
    render(<VodPlayer src={FILM} volume={1} />);
    await playTo(65, 5400);
    expect(document.querySelector('[data-vod-player]')).not.toBeNull();
  });
});
