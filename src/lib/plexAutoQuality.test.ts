import { afterEach, describe, expect, it, vi } from 'vitest';
import { mediaVersions } from './plex';
import {
  AutoQuality, StallCounter, autoQualityNote, buildQualityLadder, dropSizeKbps, dropTarget, floorPresetFor, ladderIndex,
  raiseTarget, stallBudgetKbps, stallEvidence, steadyKbps, stepName, stopPlexTranscode, transcodeStopUrl,
  MIN_CHANGE_GAP_MS, RAISE_SUSTAIN_MS, RATE_TICK_MS, RELAY_PRESET,
} from './plexAutoQuality';
import { autoDropPreset } from './plexStallVerdict';

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

afterEach(() => { vi.unstubAllGlobals(); });

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
});

describe('dropping to the steady speed', () => {
  it('drops straight to the step the steady speed carries, not one at a time', () => {
    // 4K film, speed steady around 5 Mb/s: 720p · 3 Mbps (3 × 1.3 ≤ 5), not the 1080p file.
    expect(dropTarget(film, 0, 5000)?.key).toBe('720-3');
    // Around 16 Mb/s: the 1080p file as it is (12 × 1.3 ≤ 16).
    expect(dropTarget(film, 0, 16000)?.key).toBe('original@7:1');
  });

  it('takes at least one step, and never goes below the floor', () => {
    expect(dropTarget(film, 0, 200000)?.key).toBe('original@7:1');
    expect(dropTarget(episode, 0, 500)?.key).toBe('720-3');
    expect(dropTarget(episode, 2, 500)).toBeNull();
  });

  it('one step when the speed is unknown', () => {
    expect(dropTarget(episode, 0, null)?.key).toBe('720-4');
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
    expect(stallBudgetKbps({ hostKbps: 9000, streamKbps: 4000, probeKbps: 50000 })).toBe(4000);
    expect(stallBudgetKbps({ hostKbps: null, streamKbps: null, probeKbps: null })).toBeNull();
  });

  it("sizes a drop by the player's own rate from the server first, the internet check last", () => {
    const none = { hostKbps: null, streamKbps: null, probeKbps: null };
    expect(stallBudgetKbps({ hostKbps: 9000, streamKbps: 4000, probeKbps: 50000 }, 7000)).toBe(7000);
    expect(stallBudgetKbps({ ...none, probeKbps: 50000 }, null)).toBe(50000);
    expect(stallBudgetKbps({ ...none, probeKbps: 50000 })).toBe(50000);
  });
});

