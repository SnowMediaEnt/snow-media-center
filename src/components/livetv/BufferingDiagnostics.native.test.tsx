/**
 * On the box (native player) the WebView no longer reads the film the player
 * is reading. Those 64-128 KB reads from byte 0, each on a fresh connection,
 * measured TCP slow start, not the server: they were the customer's
 * "1.4 Mb/s". The card's "was" is now the player's own best arrival window
 * of the first 30 s; the internet number is the labelled quick check alone;
 * and a film's reload (a retry, a quality change) keeps the probe clock and
 * its last number instead of probing again. A recording running on the box
 * is named on the card: it shares the line.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/platform', () => ({ isNativePlatform: () => true }));
const rec = vi.hoisted(() => ({ jobs: [] as unknown[], native: true, calls: 0 }));
vi.mock('@/capacitor/SnowRecorder', () => ({
  RECORDINGS_CHANGED_EVENT: 'smc-recordings:changed',
  hasRecorder: () => rec.native,
  SnowRecorder: { active: async () => { rec.calls += 1; return { jobs: rec.jobs }; } },
}));

import BufferingDiagnostics from './BufferingDiagnostics';
import { beginStream, endStream, getSnapshot, recordPlayerRate, setBuffering } from '@/lib/bufferDiagnostics';

const FILE = 'https://203-0-113-5.abc123.plex.direct:32400/library/parts/1/file.mkv?X-Plex-Token=t';
const fetchMock = vi.fn();
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const answers = () => new Response(new Uint8Array(65536), { status: 200, headers: { 'content-type': 'application/octet-stream' } });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockImplementation(async () => answers());
  vi.stubGlobal('fetch', fetchMock);
  rec.jobs = [];
  rec.native = true;
  rec.calls = 0;
});
afterEach(() => {
  act(() => { endStream(); });
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native film: no WebView reads of the file', () => {
  it('takes no background samples while it plays', async () => {
    beginStream(FILE, 'vod');
    await wait(200_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a stall runs the internet quick check alone, never a read of the file or its server', async () => {
    beginStream(FILE, 'vod');
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(1_000);
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain('speed.cloudflare.com');
    expect(urls().some((u) => u.includes('plex.direct'))).toBe(false);
    expect(getSnapshot().hostKbps).toBeNull();
    expect(getSnapshot().streamKbps).toBeNull();
  });

  it('a live channel still has its server answer timed, as before', async () => {
    beginStream('http://line.example:8080/live/u/p/1.ts', 'live');
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(1_000);
    expect(urls().some((u) => u.indexOf('http://line.example:8080/') === 0)).toBe(true);
  });
});

describe('"was": the player\'s own arrival rate', () => {
  it('is the best 3 s window of the film\'s first 30 s', async () => {
    beginStream(FILE, 'vod');
    expect(getSnapshot().streamEarlyKbps).toBeNull();
    for (const kbps of [8000, 31000, 12000, 0]) { await wait(3_000); act(() => { recordPlayerRate(kbps); }); }
    // Later windows are "now", not "was".
    await wait(30_000);
    act(() => { recordPlayerRate(60000); });
    render(<BufferingDiagnostics buffering />);
    act(() => { setBuffering(true); });
    await wait(2_100);
    expect(getSnapshot().streamEarlyKbps).toBe(31000);
    expect(screen.getByText(/^Now/).parentElement?.textContent).toMatch(/was 31\.0/);
  });

  it('is left out for a live channel', async () => {
    beginStream('http://line.example:8080/live/u/p/1.ts', 'live');
    act(() => { recordPlayerRate(40000); });
    expect(getSnapshot().streamEarlyKbps).toBeNull();
  });
});

describe('a film\'s reload keeps the probe clock', () => {
  it('a retry or quality change within the 20 s does not probe again, and keeps the internet number', async () => {
    beginStream(FILE, 'vod');
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const internet = getSnapshot().probeKbps;
    expect(internet).not.toBeNull();

    // The player errors and the same title loads again.
    act(() => { endStream(); beginStream(`${FILE}&retry=1`, 'vod'); setBuffering(true); });
    expect(getSnapshot().probeKbps).toBe(internet);
    await wait(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The cadence still allows the next round once its 20 s are up.
    await wait(16_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a live channel starts afresh, as before', async () => {
    beginStream(FILE, 'vod');
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(1_000);
    act(() => { endStream(); beginStream('http://line.example:8080/live/u/p/1.ts', 'live'); });
    expect(getSnapshot().probeKbps).toBeNull();
  });
});

describe('a recording running on the box', () => {
  it('is named on the card while it shows', async () => {
    rec.jobs = [{ id: 'r1', channel: 'News', name: 'News', startedAt: 0, endsAt: 0, bytes: 0 }];
    beginStream(FILE, 'vod');
    render(<BufferingDiagnostics buffering />);
    expect(rec.calls).toBe(0); // not asked until the card shows
    act(() => { setBuffering(true); });
    await wait(2_100);
    expect(screen.getByText('A recording is using part of your internet.')).toBeTruthy();
  });

  it('says nothing when none is running, or on an app without the recorder', async () => {
    beginStream(FILE, 'vod');
    const { unmount } = render(<BufferingDiagnostics buffering />);
    await wait(2_100);
    expect(screen.queryByText(/recording is using/)).toBeNull();
    unmount();
    rec.native = false;
    rec.jobs = [{ id: 'r1' }];
    render(<BufferingDiagnostics buffering />);
    await wait(2_100);
    expect(screen.queryByText(/recording is using/)).toBeNull();
  });
});
