import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAction, PlayerPrompt } from './PlexPlayerOverlay';

const withMarkers = {
  ratingKey: '11', kind: 'episode', title: 'Pilot', index: 1, seasonIndex: 1, seasonKey: '10', showKey: '1', showTitle: 'Show',
  duration: 1800,
  markers: [{ type: 'intro', start: 30, end: 95 }, { type: 'credits', start: 1740, end: 1800 }],
};
const nextEp = { ratingKey: '12', title: 'Two', index: 2, seasonIndex: 1 };
let info: Record<string, unknown> = withMarkers;
let next: typeof nextEp | null = nextEp;
let duration = 1800;

vi.mock('@/lib/plex', () => ({
  getPlexPlayInfo: vi.fn(async () => info),
  getNextPlexEpisode: vi.fn(async () => next),
}));
const finishing = vi.fn();
vi.mock('@/lib/plexProgress', async (orig) => ({
  ...(await orig<typeof import('@/lib/plexProgress')>()),
  noteEpisodeFinishing: (k: string) => finishing(k),
}));

let position = 0;
let playing = true;
const getPosition = vi.fn(async () => ({ position, duration, playing }));
const seekTo = vi.fn(async () => {});

const flush = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers(); position = 0; playing = true; seekTo.mockClear(); finishing.mockClear();
  info = withMarkers; next = nextEp; duration = 1800;
});
afterEach(() => { vi.useRealTimers(); });

async function mount() {
  const { default: EpisodeAutoplay } = await import('./EpisodeAutoplay');
  const prompts: Array<PlayerPrompt | null> = [];
  const onPlayNext = vi.fn();
  const actions: Array<NextAction | null> = [];
  let ended: (() => boolean) | null = null;
  render(
    <EpisodeAutoplay
      active base="http://pms" token="t" ratingKey="11"
      getPosition={getPosition} seekTo={seekTo}
      onPrompt={(p) => prompts.push(p)}
      onPlayNext={onPlayNext}
      registerEnded={(fn) => { ended = fn; }}
      onNextAction={(a) => actions.push(a)}
    />,
  );
  await flush();
  return {
    prompts, onPlayNext, last: () => prompts[prompts.length - 1], ended: () => ended,
    action: () => actions[actions.length - 1] ?? null,
  };
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
    position = 1735;
    await flush(1000);
    position = 1745; // played into the credits
    await flush(1000);
    expect(m.last()?.kind).toBe('next');
    expect(m.last()?.detail).toContain('S1 · E2');
    await flush(11_000);
    expect(m.onPlayNext).toHaveBeenCalledTimes(1);
    expect(m.onPlayNext.mock.calls[0][0].ratingKey).toBe('12');
  });

  it('landing in the credits (a resume or a seek) shows Up Next without the countdown', async () => {
    const m = await mount();
    position = 1760;
    await flush(1000);
    expect(m.last()?.kind).toBe('next');
    expect(m.last()?.countdown).toBeUndefined();
    await flush(15_000);
    expect(m.onPlayNext).not.toHaveBeenCalled();
    act(() => m.last()!.onOk());
    expect(m.onPlayNext).toHaveBeenCalledTimes(1);
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
    position = 1735;
    await flush(1000);
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

  describe('without a credits marker', () => {
    const noMarkers = (dur: number) => ({ ...withMarkers, duration: dur, markers: [] });

    it('Up Next comes a minute before the end of a full-length episode', async () => {
      info = noMarkers(3600); duration = 3600;
      const m = await mount();
      position = 3530; // 70 s left
      await flush(5000);
      expect(m.last()?.kind ?? null).toBeNull();
      position = 3541; // 59 s left
      await flush(2000);
      expect(m.last()?.kind).toBe('next');
      expect(m.last()?.countdown).toBe(10);
    });

    it('a short episode gets 5% of it, at least 20 s', async () => {
      info = noMarkers(600); duration = 600; // 5% = 30 s
      const m = await mount();
      position = 565;
      await flush(2000);
      expect(m.last()?.kind ?? null).toBeNull();
      position = 571;
      await flush(2000);
      expect(m.last()?.kind).toBe('next');
    });

    it('a credits marker still wins (earlier than a minute before the end)', async () => {
      info = { ...withMarkers, duration: 1800, markers: [{ type: 'credits', start: 1650, end: 1800 }] };
      const m = await mount();
      position = 1655; // 145 s left: past the marker, long before the minute
      await flush(2000);
      expect(m.last()?.kind).toBe('next');
    });
  });

  describe('the bar\'s Next episode', () => {
    it('is offered while there is a next episode and plays it through onPlayNext', async () => {
      const m = await mount();
      expect(m.action()?.detail).toContain('S1 · E2');
      position = 600;
      await act(async () => { m.action()!.run(); await vi.advanceTimersByTimeAsync(0); });
      expect(m.onPlayNext).toHaveBeenCalledTimes(1);
      expect(m.onPlayNext.mock.calls[0][0].ratingKey).toBe('12');
      // Mid-episode: the place is kept (the reporter's closing save), not
      // marked watched.
      expect(finishing).not.toHaveBeenCalled();
    });

    it('taken in the credits counts the episode as watched, as Up Next does', async () => {
      const m = await mount();
      position = 1750;
      await act(async () => { m.action()!.run(); await vi.advanceTimersByTimeAsync(0); });
      expect(m.onPlayNext).toHaveBeenCalledTimes(1);
      expect(finishing).toHaveBeenCalledWith('11');
    });

    it('is absent on the last episode', async () => {
      next = null;
      const m = await mount();
      expect(m.action()).toBeNull();
    });
  });
});