describe("the server's rate: what sizes a drop, and what proves one", () => {
  const now = 1_000_000;
  // A 20 Mb/s remux.
  const FILE = 20000;
  // Playing smoothly, the player tops its buffer up: its downloads follow
  // the video (here 0.75 of the file's average), not the line.
  const topUp = (until: number) => Array.from({ length: 20 }, (_, i) => ({ t: until - (20 - i) * RATE_TICK_MS, kbps: FILE * 0.75 }));

  it('sizes a drop by the highest of the steady rate, the rate in the stall and a fresh read', () => {
    const rates = [...topUp(now - 6_000), { t: now - 3_000, kbps: 30000 }, { t: now, kbps: 31000 }];
    // The steady median alone is the top-up rate...
    expect(dropSizeKbps(rates, now)).toBe(FILE * 0.75);
    // ...the stall's own windows (from its start) raise it.
    expect(dropSizeKbps(rates, now, { stallStart: now - 6_000 })).toBe(31000);
    expect(dropSizeKbps(topUp(now), now)).toBe(FILE * 0.75);
    expect(dropSizeKbps(topUp(now), now, { readKbps: 45000 })).toBe(45000);
    expect(dropSizeKbps([], now)).toBeNull();
  });

  it('the steady rate before a stall is never evidence', () => {
    const stallStart = now - 6_000;
    // Topping up at 0.75 of the file, then the stall: no window of it in yet.
    const ev = stallEvidence(topUp(stallStart), stallStart, now);
    expect(ev.kbps).toBeNull();
    expect(autoDropPreset(FILE, { serverKbps: ev.kbps })).toBeNull();
  });

  it('top-up at 0.75x the file, then a pause-stall: nothing arrived, so no drop', () => {
    const stallStart = now - 9_000;
    // One window straddling the stall's start, then nothing: the plugin
    // reports the empty window once, as 0, and then stays quiet.
    const rates = [...topUp(stallStart), { t: stallStart + 1_000, kbps: FILE * 0.5 }, { t: stallStart + 4_000, kbps: 0 }];
    const ev = stallEvidence(rates, stallStart, now);
    expect(ev.paused).toBe(true);
    expect(ev.kbps).toBeNull();
    expect(ev.quietMs).toBe(now - (stallStart + 1_000));
    // A fresh read does not turn a pause into a slow line either.
    expect(stallEvidence(rates, stallStart, now, 9000).kbps).toBeNull();
    expect(autoDropPreset(FILE, { serverKbps: ev.kbps })).toBeNull();
  });

  it('quiet since before the stall is a pause too, counted from the stall', () => {
    const stallStart = now - 5_000;
    // The buffer was full (0 once, then quiet) and nothing came when it ran out.
    const rates = [...topUp(stallStart - 10_000), { t: stallStart - 7_000, kbps: 0 }];
    const ev = stallEvidence(rates, stallStart, now);
    expect(ev).toEqual({ kbps: null, quietMs: 5_000, paused: true });
  });

  it('an old 0 from before the stall is not "no data" until a report was due inside it', () => {
    // The buffer was full (0 once, then quiet); the stall began 2 s ago and
    // its first window may yet bring data.
    const rates = [...topUp(now - 12_000), { t: now - 4_000, kbps: 0 }];
    expect(stallEvidence(rates, now - 2_000, now)).toEqual({ kbps: null, quietMs: 0, paused: false });
    // A tick into the stall and still nothing: counted from its start.
    expect(stallEvidence(rates, now - RATE_TICK_MS, now)).toEqual({ kbps: null, quietMs: RATE_TICK_MS, paused: true });
    // A 0 inside the stall still marks it paused (no early drop), but "no
    // data" waits for the tick all the same.
    const inside = [...topUp(now - 3_000), { t: now - 1_500, kbps: 0 }];
    expect(stallEvidence(inside, now - 2_000, now)).toEqual({ kbps: null, quietMs: 0, paused: true });
  });

  it('a line too slow for the file: every window of the stall says so', () => {
    const stallStart = now - 7_000;
    const rates = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: stallStart - (10 - i) * RATE_TICK_MS, kbps: 11000 })),
      { t: stallStart + 1_000, kbps: 11000 }, { t: stallStart + 4_000, kbps: 11500 },
    ];
    const ev = stallEvidence(rates, stallStart, now);
    expect(ev).toEqual({ kbps: 11500, quietMs: 0, paused: false });
    expect(autoDropPreset(FILE, { serverKbps: ev.kbps })?.key).toBe('1080-8');
  });

  it('a line that keeps up refills flat out: the best window clears it', () => {
    const stallStart = now - 7_000;
    const rates = [...topUp(stallStart), { t: stallStart + 1_000, kbps: 9000 }, { t: stallStart + 4_000, kbps: 84000 }];
    const ev = stallEvidence(rates, stallStart, now);
    expect(ev.kbps).toBe(84000);
    expect(autoDropPreset(FILE, { serverKbps: ev.kbps })).toBeNull();
  });

  it('one window is not enough on its own; with a fresh read of the file it is', () => {
    const stallStart = now - 2_000;
    const rates = [...topUp(stallStart), { t: stallStart + 1_000, kbps: 8000 }];
    expect(stallEvidence(rates, stallStart, now).kbps).toBeNull();
    expect(stallEvidence(rates, stallStart, now, 9000).kbps).toBe(9000);
    // A fast read clears a slow-looking window.
    expect(stallEvidence(rates, stallStart, now, 80000).kbps).toBe(80000);
  });

  it('no reports at all (an app without them): a fresh read is the only evidence', () => {
    expect(stallEvidence([], now - 8_000, now)).toEqual({ kbps: null, quietMs: 0, paused: false });
    expect(stallEvidence([], now - 8_000, now, 12000).kbps).toBe(12000);
  });
});

describe('stalls', () => {
  it('three stalls within five minutes drop the quality; seeks do not count', () => {
    const t0 = 10 * MIN;
    const aq = new AutoQuality(t0);
    expect(aq.onStall(t0 + 1 * MIN, 0, episode, 0, 4000)).toBeNull();
    // A seek at +2 min, its refill 1 s later: not a stall.
    expect(aq.onStall(t0 + 2 * MIN + 1000, t0 + 2 * MIN, episode, 0, 4000)).toBeNull();
    expect(aq.onStall(t0 + 3 * MIN, t0 + 2 * MIN, episode, 0, 4000)).toBeNull();
    const move = aq.onStall(t0 + 4 * MIN, t0 + 2 * MIN, episode, 0, 4000);
    expect(move?.direction).toBe('down');
    expect(move?.step.key).toBe('720-3');
  });

  it('stalls spread over more than five minutes do not', () => {
    const c = new StallCounter();
    expect(c.record(0)).toBe(false);
    expect(c.record(3 * MIN)).toBe(false);
    expect(c.record(6 * MIN)).toBe(false);
    expect(c.record(7 * MIN)).toBe(true);
  });

  it('counts afresh after a change', () => {
    const aq = new AutoQuality(0);
    aq.onStall(1 * MIN, 0, episode, 0, null);
    aq.onStall(2 * MIN, 0, episode, 0, null);
    const move = aq.onStall(3 * MIN, 0, episode, 0, null)!;
    expect(move.step.key).toBe('720-4');
    aq.applied(move, 3 * MIN);
    expect(aq.onStall(4 * MIN, 0, episode, 1, null)).toBeNull();
    expect(aq.onStall(5 * MIN, 0, episode, 1, null)).toBeNull();
    expect(aq.onStall(6 * MIN, 0, episode, 1, null)?.step.key).toBe('720-3');
  });
});

