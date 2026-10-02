// Automatic quality and a 4K film (bugs/plex-4k.md). On the owner's TV a 4K
// title stalled at the start and was then "Lowered to 1080p", while the Plex
// app plays the same file from the same server at ~84 Mb/s on average (peaks
// ~300). What says the line is fast enough for a 4K file is what the server
// has delivered to the player itself, sustained — never the quick internet
// check (a 256 KB download from Cloudflare, which rarely reads the 120-160
// Mb/s a 60-80 Mb/s file needed; and a customer's read 42.5 Mb/s while the
// server sent 1.4-5.7). Once that proves the line, stalls alone never take
// a 4K file off to the 1080p file; only the server delivering too little
// does, and then after a longer look.
import { describe, expect, it } from 'vitest';
import { mediaVersions } from './plex';
import {
  AutoQuality, buildQualityLadder, keepsFileOnStalls, lineClearFor, sustainedKbps,
  PROVEN_FACTOR, PROVEN_WINDOWS, RATE_TICK_MS, START_GRACE_MS, type RateReport,
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

const fill = (kbps: number, n = PROVEN_WINDOWS): RateReport[] => Array.from({ length: n }, (_, i) => ({ t: (i + 1) * RATE_TICK_MS, kbps }));

describe('a 4K file: what says the line is fast enough', () => {
  it('what the server delivered to the player, sustained, counts for a 4K file', () => {
    // The player was sent 200 Mb/s while filling its start: twice the file.
    expect(sustainedKbps(fill(200000), MIN)).toBe(200000);
    expect(lineClearFor(60000, { uhd: true, sustainedKbps: 200000 })).toBe(true);
    // Not twice the file: not clear.
    expect(lineClearFor(60000, { uhd: true, sustainedKbps: 90000 })).toBe(false);
    // The Plex Relay: never.
    expect(lineClearFor(60000, { uhd: true, sustainedKbps: 200000, relay: true })).toBe(false);
    // A short burst (four windows) is not sustained.
    expect(sustainedKbps(fill(200000, PROVEN_WINDOWS - 1), MIN)).toBeNull();
  });

  it('for any file the sustained rate counts, and delivering too little now cancels it', () => {
    expect(lineClearFor(21600, { sustainedKbps: 200000 })).toBe(true);
    expect(lineClearFor(21600, { sustainedKbps: 21600 * PROVEN_FACTOR - 1 })).toBe(false);
    expect(lineClearFor(21600, { sustainedKbps: 200000, shortKbps: 9000 })).toBe(false);
  });

  it('once the line is proven, a 4K file is not left for the 1080p file on stalls alone', () => {
    expect(keepsFileOnStalls(ladder, at4k, { uhd: true, sustainedKbps: 200000 })).toBe(true);
    // Not proven: the 1080p file is still where it goes.
    expect(keepsFileOnStalls(ladder, at4k, { uhd: true, sustainedKbps: 70000 })).toBe(false);
    // A 1080p title with a lighter file keeps the 1.7.9 rule: a lighter file is always allowed.
    expect(keepsFileOnStalls(ladder, at4k, { sustainedKbps: 500000 })).toBe(false);
    expect(keepsFileOnStalls(hd, 0, { sustainedKbps: 21600 * PROVEN_FACTOR })).toBe(false);
  });

  it('AutoQuality: three stalls after the start keep a 4K file whose line is proven, and still move one whose line is not', () => {
    const start = 10 * MIN;
    const stallsAt = [start + START_GRACE_MS + 1_000, start + START_GRACE_MS + 30_000, start + START_GRACE_MS + 60_000];
    const proven = new AutoQuality(0);
    const moves = stallsAt.map((t) => proven.onStall(t, ladder, at4k, { lastStartAt: start, uhd: true, sustainedKbps: 200000 }));
    expect(moves).toEqual([null, null, null]);
    const slow = new AutoQuality(0);
    const last = stallsAt.map((t) => slow.onStall(t, ladder, at4k, { lastStartAt: start, uhd: true, sustainedKbps: 70000 })).pop();
    expect(last?.step.key).toBe(ladder[1].key);
    expect(last?.reason).toBe('stalls');
  });
});

describe('a 4K file: a stall is judged by what the server delivers in it', () => {
  const t = 10 * MIN;
  const inStall = (kbps: number[]): RateReport[] => kbps.map((k, i) => ({ t: t + (i + 1) * RATE_TICK_MS, kbps: k, stalled: true }));

  it('a slow spell of the server on a proven line gets a longer look; a line too slow for 4K still goes to the 1080p file', () => {
    const aq = new AutoQuality(0);
    const ctx = { lastStartAt: 0, uhd: true, sustainedKbps: 200000 };
    // Three windows at 30 Mb/s: not yet.
    expect(aq.onDelivery(t + 9_000, ladder, at4k, aq.delivery(inStall([30000, 30000, 30000]), t + 9_000, ctx, t, 60000), 60000)).toBeNull();
    // Five: 60 Mb/s at 30 can't play; the 1080p file carries 10 × 1.3.
    const d = aq.delivery(inStall([30000, 30000, 30000, 30000, 30000]), t + 15_000, ctx, t, 60000);
    expect(d.kbps).toBe(30000);
    expect(aq.onDelivery(t + 15_000, ladder, at4k, d, 60000)?.step.key).toBe(ladder[1].key);
  });

  it('an unproven line: three windows decide', () => {
    const aq = new AutoQuality(0);
    const ctx = { lastStartAt: 0, uhd: true, sustainedKbps: 70000 };
    expect(aq.onDelivery(t + 9_000, ladder, at4k, aq.delivery(inStall([30000, 30000, 30000]), t + 9_000, ctx, t, 60000), 60000)?.step.key).toBe(ladder[1].key);
  });

  it('the server refilling flat out in the stall is no reason to leave 4K', () => {
    const aq = new AutoQuality(0);
    const ctx = { lastStartAt: 0, uhd: true, sustainedKbps: 70000 };
    expect(aq.onDelivery(t + 9_000, ladder, at4k, aq.delivery(inStall([40000, 150000, 160000]), t + 9_000, ctx, t, 60000), 60000)).toBeNull();
  });
});
