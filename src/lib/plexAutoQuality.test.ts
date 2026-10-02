import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaVersions } from './plex';
import {
  AutoQuality, autoQualityNote, buildQualityLadder, convertRecoveryStep, deliveredKbps, dropTarget, fileAlternative, floorPresetFor,
  freshConvertRecovery, ladderIndex, lighterConversion, lighterFile, lineClearFor, needKbps, raiseTarget, stallEvidence, steadyKbps,
  stepName, stopPlexTranscode, stopPlexTranscodeAndWait, sustainedKbps, transcodeStopUrl,
  CONVERT_RECOVERY_MAX, CONVERT_RECOVERY_RESET_MS, MIN_CHANGE_GAP_MS, RAISE_BACKOFF_MS, RAISE_SUSTAIN_MS, RATE_TICK_MS, RELAY_PRESET, STOP_WAIT_MS,
  type RateReport,
} from './plexAutoQuality';

const MIN = 60_000;

// An episode like the owner's (a single ~6 Mb/s 1080p file).
const episode = buildQualityLadder([], 6000);
// A film with a 4K and a 1080p file.
const filmVersions = mediaVersions({
  Media: [
    { videoResolution: '4k', bitrate: 48000, Part: [{ key: '/p/4k' }] },
    { videoResolution: '1080', bitrate: 12000, Part: [{ key: '/p/1080' }] },
  ],
}, '7');
const film = buildQualityLadder(filmVersions);
// The customer's film: one 12 Mb/s file (original, 1080p · 8, 720p · 4, 720p · 3).
const film12 = buildQualityLadder([], 12000);

/** Windows taken while stalled, every 3 s from `from`. */
const stalled = (from: number, kbps: number[]): RateReport[] => kbps.map((k, i) => ({ t: from + (i + 1) * RATE_TICK_MS, kbps: k, stalled: true }));
/** Windows taken while playing (topping up), every 3 s from `from`. */
const playing = (from: number, kbps: number[]): RateReport[] => kbps.map((k, i) => ({ t: from + (i + 1) * RATE_TICK_MS, kbps: k }));

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the quality ladder', () => {
  it('a 6 Mb/s episode: the file, then only presets that are really smaller, down to the floor', () => {
    expect(episode.map((s) => s.key)).toEqual(['original', '720-4', '720-3']);
  });

  it('a film with two files: 4K, the 1080p file as it is, then converted steps', () => {
    expect(film.map((s) => s.key)).toEqual(['original@7:0', 'original@7:1', '1080-8', '720-4', '720-3']);
  });

  it('with no bitrate known, from 1080p · 8 Mbps down', () => {
    expect(buildQualityLadder([], undefined).map((s) => s.key)).toEqual(['original', '1080-8', '720-4', '720-3']);
  });

  it('finds where playback is, including a preset the viewer picked off the ladder', () => {
    expect(ladderIndex(film, 'original', '7:1')).toBe(1);
    expect(ladderIndex(episode, '720-4')).toBe(1);
    // 1080p · 20 Mbps on a 6 Mb/s file sits above 720p · 4 Mbps.
    expect(dropTarget(episode, ladderIndex(episode, '1080-20'), null)?.key).toBe('720-4');
    // Below the floor there is nothing to do.
    expect(ladderIndex(episode, '480-2')).toBe(-1);
  });

  it('what a stream needs: the smaller of the cap and the source file', () => {
    // A 12 Mb/s file "converted to 1080p · 20 Mbps" still arrives at 12.
    expect(needKbps(20000, 12000)).toBe(12000);
    expect(needKbps(8000, 12000)).toBe(8000);
    expect(needKbps(undefined, 12000)).toBe(12000);
    expect(needKbps(8000, undefined)).toBe(8000);
    expect(needKbps(undefined, undefined)).toBeUndefined();
  });
});