describe('stepping back up', () => {
  it('raises one step once the speed has held above the next step for a while', () => {
    const aq = new AutoQuality(0);
    const down = aq.onSlowFile(film, 0, 5000)!;
    expect(down.step.key).toBe('720-3');
    aq.applied(down, 1 * MIN);
    const idx = ladderIndex(film, '720-3');
    // Too soon after the change.
    expect(aq.maybeRaise(1 * MIN + 30_000, film, idx, 0, 50000)).toBeNull();
    // Later, speed carries 720p · 4 Mbps with headroom: one step only.
    const up = aq.maybeRaise(1 * MIN + MIN_CHANGE_GAP_MS, film, idx, 0, 50000);
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
    aq.onStall(10 * MIN, 0, episode, 2, null);
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
    const back = aq.onStall(11 * MIN, 0, episode, 1, 50000);
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
    aq.applied(aq.onStall(22 * MIN, 0, episode, 1, null)!, 22 * MIN);
    expect(aq.maybeRaise(35 * MIN, episode, 2, 0, 50000)).toBeNull();
    expect(aq.maybeRaise(42 * MIN + 1, episode, 2, 0, 50000)?.step.key).toBe('720-4');
  });

  it('never two changes within two minutes, whatever the speed does', () => {
    const aq = new AutoQuality(0);
    const down = aq.onSlowFile(episode, 0, 3500)!;
    aq.applied(down, 5 * MIN);
    for (let t = 5 * MIN; t < 5 * MIN + MIN_CHANGE_GAP_MS; t += 15_000) {
      expect(aq.maybeRaise(t, episode, 2, 0, 90000)).toBeNull();
    }
  });

});

describe("the viewer's pick: a ceiling for that title, not an off switch", () => {
  it('still lowers below the pick on repeated stalls', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('720-4', 1 * MIN);
    const at = ladderIndex(episode, '720-4');
    aq.onStall(2 * MIN, 0, episode, at, 2000);
    aq.onStall(3 * MIN, 0, episode, at, 2000);
    expect(aq.onStall(4 * MIN, 0, episode, at, 2000)?.step.key).toBe('720-3');
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
    next.onStall(11 * MIN, 0, episode, 0, 2000);
    next.onStall(12 * MIN, 0, episode, 0, 2000);
    expect(next.onStall(13 * MIN, 0, episode, 0, 2000)?.direction).toBe('down');
  });

  it('a pick under the floor leaves automatic quality nothing to do', () => {
    const aq = new AutoQuality(0);
    aq.viewerPicked('480-2', 0);
    const at = ladderIndex(episode, '480-2');
    expect(at).toBe(-1);
    expect(aq.preview(episode, at, 1000)).toEqual({ next: null, manualKey: '480-2' });
    expect(aq.maybeRaise(30 * MIN, episode, at, aq.ceiling(episode, 0), 900000)).toBeNull();
  });

  it('counts afresh after the pick, and waits before raising', () => {
    const aq = new AutoQuality(0);
    aq.onStall(1 * MIN, 0, episode, 0, null);
    aq.onStall(2 * MIN, 0, episode, 0, null);
    aq.viewerPicked('720-4', 2 * MIN + 1000);
    expect(aq.onStall(3 * MIN, 0, episode, 1, null)).toBeNull();
    expect(aq.maybeRaise(3 * MIN, episode, 2, 1, 90000)).toBeNull();
  });
});

