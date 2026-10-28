/**
 * bufferDiagnostics' stall observer (Device Health's hook into every player
 * that feeds it): a stall after the stream has played is reported when it
 * ends, or when the stream is left mid-stall; the start-up fill never is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));

import { beginStream, endStream, setBuffering, setStallObserver, type StallReport } from './bufferDiagnostics';

let seen: StallReport[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  // No probe may reach the network here.
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests'); }));
  seen = [];
  setStallObserver((r) => seen.push(r));
});
afterEach(() => {
  endStream();
  setStallObserver(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('stall observer', () => {
  it('the start-up fill is not a stall; one after playing is, with its length', () => {
    beginStream('http://h.test/live/u/p/1.ts', 'live');
    setBuffering(true);
    vi.advanceTimersByTime(9000);
    setBuffering(false);
    expect(seen).toHaveLength(0);
    setBuffering(true);
    vi.advanceTimersByTime(7000);
    setBuffering(false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ended: false, kind: 'live' });
    expect(seen[0].durationMs).toBeGreaterThanOrEqual(7000);
    // Nothing in the report names the stream.
    expect(JSON.stringify(seen)).not.toContain('h.test');
  });

  it('a stream left (or replaced) mid-stall reports it as never recovered', () => {
    beginStream('http://h.test/movie/u/p/2.mp4', 'vod');
    setBuffering(true);
    setBuffering(false);
    setBuffering(true);
    vi.advanceTimersByTime(5000);
    endStream();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ ended: true, kind: 'vod' });
    beginStream('http://h.test/live/u/p/3.ts', 'live');
    setBuffering(false);
    setBuffering(true);
    beginStream('http://h.test/live/u/p/4.ts', 'live');
    expect(seen).toHaveLength(2);
  });

  it('no observer: nothing happens', () => {
    setStallObserver(null);
    beginStream('http://h.test/live/u/p/1.ts', 'live');
    setBuffering(false);
    setBuffering(true);
    setBuffering(false);
    expect(seen).toHaveLength(0);
  });
});
