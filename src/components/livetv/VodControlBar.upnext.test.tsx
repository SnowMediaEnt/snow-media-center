// Live TV series episodes: Up Next a minute before the end (a panel has no
// credits markers; upNextLeadSeconds), OK takes it, Back keeps watching, a
// countdown plays it unless the series' autoplay is off. The bar's Next
// episode skips without marking the episode watched.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VodControlBar from './VodControlBar';

let position = 0;
let duration = 3600;
let playing = true;

const make = (upNext: { detail: string; autoplay: boolean } | null = { detail: 'S1 · E2  Two', autoplay: true }, hasNext = true) => {
  const controller = {
    togglePlay: vi.fn(), getSubtitleTracks: () => [], getAudioTracks: () => [],
    setSubtitleTrack: vi.fn(), setAudioTrack: vi.fn(), isSeekable: () => true,
  };
  const onNext = vi.fn();
  const onClose = vi.fn();
  const r = render(
    <VodControlBar
      controller={controller as never} tracksTick={0} paused={false}
      getPosition={async () => ({ position, duration, playing })}
      seekTo={vi.fn()} volume={1} maxVolume={1.5} onVolume={vi.fn()} onClose={onClose}
      onNext={onNext} hasNext={hasNext} upNext={upNext} srcKey="ep1"
    />,
  );
  return { ...r, onNext, onClose };
};
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const prompt = () => document.querySelector('[data-vod-upnext]');

beforeEach(() => { vi.useFakeTimers(); position = 0; duration = 3600; playing = true; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Live TV series: Up Next', () => {
  it('not before the last minute', async () => {
    position = 3530;
    make();
    await flush(6000);
    expect(prompt()).toBeNull();
  });

  it('a minute before the end, counts down and plays the next episode as watched', async () => {
    position = 3541;
    const { onNext } = make();
    await flush(6000);
    expect(prompt()?.textContent).toContain('S1 · E2');
    expect(prompt()?.textContent).toMatch(/playing in \d+/);
    await flush(11_000);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledWith({ finished: true });
  });

  it('a short episode: 5% of it, at least 20 s', async () => {
    duration = 600; position = 565; // 35 s left, lead 30 s
    make();
    await flush(6000);
    expect(prompt()).toBeNull();
    position = 571;
    await flush(2000);
    expect(prompt()).not.toBeNull();
  });

  it('OK takes it at once; Back keeps watching and does not leave', async () => {
    position = 3541;
    const a = make();
    await flush(6000);
    key('Enter');
    expect(a.onNext).toHaveBeenCalledWith({ finished: true });
    cleanup();
    const b = make();
    await flush(6000);
    key('Escape');
    await flush(0);
    expect(prompt()).toBeNull();
    expect(b.onClose).not.toHaveBeenCalled();
    await flush(15_000);
    expect(b.onNext).not.toHaveBeenCalled();
  });

  it('autoplay off: no countdown, it waits for OK', async () => {
    position = 3541;
    const { onNext } = make({ detail: 'S1 · E2  Two', autoplay: false });
    await flush(6000);
    expect(prompt()?.textContent).not.toMatch(/playing in/);
    await flush(20_000);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('none on the last episode', async () => {
    position = 3541;
    make(null, false);
    await flush(6000);
    expect(prompt()).toBeNull();
  });

  it('the bar\'s Next episode skips without marking this one watched', async () => {
    position = 600;
    const { onNext } = make();
    key('Enter'); // bar up on Play
    await flush(0);
    key('ArrowRight'); key('ArrowRight'); // forward 30 s, Next episode
    await flush(0);
    key('Enter');
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0][0]).toBeUndefined();
  });
});