describe('where a drop goes', () => {
  it('straight to the step the rate carries with headroom, lighter files first', () => {
    // 4K film, 5 Mb/s delivered: 720p · 3 Mbps (3 × 1.3 ≤ 5), not the 1080p file.
    expect(dropTarget(film, 0, 5000)?.key).toBe('720-3');
    // 16 Mb/s: the 1080p file as it is (12 × 1.3 ≤ 16), ahead of any conversion.
    expect(dropTarget(film, 0, 16000)?.key).toBe('original@7:1');
  });

  it('takes at least one step, and never goes below the floor', () => {
    expect(dropTarget(film, 0, 200000)?.key).toBe('original@7:1');
    expect(dropTarget(episode, 0, 500)?.key).toBe('720-3');
    expect(dropTarget(episode, 2, 500)).toBeNull();
  });

  it('one step when the rate is unknown', () => {
    expect(dropTarget(episode, 0, null)?.key).toBe('720-4');
  });

  it('a lighter file: the best one the rate carries, else the lightest; none for a single file', () => {
    expect(lighterFile(film, 0, 16000)?.key).toBe('original@7:1');
    expect(lighterFile(film, 0, 5000)?.key).toBe('original@7:1');
    expect(lighterFile(film, 0)?.key).toBe('original@7:1');
    expect(lighterFile(film, 1, 100000)).toBeNull();
    expect(lighterFile(episode, 0, 100000)).toBeNull();
  });

  it('reads the steady speed as the median of the reports that saw data', () => {
    const now = 1_000_000;
    const rates = [
      { t: now - 70_000, kbps: 20000 }, // too old
      { t: now - 50_000, kbps: 5000 },
      { t: now - 40_000, kbps: 0 }, // buffer full: says nothing
      { t: now - 30_000, kbps: 600 },
      { t: now - 20_000, kbps: 4000 },
    ];
    expect(steadyKbps(rates, now, 60_000)).toBe(4000);
    expect(steadyKbps([{ t: now, kbps: 3000 }], now, 60_000)).toBeNull();
  });
});

describe('one measurement: what the server delivers', () => {
  const now = 1_000_000;

  it('delivered over the stalls: the mean of the windows taken while stalled, three of them at least', () => {
    const stall = now - 30_000;
    // Topping up before the stall never counts, only the windows inside it.
    const rates = [...playing(stall - 60_000, [9000, 9000, 9000, 9000]), ...stalled(stall, [4000, 6000, 5000])];
    expect(deliveredKbps(rates, now)).toEqual({ kbps: 5000, windows: 3, paused: false });
    expect(deliveredKbps(rates.slice(0, -1), now)).toEqual({ kbps: null, windows: 2, paused: false });
  });

  it('two shorter stalls within two minutes add up; stalls older than that do not', () => {
    const a = now - 100_000;
    const b = now - 20_000;
    const rates = [...stalled(a, [4000, 4000]), ...stalled(b, [7000])];
    expect(deliveredKbps(rates, now)).toEqual({ kbps: 5000, windows: 3, paused: false });
    const old = [...stalled(now - 150_000, [4000, 4000]), ...stalled(b, [7000])];
    expect(deliveredKbps(old, now).kbps).toBeNull();
  });

  it('a stall in which nothing arrives is a pause: no verdict, whatever came before', () => {
    const earlier = now - 60_000;
    const stall = now - 8_000;
    const rates = [...stalled(earlier, [4000, 4000, 4000]), { t: stall + 1_000, kbps: 2000, stalled: true }, { t: stall + 4_000, kbps: 0, stalled: true }];
    expect(deliveredKbps(rates, now, { stallStart: stall })).toEqual({ kbps: null, windows: 4, paused: true });
    // Quiet since a tick into the stall: a pause too.
    const quiet = [...stalled(earlier, [4000, 4000, 4000]), { t: stall - 7_000, kbps: 0 }];
    expect(deliveredKbps(quiet, now, { stallStart: stall }).paused).toBe(true);
    // The same windows, judged apart from the paused stall: evidence as before.
    expect(deliveredKbps(rates, now).kbps).toBe(3500);
  });

  it('the first half minute after a start or a seek, and anything before the last change, never counts', () => {
    const stall = now - 30_000;
    const rates = stalled(stall, [4000, 4000, 4000]);
    expect(deliveredKbps(rates, now, { lastStartAt: stall - 1_000 }).kbps).toBeNull();
    // A seek 2 s before the first window: that window is the seek's, the rest count.
    const seek = deliveredKbps(stalled(stall, [4000, 4000, 4000, 4000]), now, { lastSeekAt: stall + 1_000 });
    expect(seek).toEqual({ kbps: 4000, windows: 3, paused: false });
    expect(deliveredKbps(rates, now, { since: now - 5_000 }).kbps).toBeNull();
  });

  it('a proven line takes a longer look: five windows instead of three', () => {
    const stall = now - 30_000;
    const rates = stalled(stall, [30000, 30000, 30000]);
    expect(deliveredKbps(rates, now, { proven: true })).toEqual({ kbps: null, windows: 3, paused: false });
    expect(deliveredKbps([...rates, ...stalled(stall + 9_000, [30000, 30000])], now, { proven: true }).kbps).toBe(30000);
  });

  it('a sustained rate: the best mean over five consecutive windows with data; a pause breaks the run', () => {
    expect(sustainedKbps(playing(0, [80000, 90000, 100000, 90000, 80000, 20000]), now)).toBe(88000);
    expect(sustainedKbps(playing(0, [80000, 90000, 100000, 90000]), now)).toBeNull();
    expect(sustainedKbps(playing(0, [80000, 90000, 0, 100000, 90000, 80000, 20000]), now)).toBeNull();
    expect(sustainedKbps([], now)).toBeNull();
  });

  it('a proven line: sustained twice what the stream needs, off the relay, and not short right now', () => {
    expect(lineClearFor(21600, { sustainedKbps: 84000 })).toBe(true);
    expect(lineClearFor(21600, { sustainedKbps: 40000 })).toBe(false);
    expect(lineClearFor(21600, { sustainedKbps: 84000, relay: true })).toBe(false);
    expect(lineClearFor(21600, { sustainedKbps: 84000, shortKbps: 9000 })).toBe(false);
    expect(lineClearFor(undefined, { sustainedKbps: 84000 })).toBe(false);
  });

  it("the card's figure for a stall: the mean inside it, two windows at least, never a pause", () => {
    const stallStart = now - 7_000;
    const topUp = playing(stallStart - 30_000, [15000, 15000, 15000, 15000]);
    expect(stallEvidence(topUp, stallStart, now)).toEqual({ kbps: null, quietMs: 0, paused: false });
    const slow = [...topUp, { t: stallStart + 1_000, kbps: 11000 }, { t: stallStart + 4_000, kbps: 11500 }];
    expect(stallEvidence(slow, stallStart, now)).toEqual({ kbps: 11250, quietMs: 0, paused: false });
    const pause = [...topUp, { t: stallStart + 1_000, kbps: 10000 }, { t: stallStart + 4_000, kbps: 0 }];
    const ev = stallEvidence(pause, stallStart, now);
    expect(ev.paused).toBe(true);
    expect(ev.kbps).toBeNull();
    expect(ev.quietMs).toBe(now - (stallStart + 1_000));
    // A 0 from before the stall is not "no data" until a report was due inside it.
    const idle = [...playing(now - 12_000, [15000, 15000]), { t: now - 4_000, kbps: 0 }];
    expect(stallEvidence(idle, now - 2_000, now)).toEqual({ kbps: null, quietMs: 0, paused: false });
    expect(stallEvidence(idle, now - RATE_TICK_MS, now)).toEqual({ kbps: null, quietMs: RATE_TICK_MS, paused: true });
  });
});

