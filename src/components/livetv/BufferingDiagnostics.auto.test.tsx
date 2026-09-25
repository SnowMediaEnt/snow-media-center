/**
 * The Plex buffering card says whether automatic quality is on and what it
 * will do, once: the verdict's own advice ("Lowering to … automatically")
 * replaces the separate line. The internet number is a quick 256 KB check,
 * and on Plex's card says so (Live TV's card is as it was). And it blames no
 * one without proof: a server that sends nothing is "waiting for it", never
 * "it can't send this fast enough — pick 480p". A connection that dropped
 * is said as that, ahead of the server going quiet, and without the last
 * internet number as if it were current.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BufferingDiagnostics from './BufferingDiagnostics';
import { beginStream, endStream, getPlayerRates, recordPlayerRate, setBuffering, type DiagSnapshot } from '@/lib/bufferDiagnostics';
import { stallEvidence } from '@/lib/plexAutoQuality';
import { explainPlexStall } from '@/lib/plexStallVerdict';

const fetchMock = vi.fn();
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => { endStream(); });
  document.documentElement.classList.remove('native-low-memory');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function stall() {
  act(() => { beginStream('http://srv/library/parts/1/file.mkv', 'vod'); });
  await wait(10_000);
  act(() => { setBuffering(true); });
  await wait(2_100);
}

describe('buffering card: automatic quality', () => {
  it('shows what automatic quality will do', async () => {
    render(<BufferingDiagnostics buffering autoNote={() => 'Auto quality: will lower to 720p · 3 Mbps if it keeps stalling'} />);
    await stall();
    expect(screen.getByText('Auto quality: will lower to 720p · 3 Mbps if it keeps stalling')).toBeTruthy();
  });

  it('says so when it is off for this title', async () => {
    render(<BufferingDiagnostics buffering autoNote={() => 'Auto quality off for this title (you picked 480p · 2 Mbps)'} />);
    await stall();
    expect(screen.getByText(/Auto quality off for this title/)).toBeTruthy();
  });

  it('once: not again when the verdict already says it is lowering', async () => {
    const explain = () => ({
      verdict: 'internet' as const, headline: 'Quick internet check: 3.0 Mb/s, slower than this video needs',
      detail: 'It needs about 8.0 Mb/s. Lowering to 720p · 3 Mbps automatically if it keeps stalling.', autoSaid: true,
    });
    render(<BufferingDiagnostics buffering explain={explain} autoNote={() => 'Auto quality: will lower to 720p · 3 Mbps if it keeps stalling'} />);
    await stall();
    expect(screen.getByText(/Lowering to 720p · 3 Mbps automatically/)).toBeTruthy();
    expect(screen.queryByText(/^Auto quality:/)).toBeNull();
  });

  it('Live TV (no autoNote) shows no such line', async () => {
    render(<BufferingDiagnostics buffering />);
    await stall();
    expect(screen.queryByText(/Auto quality/)).toBeNull();
  });
});

describe('buffering card: the internet number is a quick check', () => {
  it('labelled once measured, not while checking', async () => {
    document.documentElement.classList.add('native-low-memory');
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(65536), { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    render(<BufferingDiagnostics buffering needKbps={8000} quickCheckLabel />);
    act(() => { beginStream('http://srv/library/parts/1/file.mkv', 'vod'); });
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(300);
    // Probe not in yet.
    expect(screen.queryByText(/quick check/)).toBeNull();
    await wait(2_000);
    const row = screen.getByText(/^Now/).parentElement?.textContent ?? '';
    expect(row).toMatch(/Internet \d+\.\d Mb\/s \(quick check\)/);
  });
});

describe('buffering card: Live TV is left as it was', () => {
  it('no "(quick check)" label without the Plex opt-in', async () => {
    document.documentElement.classList.add('native-low-memory');
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(65536), { status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    render(<BufferingDiagnostics buffering />);
    act(() => { beginStream('http://srv/live/1.ts', 'live'); });
    await wait(10_000);
    act(() => { setBuffering(true); });
    await wait(2_300);
    const row = screen.getByText(/^Now/).parentElement?.textContent ?? '';
    expect(row).toMatch(/Internet \d+\.\d Mb\/s$/);
    expect(row).not.toMatch(/quick check/);
  });
});

describe('buffering card: no blame without proof', () => {
  // As PlexSection wires it: the stall's evidence from the player's own
  // reports, a 20 Mb/s file played as it is.
  const explain = (snap: DiagSnapshot) => {
    const now = Date.now();
    const ev = snap.bufferingForMs > 0 ? stallEvidence(getPlayerRates(), now - snap.bufferingForMs, now) : null;
    return explainPlexStall(snap, { fileKbps: 20000, transcoding: false, route: 'direct', serverKbps: ev?.kbps ?? null, quietMs: ev?.quietMs ?? 0, autoNext: '1080p · 12 Mbps' });
  };

  it('topping up at 0.75x the file, then the server pauses: "waiting for it", no preset', async () => {
    render(<BufferingDiagnostics buffering needKbps={20000} explain={explain} quickCheckLabel />);
    act(() => { beginStream('http://srv/library/parts/1/file.mkv', 'vod'); });
    for (let i = 0; i < 4; i += 1) { await wait(3_000); act(() => { recordPlayerRate(15000); }); }
    act(() => { setBuffering(true); });
    await wait(1_000);
    // The window straddling the stall, then nothing: reported once as 0.
    act(() => { recordPlayerRate(8000); });
    await wait(3_000);
    act(() => { recordPlayerRate(0); });
    await wait(3_000);
    expect(screen.getByText('Waiting for the Plex server to answer')).toBeTruthy();
    expect(screen.getByText(/^No data from the server for \d+ s\.$/)).toBeTruthy();
    expect(screen.queryByText(/Pick|Lowering|can't send/)).toBeNull();
  });

  it('a line that really is too slow: every window of the stall short, so it says so', async () => {
    render(<BufferingDiagnostics buffering needKbps={20000} explain={explain} quickCheckLabel />);
    act(() => { beginStream('http://srv/library/parts/1/file.mkv', 'vod'); });
    for (let i = 0; i < 4; i += 1) { await wait(3_000); act(() => { recordPlayerRate(9000); }); }
    act(() => { setBuffering(true); });
    for (let i = 0; i < 2; i += 1) { await wait(3_000); act(() => { recordPlayerRate(9000); }); }
    expect(screen.getByText('The Plex server connection is too slow for this video')).toBeTruthy();
    expect(screen.getByText(/Lowering to 1080p · 12 Mbps automatically/)).toBeTruthy();
  });
});

describe('buffering card: a connection that dropped', () => {
  // As PlexSection wires it (see above), a 20 Mb/s file played as it is.
  const explain = (snap: DiagSnapshot) => {
    const now = Date.now();
    const ev = snap.bufferingForMs > 0 ? stallEvidence(getPlayerRates(), now - snap.bufferingForMs, now) : null;
    return explainPlexStall(snap, { fileKbps: 20000, transcoding: false, route: 'direct', serverKbps: ev?.kbps ?? null, quietMs: ev?.quietMs ?? 0, autoNext: '1080p · 12 Mbps' });
  };
  // The internet check answers once, then fails every time; navigator.onLine
  // stays true (an Android TV whose router lost the internet).
  function dropAfterFirstCheck() {
    let checks = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('speed.cloudflare.com') && (checks += 1) === 1) {
        return new Response(new Uint8Array(262144), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
      }
      throw new TypeError('Failed to fetch');
    });
  }
  async function quietStall() {
    act(() => { beginStream('http://srv/library/parts/1/file.mkv', 'vod'); });
    for (let i = 0; i < 4; i += 1) { await wait(3_000); act(() => { recordPlayerRate(15000); }); }
    act(() => { setBuffering(true); });
    // Nothing arrives from the server (reported once, as 0).
    await wait(3_000);
    act(() => { recordPlayerRate(0); });
  }
  const internetRow = () => screen.getByText(/^Now/).parentElement?.textContent ?? '';

  it('the server going quiet, then the internet check failing twice: "connection dropped", no stale number', async () => {
    dropAfterFirstCheck();
    render(<BufferingDiagnostics buffering needKbps={20000} explain={explain} quickCheckLabel />);
    await quietStall();
    // One check in (half a second into the stall), and it was fine: the
    // server is what went quiet.
    await wait(15_000);
    expect(screen.getByText('Waiting for the Plex server to answer')).toBeTruthy();
    expect(internetRow()).toMatch(/Internet \d+\.\d Mb\/s \(quick check\)/);
    // The next one (20 s on) fails: once is not a drop.
    await wait(5_000);
    expect(screen.getByText('Waiting for the Plex server to answer')).toBeTruthy();
    // Twice running: the connection dropped, however long nothing has come
    // from the server.
    await wait(20_000);
    expect(screen.getByText('Your internet connection dropped')).toBeTruthy();
    expect(screen.queryByText(/Waiting for the Plex server/)).toBeNull();
    expect(internetRow()).toMatch(/Internet —$/);
    expect(internetRow()).not.toMatch(/Mb\/s \(quick check\)|Internet \d/);
  });

  it('Live TV (no explain) is left as it was', async () => {
    dropAfterFirstCheck();
    render(<BufferingDiagnostics buffering />);
    await quietStall();
    await wait(40_000);
    expect(screen.getByText('Your internet connection dropped')).toBeTruthy();
    expect(internetRow()).toMatch(/Internet \d+\.\d Mb\/s$/);
  });
});
