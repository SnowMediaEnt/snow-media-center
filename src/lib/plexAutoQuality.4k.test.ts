// Automatic quality and a 4K film (bugs/plex-4k.md). On the owner's TV a 4K
// title stalled at the start and was then "Lowered to 1080p", while the Plex
// app plays the same file from the same server at ~84 Mb/s on average (peaks
// ~300). What says the line is fast enough for a 4K file is what the player
// itself was sent by the server, not only the quick internet check (a 256 KB
// download from Cloudflare, which rarely reads the 120-160 Mb/s a 60-80 Mb/s
// file needed); and once that proves the line, stalls alone never take a 4K
// file off to the 1080p file either. 1080p keeps the 1.7.9 rules.
import { describe, expect, it } from 'vitest';
import { mediaVersions } from './plex';
import {
  AutoQuality, buildQualityLadder, lineClearFor, lineClearForFile, stallEvidence,
  INTERNET_CLEAR_FACTOR, RATE_TICK_MS, START_GRACE_MS,
} from './plexAutoQuality';

const MIN = 60_000;
// A film kept as a 4K (60 Mb/s) and a 1080p (10 Mb/s) file.
const versions = mediaVersions({
  Media: [
    { videoResolution: '4k', bitrate: 60000, height: 2160, Part: [{ key: '/p/4k' }] },
    { videoResolution: '1080', bitrate: 10000, height: 1080, Part: [{ key: '/p/1080' }] },
  ],
}, '7');
const ladder = buildQualityLadder(versions);
const at4k = 0;
// The same 1080p file on its own (a 1080p title).
const hd = buildQualityLadder([], 21600);

describe('a 4K file: what says the line is fast enough', () => {
  it('the player\'s own best rate from the server counts for a 4K file', () => {
    // Quick check low (a short download), the player was sent 200 Mb/s while filling its start.
    expect(lineClearFor(60000, { uhd: true, internetKbps: 40000, serverKbps: 200000 })).toBe(true);
    // Not twice the file: not clear.
    expect(lineClearFor(60000, { uhd: true, internetKbps: 40000, serverKbps: 90000 })).toBe(false);
    // The Plex Relay: never.
    expect(lineClearFor(60000, { uhd: true, serverKbps: 200000, relay: true })).toBe(false);
  });

  it('for anything else only the internet check counts, as in 1.7.9', () => {
    expect(lineClearFor(21600, { internetKbps: 40000, serverKbps: 200000 })).toBe(false);
    expect(lineClearFor(21600, { internetKbps: 21600 * INTERNET_CLEAR_FACTOR })).toBe(true);
  });

  it('once the line is proven, a 4K file is not left for the 1080p file on stalls alone', () => {
    const toFile = ladder[1];
    expect(toFile.presetKey).toBe('original');
    expect(lineClearForFile(ladder, at4k, toFile, { uhd: true, serverKbps: 200000 })).toBe(true);
    // Not proven: the 1080p file is still where it goes.
    expect(lineClearForFile(ladder, at4k, toFile, { uhd: true, serverKbps: 70000 })).toBe(false);
    // A 1080p title with a lighter file keeps the 1.7.9 rule: a lighter file is always allowed.
    expect(lineClearForFile(ladder, at4k, toFile, { internetKbps: 500000 })).toBe(false);
    expect(lineClearForFile(hd, 0, hd[1], { internetKbps: 21600 * INTERNET_CLEAR_FACTOR })).toBe(true);
  });

  it('AutoQuality: three stalls after the start keep a 4K file whose line is proven, and still drop one whose line is not', () => {
    const start = 10 * MIN;
    const stallsAt = [start + START_GRACE_MS + 1_000, start + START_GRACE_MS + 30_000, start + START_GRACE_MS + 60_000];
    const proven = new AutoQuality(0);
    const moves = stallsAt.map((t) => proven.onStall(t, 0, ladder, at4k, 70000, { lastStartAt: start, uhd: true, serverKbps: 200000 }));
    expect(moves).toEqual([null, null, null]);
    const slow = new AutoQuality(0);
    const last = stallsAt.map((t) => slow.onStall(t, 0, ladder, at4k, 70000, { lastStartAt: start, uhd: true, serverKbps: 70000 })).pop();
    expect(last?.step.key).toBe(ladder[1].key);
  });
});

describe('a 4K file: a stall is judged by the player\'s own windows', () => {
  const now = 1_000_000;
  it('a fresh read of the file never stands in for them (with them in, it can still clear the stall)', () => {
    const stallStart = now - 7_000;
    // One window inside the stall at 40 Mb/s, and the title page's short read at 30.
    const rates = [{ t: stallStart - RATE_TICK_MS, kbps: 60000 }, { t: stallStart + 1_000, kbps: 40000 }];
    // As in 1.7.9 for a 1080p file: the read makes up the second window.
    expect(stallEvidence(rates, stallStart, now, 30000).kbps).toBe(40000);
    // A 4K file waits for the player's own second window.
    expect(stallEvidence(rates, stallStart, now, 30000, { needWindows: true }).kbps).toBeNull();
    // A fast read still clears a slow-looking window.
    expect(stallEvidence(rates, stallStart, now, 90000, { needWindows: true }).kbps).toBeNull();
    const two = [...rates, { t: stallStart + 4_000, kbps: 45000 }];
    expect(stallEvidence(two, stallStart, now, 90000, { needWindows: true }).kbps).toBe(90000);
    expect(stallEvidence(two, stallStart, now, 30000, { needWindows: true }).kbps).toBe(45000);
  });
});
