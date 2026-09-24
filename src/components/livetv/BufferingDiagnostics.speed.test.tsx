/**
 * "In Plex it shows the speed needed to stream the movie but doesn't show the
 * speed we currently are at." The card now always has a "Now" next to
 * "Needs": the native player's own download rate, "Checking…" until it has
 * one. The internet probe starts half a second into a stall (so it is in by
 * the time the card shows at 2 s), and on a low-memory box — every Fire TV —
 * it now runs too, alone, instead of never.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BufferingDiagnostics from './BufferingDiagnostics';
import {
  beginStream, endStream, getPlayerSpeedKbps, getSnapshot, recordPlayerRate, setBuffering,
} from '@/lib/bufferDiagnostics';

const fetchMock = vi.fn();
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const row = () => screen.getByText(/^Now/).parentElement?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers();
  // Never answers: the probe stays "in flight" unless a test says otherwise.
  fetchMock.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => { endStream(); });
  document.documentElement.classList.remove('native-low-memory');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('buffering card: the current speed', () => {
  it('shows Now next to Needs — "Checking…" first, then the player\'s rate', async () => {
    beginStream('http://srv/library/parts/1/file.mkv', 'vod');
    await wait(10_000);
    render(<BufferingDiagnostics buffering needKbps={12000} />);
    act(() => { setBuffering(true); });
    await wait(2_100);
    expect(row()).toMatch(/Now Checking….*Needs 12\.0 Mb\/s.*Internet Checking…/);
    expect(row()).not.toContain('—');

    act(() => { recordPlayerRate(4100); });
    expect(row()).toMatch(/Now 4\.1 Mb\/s/);
    // Nothing arriving is a speed too, not "Checking…".
    act(() => { recordPlayerRate(0); });
    expect(row()).toMatch(/Now 0\.0 Mb\/s/);
  });

  it('the player rate is kept out of the throttling evidence', () => {
    beginStream('http://srv/live/1.ts', 'live');
    recordPlayerRate(40000);
    recordPlayerRate(900);
    const s = getSnapshot();
    expect(s.streamKbps).toBeNull();
    expect(s.streamEarlyKbps).toBeNull();
  });

  it('"Your speed" is the best recent rate, and resets with the stream', () => {
    beginStream('http://srv/f.mkv', 'vod');
    expect(getPlayerSpeedKbps()).toBeNull();
    recordPlayerRate(31000);
    recordPlayerRate(8000);
    recordPlayerRate(0);
    expect(getPlayerSpeedKbps()).toBe(31000);
    beginStream('http://srv/g.mkv', 'vod');
    expect(getPlayerSpeedKbps()).toBeNull();
  });
});

describe('internet probe timing', () => {
  it('mid-film stall: probes within 0.5 s, not 1.5 s', async () => {
    beginStream('http://srv/library/parts/1/file.mkv', 'vod');
    await wait(10_000);
    const before = fetchMock.mock.calls.length;
    act(() => { setBuffering(true); });
    await wait(600);
    const urls = fetchMock.mock.calls.slice(before).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('speed.cloudflare.com'))).toBe(true);
  });

  it('live zapping: no probe in the first 6 s of a channel', async () => {
    beginStream('http://srv/live/1.ts', 'live');
    act(() => { setBuffering(true); });
    await wait(5_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('low-memory box: the internet probe alone, then not again within a minute', async () => {
    document.documentElement.classList.add('native-low-memory');
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(65536), { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    beginStream('http://srv/library/parts/1/file.mkv', 'vod');
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(1_000);
    let urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('speed.cloudflare.com');
    expect(getSnapshot().probeKbps).not.toBeNull();

    await wait(40_000);
    urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    // Playing again: no recovery probe on this box.
    act(() => { setBuffering(false); });
    await wait(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
