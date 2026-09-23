import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPrompt } from './PlexPlayerOverlay';

const info = {
  ratingKey: '11', kind: 'episode', title: 'Pilot', index: 1, seasonIndex: 1, seasonKey: '10', showKey: '1', showTitle: 'Show',
  duration: 1800,
  markers: [{ type: 'intro', start: 30, end: 95 }, { type: 'credits', start: 1740, end: 1800 }],
};
const next = { ratingKey: '12', title: 'Two', index: 2, seasonIndex: 1 };

vi.mock('@/lib/plex', () => ({
  getPlexPlayInfo: vi.fn(async () => info),
  getNextPlexEpisode: vi.fn(async () => next),
}));

let position = 0;
let playing = true;
const getPosition = vi.fn(async () => ({ position, duration: 1800, playing }));
const seekTo = vi.fn(async () => {});

const flush = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => { vi.useFakeTimers(); position = 0; playing = true; seekTo.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

async function mount() {
  const { default: EpisodeAutoplay } = await import('./EpisodeAutoplay');
  const prompts: Array<PlayerPrompt | null> = [];
  const onPlayNext = vi.fn();
  let ended: (() => boolean) | null = null;
  render(
    <EpisodeAutoplay
      active base="http://pms" token="t" ratingKey="11"
      getPosition={getPosition} seekTo={seekTo}
      onPrompt={(p) => prompts.push(p)}
      onPlayNext={onPlayNext}
      registerEnded={(fn) => { ended = fn; }}
    />,
  );
  await flush();
  return { prompts, onPlayNext, last: () => prompts[prompts.length - 1], ended: () => ended };
}

describe('EpisodeAutoplay', () => {
  it('offers Skip Intro during the intro and seeks past it', async () => {
    const m = await mount();
    position = 40;
    await flush(1000);
    expect(m.last()?.kind).toBe('skip');
    act(() => m.last()!.onOk());
    expect(seekTo).toHaveBeenCalledWith(95);
    position = 96;
    await flush(1000);
    expect(m.last()).toBeNull();
  });

  it('counts down at the credits and starts the next episode', async () => {
    const m = await mount();
    position = 1745;
    await flush(1000);
    expect(m.last()?.kind).toBe('next');
    expect(m.last()?.detail).toContain('S1 · E2');
    await flush(11_000);
    expect(m.onPlayNext).toHaveBeenCalledTimes(1);
    expect(m.onPlayNext.mock.calls[0][0].ratingKey).toBe('12');
  });

  it('Back keeps watching: no countdown, and the end closes as before', async () => {
    const m = await mount();
    position = 1745;
    await flush(1000);
    act(() => m.last()!.onBack!());
    await flush(1000);
    expect(m.last()).toBeNull();
    await flush(12_000);
    expect(m.onPlayNext).not.toHaveBeenCalled();
    expect(m.ended()?.()).toBe(false);
  });

  it('a pause holds the countdown', async () => {
    const m = await mount();
    position = 1745;
    await flush(1000);
    playing = false;
    await flush(15_000);
    expect(m.onPlayNext).not.toHaveBeenCalled();
    playing = true;
    await flush(12_000);
    expect(m.onPlayNext).toHaveBeenCalledTimes(1);
  });

  it('the end of the episode starts the next one when Up Next was not dismissed', async () => {
    const m = await mount();
    expect(m.ended()?.()).toBe(true);
    expect(m.onPlayNext).toHaveBeenCalledTimes(1);
  });
});