describe('the one down rule', () => {
  const t0 = 10 * MIN;

  it('delivered under 0.8x what the stream needs: to the best rung that rate carries', () => {
    const aq = new AutoQuality(0);
    // The customer's 12 Mb/s file at 4-6 Mb/s: 720p · 3 Mbps (3 × 1.3 ≤ 5; 720p · 4 needs 5.2).
    const d = aq.delivery(stalled(t0, [4000, 6000, 5000]), t0 + 12_000);
    expect(d.kbps).toBe(5000);
    const move = aq.onDelivery(t0 + 12_000, film12, 0, d, 12000);
    expect(move).toEqual({ step: film12.find((s) => s.key === '720-3'), direction: 'down', reason: 'delivery' });
    // A shade more carries 720p · 4 Mbps.
    const up = new AutoQuality(0);
    expect(up.onDelivery(t0, film12, 0, up.delivery(stalled(t0 - 12_000, [5500, 5500, 5500]), t0), 12000)?.step.key).toBe('720-4');
  });

  it('delivered 0.8x or more of what it needs: no drop, whatever the stalls', () => {
    const aq = new AutoQuality(0);
    expect(aq.onDelivery(t0, film12, 0, aq.delivery(stalled(t0 - 12_000, [10000, 9500, 10500]), t0), 12000)).toBeNull();
    // Refilled flat out: no drop.
    expect(aq.onDelivery(t0, film12, 0, aq.delivery(stalled(t0 - 12_000, [9000, 30000, 42000]), t0), 12000)).toBeNull();
  });

  it('a pause, too little evidence, or no need known: no drop', () => {
    const aq = new AutoQuality(0);
    expect(aq.onDelivery(t0, film12, 0, { kbps: null, windows: 4, paused: true }, 12000)).toBeNull();
    expect(aq.onDelivery(t0, film12, 0, { kbps: null, windows: 2, paused: false }, 12000)).toBeNull();
    expect(aq.onDelivery(t0, film12, 0, { kbps: 3000, windows: 3, paused: false }, undefined)).toBeNull();
  });

  it('a conversion is judged against what it needs: the smaller of its cap and the source', () => {
    const aq = new AutoQuality(0);
    const at = ladderIndex(film12, '1080-8');
    // 1080p · 8 Mbps of a 12 Mb/s file at 5 Mb/s: too little (needs 8).
    expect(aq.onDelivery(t0, film12, at, { kbps: 5000, windows: 3, paused: false }, needKbps(8000, 12000))?.step.key).toBe('720-3');
    // At 7: enough (0.8 × 8 = 6.4).
    expect(new AutoQuality(0).onDelivery(t0, film12, at, { kbps: 7000, windows: 3, paused: false }, needKbps(8000, 12000))).toBeNull();
  });

  it('after a delivery drop, the way back up waits ten minutes, then needs the measured speed', () => {
    const aq = new AutoQuality(0);
    const move = aq.onDelivery(t0, film12, 0, { kbps: 5000, windows: 3, paused: false }, 12000)!;
    aq.applied(move, t0);
    const at = film12.findIndex((s) => s.key === '720-3');
    expect(aq.maybeRaise(t0 + 3 * MIN, film12, at, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(t0 + RAISE_BACKOFF_MS + 1000, film12, at, 0, 5000)).toBeNull();
    expect(aq.maybeRaise(t0 + RAISE_BACKOFF_MS + 1000, film12, at, 0, 50000)?.step.key).toBe('720-4');
  });

  it('judged since the last change: the new stream stands on its own', () => {
    const aq = new AutoQuality(0);
    const first = aq.onDelivery(t0, film12, 0, aq.delivery(stalled(t0 - 12_000, [4000, 4000, 4000]), t0), 12000)!;
    aq.applied(first, t0);
    // The same old windows: nothing for the new stream yet.
    expect(aq.delivery(stalled(t0 - 12_000, [4000, 4000, 4000]), t0 + 5_000).kbps).toBeNull();
  });
});

describe('stalls on their own', () => {
  it('three within five minutes move a film to its lighter file; seeks and the start never count', () => {
    const t0 = 10 * MIN;
    const aq = new AutoQuality(t0);
    const ctx = { lastStartAt: t0 - MIN, lastSeekAt: t0 + 2 * MIN };
    expect(aq.onStall(t0 + 1 * MIN, film, 0, ctx)).toBeNull();
    // A seek at +2 min, its refill 1 s later: not a stall.
    expect(aq.onStall(t0 + 2 * MIN + 1000, film, 0, ctx)).toBeNull();
    expect(aq.onStall(t0 + 3 * MIN, film, 0, ctx)).toBeNull();
    const move = aq.onStall(t0 + 4 * MIN, film, 0, ctx);
    expect(move?.direction).toBe('down');
    expect(move?.reason).toBe('stalls');
    expect(move?.step.key).toBe('original@7:1');
  });

  it('never into a conversion: a single-file title keeps its file on stalls alone', () => {
    const aq = new AutoQuality(0);
    expect(aq.onStall(1 * MIN, episode, 0)).toBeNull();
    expect(aq.onStall(2 * MIN, episode, 0)).toBeNull();
    expect(aq.onStall(3 * MIN, episode, 0)).toBeNull();
    expect(aq.stallsWithin(3 * MIN)).toBe(3);
    // Nor a conversion to a lighter one.
    const conv = new AutoQuality(0);
    const at = ladderIndex(episode, '720-4');
    for (let i = 1; i <= 4; i += 1) expect(conv.onStall(i * MIN, episode, at)).toBeNull();
  });

  it('stalls spread over more than five minutes do not add up', () => {
    const aq = new AutoQuality(0);
    expect(aq.onStall(0, film, 0)).toBeNull();
    expect(aq.onStall(3 * MIN, film, 0)).toBeNull();
    expect(aq.onStall(6 * MIN, film, 0)).toBeNull();
    expect(aq.stallsWithin(6 * MIN)).toBe(2);
    expect(aq.onStall(7 * MIN, film, 0)?.step.key).toBe('original@7:1');
  });

  it('counts afresh after a change', () => {
    const aq = new AutoQuality(0);
    aq.onStall(1 * MIN, film, 0);
    aq.onStall(2 * MIN, film, 0);
    const move = aq.onStall(3 * MIN, film, 0)!;
    aq.applied(move, 3 * MIN);
    expect(aq.stallsWithin(3 * MIN)).toBe(0);
    expect(aq.onStall(4 * MIN, film, 1)).toBeNull();
  });
});

describe('stepping back up', () => {
  it('raises one step once the speed has held above the next step for a while', () => {
    const aq = new AutoQuality(0);
    const down = aq.onDelivery(1 * MIN, film, 0, { kbps: 5000, windows: 3, paused: false }, 48000)!;
    expect(down.step.key).toBe('720-3');
    aq.applied(down, 1 * MIN);
    const idx = ladderIndex(film, '720-3');
    // Too soon after the change, then the backoff a delivery drop sets.
    expect(aq.maybeRaise(1 * MIN + 30_000, film, idx, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(1 * MIN + MIN_CHANGE_GAP_MS, film, idx, 0, 50000)).toBeNull();
    // Later, speed carries 720p · 4 Mbps with headroom: one step only.
    const up = aq.maybeRaise(1 * MIN + RAISE_BACKOFF_MS + 1, film, idx, 0, 50000);
    expect(up?.direction).toBe('up');
    expect(up?.step.key).toBe('720-4');
  });

  it('not while the speed is short of the step above', () => {
    const aq = new AutoQuality(0);
    const at = 10 * MIN;
    // 720-4 needs 4 × 1.3 = 5.2 Mb/s.
    expect(aq.maybeRaise(at, episode, 2, 0, 5000)).toBeNull();
    expect(aq.maybeRaise(at, episode, 2, 0, 5300)?.step.key).toBe('720-4');
  });

  it('never above what the viewer started with', () => {
    // Started on the 1080p file (index 1): the 4K one is off limits.
    expect(raiseTarget(film, 1, 1, 500000)).toBeNull();
    expect(raiseTarget(film, 2, 1, 500000)?.key).toBe('original@7:1');
  });

  it('not within a minute and a half of a stall', () => {
    const aq = new AutoQuality(0);
    aq.onStall(10 * MIN, episode, 2);
    expect(aq.maybeRaise(10 * MIN + 60_000, episode, 2, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(10 * MIN + RAISE_SUSTAIN_MS, episode, 2, 0, 50000)?.step.key).toBe('720-4');
  });
});

describe('no flapping', () => {
  it('a raise that stalls soon after goes straight back and raising waits', () => {
    const aq = new AutoQuality(0);
    const up = aq.maybeRaise(10 * MIN, episode, 2, 0, 50000)!;
    expect(up.step.key).toBe('720-4');
    aq.applied(up, 10 * MIN);
    // One stall a minute later undoes it at once.
    const back = aq.onStall(11 * MIN, episode, 1);
    expect(back?.reason).toBe('undo-raise');
    expect(back?.step.key).toBe('720-3');
    aq.applied(back!, 11 * MIN);
    // Speed looks great again, but raising is on hold for ten minutes...
    expect(aq.maybeRaise(15 * MIN, episode, 2, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(20 * MIN, episode, 2, 0, 50000)).toBeNull();
    // ...then it may try once more.
    const again = aq.maybeRaise(21 * MIN + 1, episode, 2, 0, 50000)!;
    expect(again.step.key).toBe('720-4');
    aq.applied(again, 21 * MIN + 1);
    // Undone again: the wait doubles.
    aq.applied(aq.onStall(22 * MIN, episode, 1)!, 22 * MIN);
    expect(aq.maybeRaise(35 * MIN, episode, 2, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(42 * MIN + 1, episode, 2, 0, 50000)?.step.key).toBe('720-4');
  });

  it('a raise on a proven line is not undone by a stall', () => {
    const aq = new AutoQuality(0);
    const up = aq.maybeRaise(10 * MIN, episode, 2, 0, 50000)!;
    aq.applied(up, 10 * MIN);
    // The server has delivered 720p · 4 Mbps's 4 Mb/s twice over, sustained.
    expect(aq.onStall(11 * MIN, episode, 1, { sustainedKbps: 9000 })).toBeNull();
    // And raising is not on hold.
    expect(aq.maybeRaise(13 * MIN + 1, episode, 1, 0, 50000)?.step.key).toBe('original');
  });

  it('never two changes within two minutes, whatever the speed does', () => {
    const aq = new AutoQuality(0);
    aq.onStall(3 * MIN, film, 0);
    aq.onStall(4 * MIN, film, 0);
    const down = aq.onStall(5 * MIN, film, 0)!;
    aq.applied(down, 5 * MIN);
    for (let t = 5 * MIN; t < 5 * MIN + MIN_CHANGE_GAP_MS; t += 15_000) {
      expect(aq.maybeRaise(t, film, 1, 0, 900000)).toBeNull();
    }
  });
});

describe("the viewer's pick: a ceiling for that title, not an off switch", () => {
  it('still lowers below the pick when the server delivers too little', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-4', 1 * MIN);
    const at = ladderIndex(episode, '720-4');
    expect(aq.onDelivery(2 * MIN, episode, at, { kbps: 2000, windows: 3, paused: false }, 4000)?.step.key).toBe('720-3');
  });

  it('raises back up to the pick, never above it', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-4', 0);
    const ceiling = aq.ceiling(episode, 0);
    expect(ceiling).toBe(1);
    // From 720-3 back to the pick...
    expect(aq.maybeRaise(30 * MIN, episode, 2, ceiling, 90000)?.step.key).toBe('720-4');
    // ...and no further, whatever the speed.
    expect(aq.maybeRaise(30 * MIN, episode, 1, ceiling, 900000)).toBeNull();
  });

  it('a pick off the ladder caps just above the step below it', () => {
    const aq = new AutoQuality(0);
    // 1080p · 20 Mbps on a 6 Mb/s episode sits between the file and 720p · 4.
    aq.viewerPicked('1080-20', 0);
    expect(aq.ceiling(episode, 0)).toBe(0.5);
    expect(aq.maybeRaise(30 * MIN, episode, 1, aq.ceiling(episode, 0), 90000)).toBeNull();
  });

  it('Original is no limit at all', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-4', 0);
    aq.viewerPicked('original', 1 * MIN);
    expect(aq.manualKey()).toBeNull();
    expect(aq.ceiling(episode, 0)).toBe(0);
    aq.viewerPicked(`original@${filmVersions[1].id}`, 2 * MIN);
    expect(aq.manualKey()).toBeNull();
  });

  it('applies to that title only: the next title starts with none', () => {
    const first = new AutoQuality(0);
    first.viewerPicked('720-3', 0);
    const next = new AutoQuality(10 * MIN);
    expect(next.manualKey()).toBeNull();
    expect(next.ceiling(episode, 0)).toBe(0);
  });

  it('a pick under the floor leaves automatic quality nothing to do', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('480-2', 0);
    const at = ladderIndex(episode, '480-2');
    expect(at).toBe(-1);
    expect(aq.preview(episode, at)).toEqual({ next: null, manualKey: '480-2' });
    expect(aq.maybeRaise(30 * MIN, episode, at, aq.ceiling(episode, 0), 900000)).toBeNull();
  });

  it('counts afresh after the pick, and waits before raising', () => {
    const aq = new AutoQuality(0);
    aq.onStall(1 * MIN, film, 0);
    aq.onStall(2 * MIN, film, 0);
    aq.viewerPicked('720-4', 2 * MIN + 1000);
    expect(aq.stallsWithin(2 * MIN + 1000)).toBe(0);
    expect(aq.maybeRaise(3 * MIN, film, 3, 1, 90000)).toBeNull();
  });
});

describe('the Plex Relay', () => {
  it('floors at the relay-sized preset', () => {
    expect(floorPresetFor('relay')).toBe(RELAY_PRESET);
    expect(floorPresetFor('direct')).toBe('720-3');
    expect(floorPresetFor(undefined)).toBe('720-3');
    const relay = buildQualityLadder([], 10000, floorPresetFor('relay'));
    expect(relay.map((st) => st.key)).toEqual(['original', '720-4', '720-3', '480-2']);
    // Playing at the relay preset: nothing lower.
    expect(dropTarget(relay, ladderIndex(relay, RELAY_PRESET), 1500)).toBeNull();
    // From the original on a 1.8 Mb/s relay: straight to it.
    expect(dropTarget(relay, 0, 1800)?.key).toBe('480-2');
  });
});

describe('a conversion that fails: one machine per title', () => {
  it('a fresh session once, the file, a lighter conversion, then a message; never the same thing twice', () => {
    const r = freshConvertRecovery();
    expect(convertRecoveryStep(r, 1_000, false)).toBe('fresh');
    expect(convertRecoveryStep(r, 2_000, false)).toBe('file');
    expect(convertRecoveryStep(r, 3_000, false)).toBe('lighter');
    expect(convertRecoveryStep(r, 4_000, false)).toBe('give-up');
    expect(convertRecoveryStep(r, 5_000, false)).toBe('give-up');
    expect(r.total).toBe(3);
  });

  it('audio forced the conversion: the file is no way out', () => {
    const r = freshConvertRecovery();
    expect(convertRecoveryStep(r, 1_000, false, { files: false })).toBe('fresh');
    expect(convertRecoveryStep(r, 2_000, false, { files: false })).toBe('lighter');
    expect(convertRecoveryStep(r, 3_000, false, { files: false })).toBe('give-up');
  });

  it('a session that played a good while starts a new outage (fresh first again), within the cap', () => {
    const r = freshConvertRecovery();
    let t = 0;
    const steps: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      t += CONVERT_RECOVERY_RESET_MS + 1;
      steps.push(convertRecoveryStep(r, t, true));
    }
    expect(steps.filter((s) => s !== 'give-up')).toHaveLength(CONVERT_RECOVERY_MAX);
    expect(steps.filter((s) => s === 'fresh')).toHaveLength(CONVERT_RECOVERY_MAX);
    expect(steps[steps.length - 1]).toBe('give-up');
    // Played only briefly: no reset.
    const q = freshConvertRecovery();
    convertRecoveryStep(q, 1_000, true);
    expect(convertRecoveryStep(q, 2_000, true)).toBe('file');
  });

  it('the file to play instead: the best the server has been seen to carry, else the lightest; none without files', () => {
    expect(fileAlternative(film, 20000)?.key).toBe('original@7:1');
    expect(fileAlternative(film, 100000)?.key).toBe('original@7:0');
    expect(fileAlternative(film, null)?.key).toBe('original@7:1');
    expect(fileAlternative(episode, 1000)?.key).toBe('original');
    expect(fileAlternative(film.filter((s) => s.presetKey !== 'original'), 20000)).toBeNull();
  });

  it('a lighter conversion: the next one down that has not failed, sized to the rate when known', () => {
    const at = film12.findIndex((s) => s.key === '720-4');
    expect(lighterConversion(film12, at, '720-4', { measuredKbps: 5000 })?.key).toBe('720-3');
    expect(lighterConversion(film12, at, '720-4', {})?.key).toBe('720-3');
    const floor = film12.findIndex((s) => s.key === '720-3');
    expect(lighterConversion(film12, floor, '720-3', { measuredKbps: 5000 })).toBeNull();
    expect(lighterConversion(film12, 1, '1080-8', { measuredKbps: 9000, failed: ['720-4'] })?.key).toBe('720-3');
    // Never a file: that is the machine's own step.
    expect(lighterConversion(film, 0, 'original', { measuredKbps: 100000 })?.presetKey).not.toBe('original');
  });

  it('what failed is not tried again on this title, by automatic quality either', () => {
    const aq = new AutoQuality(0, ['720-4']);
    expect(aq.usable(episode).map((st) => st.key)).toEqual(['original', '720-3']);
    const relay = buildQualityLadder([], 10000, RELAY_PRESET);
    aq.conversionsRefused(relay);
    expect(aq.usable(relay).map((st) => st.key)).toEqual(['original']);
    expect(aq.preview(aq.usable(relay), 0).next).toBeNull();
    // Kept for a replay of the title.
    expect(new AutoQuality(0, aq.failedKeys()).usable(relay).map((st) => st.key)).toEqual(['original']);
  });
});