describe('no more eager than three stalls in five minutes', () => {
  it('a second stall does not drop, whatever the rate', () => {
    const aq = new AutoQuality(0);
    // A 6 Mb/s file, the steady rate a shade under it (topping up).
    expect(aq.onStall(1 * MIN, 0, episode, 0, 5900)).toBeNull();
    expect(aq.onStall(2 * MIN, 0, episode, 0, 2000)).toBeNull();
  });

  it('long stalls alone do not drop: only how many, within five minutes', () => {
    const aq = new AutoQuality(0);
    expect(aq.onStall(1 * MIN, 0, episode, 0, null)).toBeNull();
    // Twenty seconds later, a second (the first was long): still no.
    expect(aq.onStall(1 * MIN + 20_000, 0, episode, 0, null)).toBeNull();
    // Stalls more than five minutes apart never add up.
    expect(aq.onStall(7 * MIN, 0, episode, 0, null)).toBeNull();
    expect(aq.onStall(9 * MIN, 0, episode, 0, null)).toBeNull();
    expect(aq.onStall(10 * MIN, 0, episode, 0, null)?.reason).toBe('stalls');
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

describe('a conversion automatic quality asked for is slow to start', () => {
  it('a lighter file as it is first, remembering the conversion as failed', () => {
    const aq = new AutoQuality(0);
    const at = ladderIndex(film, '1080-8');
    // Dropped from the 4K file (48 Mb/s) on a ~14 Mb/s line.
    const r = aq.onSlowStart(film, at, '1080-8', { fromKbps: 48000, speedKbps: 14000 });
    expect(r).not.toBe('wait');
    expect(r && r !== 'wait' ? r.step.key : null).toBe('original@7:1');
    expect(r && r !== 'wait' ? r.reason : null).toBe('slow-start');
    expect(aq.failedKeys()).toEqual(['1080-8']);
    expect(aq.usable(film).map((st) => st.key)).toEqual(['original@7:0', 'original@7:1', '720-4', '720-3']);
  });

  it('then one more wait, then the next converted step down; never the file that stalled', () => {
    const aq = new AutoQuality(0);
    // A single 6 Mb/s file: no lighter file to fall back to.
    const at = ladderIndex(episode, '720-4');
    expect(aq.onSlowStart(episode, at, '720-4', { fromKbps: 6000, speedKbps: 5000 })).toBe('wait');
    const next = aq.onSlowStart(episode, at, '720-4', { fromKbps: 6000, speedKbps: 5000 });
    expect(next && next !== 'wait' ? next.step.key : null).toBe('720-3');
    // That one is slow too: a wait, then nothing left (the panel shows).
    const low = ladderIndex(aq.usable(episode), '720-3');
    expect(aq.onSlowStart(aq.usable(episode), low, '720-3', { fromKbps: 4000 })).toBe('wait');
    expect(aq.onSlowStart(aq.usable(episode), low, '720-3', { fromKbps: 4000 })).toBeNull();
    expect(aq.failedKeys().sort()).toEqual(['720-3', '720-4']);
  });

  it('a lighter file that the line cannot carry is not tried; on the relay no file is', () => {
    const slow = new AutoQuality(0);
    expect(slow.onSlowStart(film, ladderIndex(film, '720-3'), '720-3', { fromKbps: 48000, speedKbps: 5000 })).toBe('wait');
    const relay = new AutoQuality(0);
    expect(relay.onSlowStart(film, ladderIndex(film, '720-3'), '720-3', { fromKbps: 48000, files: false })).toBe('wait');
  });

  it('a replay of the title keeps what failed', () => {
    const aq = new AutoQuality(0, ['720-4']);
    expect(aq.usable(episode).map((st) => st.key)).toEqual(['original', '720-3']);
  });

  it('a server that refuses to convert leaves only the files as they are', () => {
    const relay = buildQualityLadder([], 10000, RELAY_PRESET);
    const aq = new AutoQuality(0);
    aq.conversionsRefused(relay);
    expect(aq.usable(relay).map((st) => st.key)).toEqual(['original']);
    expect(aq.preview(aq.usable(relay), 0, 1500).next).toBeNull();
    // Kept for a replay of the title.
    expect(new AutoQuality(0, aq.failedKeys()).usable(relay).map((st) => st.key)).toEqual(['original']);
  });
});

describe("the buffering card's line on automatic quality", () => {
  // The episode: Original, 720p · 4 Mbps, 720p · 3 Mbps (the floor).
  const at = (key: string) => ladderIndex(episode, key);
  const note = (aq: AutoQuality, key: string) => autoQualityNote(episode, at(key), aq.preview(episode, at(key), null));

  it('what a drop would go to, while there is something lower', () => {
    const aq = new AutoQuality(0);
    expect(note(aq, 'original')).toBe('Auto quality: will lower to 720p · 4 Mbps if it keeps stalling');
    aq.viewerPicked('720-4', 0);
    expect(note(aq, '720-4')).toBe('Auto quality: will lower to 720p · 3 Mbps if it keeps stalling');
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
    // Lowered from the pick to the floor by stalls.
    expect(note(aq, '720-3')).toBe('Auto quality: at its lowest step (goes back up to 720p · 4 Mbps when the speed allows)');
    // A pick off the ladder: back up to the step just under it, as raising does.
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
});
