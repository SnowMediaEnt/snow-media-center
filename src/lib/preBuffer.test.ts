import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPreBuffer, isPreBuffering, notePreBuffer, preBufferProgress } from './preBuffer';

describe('start-up hold', () => {
  afterEach(() => { clearPreBuffer(); vi.useRealTimers(); });

  it('shows whichever of the buffer target and the time limit is nearer', () => {
    expect(preBufferProgress({ bufferedMs: 5000, targetMs: 25000, elapsedMs: 1000, maxWaitMs: 10000 })).toBeCloseTo(0.2);
    expect(preBufferProgress({ bufferedMs: 2000, targetMs: 25000, elapsedMs: 6000, maxWaitMs: 10000 })).toBeCloseTo(0.6);
    expect(preBufferProgress({ bufferedMs: 40000, targetMs: 25000, elapsedMs: 0, maxWaitMs: 10000 })).toBe(1);
  });

  it('is on while events come in, and off on the last one or when they stop', () => {
    vi.useFakeTimers();
    notePreBuffer({ screenId: 'main', bufferedMs: 1000, targetMs: 25000, elapsedMs: 500, maxWaitMs: 10000 });
    expect(isPreBuffering()).toBe(true);
    notePreBuffer({ screenId: 'main', done: true });
    expect(isPreBuffering()).toBe(false);
    notePreBuffer({ screenId: 'main', bufferedMs: 1000, targetMs: 25000, elapsedMs: 500, maxWaitMs: 10000 });
    vi.advanceTimersByTime(3000);
    expect(isPreBuffering()).toBe(false);
    // Another screen's player is not the film.
    notePreBuffer({ screenId: 'tile-2', bufferedMs: 1000, targetMs: 25000 });
    expect(isPreBuffering()).toBe(false);
  });
});