describe("the buffering card's line on automatic quality", () => {
  const at = (key: string) => ladderIndex(episode, key);
  const note = (aq: AutoQuality, key: string, ctx = {}) => autoQualityNote(episode, at(key), aq.preview(episode, at(key), ctx));

  it('a single file: lowers only when the server delivers too little, and says so when it does', () => {
    const aq = new AutoQuality(0);
    expect(note(aq, 'original')).toBe('Auto quality: lowers only if the Plex server delivers less than this needs');
    expect(note(aq, 'original', { shortKbps: 4000 })).toBe('Auto quality: lowering to 720p · 3 Mbps — the Plex server is only delivering 4.0 Mb/s');
    aq.viewerPicked('720-4', 0);
    expect(note(aq, '720-4')).toBe('Auto quality: lowers only if the Plex server delivers less than this needs');
  });

  it('a film with a lighter file: will lower to it if it keeps stalling; not off a proven 4K line', () => {
    const aq = new AutoQuality(0);
    expect(autoQualityNote(film, 0, aq.preview(film, 0))).toBe('Auto quality: will lower to 1080p if it keeps stalling');
    expect(autoQualityNote(film, 0, aq.preview(film, 0, { uhd: true, sustainedKbps: 200000 }))).toBe('Auto quality: keeps the original — the Plex server has sent it fast enough');
  });

  it('at the floor with no pick: at its lowest step', () => {
    expect(note(new AutoQuality(0), '720-3')).toBe('Auto quality: already at its lowest step');
  });

  it('off for this title only when playback is at the pick (or the pick is under the floor)', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-3', 0);
    expect(note(aq, '720-3')).toBe('Auto quality off for this title (you picked 720p · 3 Mbps)');
    aq.viewerPicked('480-2', 0);
    expect(note(aq, '480-2')).toBe('Auto quality off for this title (you picked 480p · 2 Mbps)');
  });

  it('at the floor below the pick: its lowest step, and back up to the pick when the speed allows', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-4', 0);
    expect(note(aq, '720-3')).toBe('Auto quality: at its lowest step (goes back up to 720p · 4 Mbps when the speed allows)');
    aq.viewerPicked('1080-20', 0);
    expect(note(aq, '720-3')).toBe('Auto quality: at its lowest step (goes back up to 720p · 4 Mbps when the speed allows)');
    expect(aq.maybeRaise(30 * MIN, episode, at('720-3'), aq.ceiling(episode, 0), 90000)?.step.key).toBe('720-4');
  });
});

describe('names', () => {
  it('what a step is called in a message', () => {
    expect(stepName(episode[0])).toBe('original quality');
    expect(stepName(film[1])).toBe('1080p');
    expect(stepName(episode[1])).toBe('720p · 4 Mbps');
  });
});

describe('ending a converting session', () => {
  const start = 'https://1-2-3-4.abc.plex.direct:32400/video/:/transcode/universal/start.m3u8?path=%2Flibrary%2Fmetadata%2F7&protocol=hls'
    + '&session=smcabc123&X-Plex-Session-Identifier=smcabc123&mediaIndex=0&X-Plex-Client-Identifier=smc-client&X-Plex-Token=tok%2B1&maxVideoBitrate=4000';

  it('stops the session the start URL opened, with the same client and token', () => {
    const stop = transcodeStopUrl(start);
    expect(stop).toBe('https://1-2-3-4.abc.plex.direct:32400/video/:/transcode/universal/stop?session=smcabc123&X-Plex-Client-Identifier=smc-client&X-Plex-Token=tok%2B1');
  });

  it('nothing for a file played as it is', () => {
    expect(transcodeStopUrl('https://srv/library/parts/7/file.mkv?X-Plex-Token=t')).toBeNull();
    expect(transcodeStopUrl(null)).toBeNull();
    expect(transcodeStopUrl('https://srv/video/:/transcode/universal/start.m3u8?path=x')).toBeNull();
  });

  it('fire and forget: one quiet request, never a throw, never a log', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => stopPlexTranscode(start)).not.toThrow();
      stopPlexTranscode('https://srv/library/parts/7/file.mkv?X-Plex-Token=t');
      await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toContain('/video/:/transcode/universal/stop?session=smcabc123');
      expect(init.mode).toBe('no-cors');
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore(); warn.mockRestore(); error.mockRestore();
    }
  });

  it('stopped and waited for: resolves once the server answers, or at the cap', async () => {
    let answer: (() => void) | null = null;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { answer = () => resolve(new Response('')); }));
    vi.stubGlobal('fetch', fetchMock);
    let done = false;
    const p = stopPlexTranscodeAndWait(start).then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 5));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    answer!();
    await p;
    expect(done).toBe(true);
    // A server that never answers: on after the cap.
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    let capped = false;
    const q = stopPlexTranscodeAndWait(start).then(() => { capped = true; });
    await vi.advanceTimersByTimeAsync(STOP_WAIT_MS + 1);
    await q;
    expect(capped).toBe(true);
    // Not a session: nothing to wait for.
    await stopPlexTranscodeAndWait('https://srv/library/parts/7/file.mkv?X-Plex-Token=t');
  });
});
