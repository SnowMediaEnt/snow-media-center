import { afterEach, describe, expect, it } from 'vitest';
import { mediaVersions } from './plex';
import {
  AutoQuality, StallCounter, _resetManualQuality, buildQualityLadder, dropTarget, ladderIndex, markManualQuality,
  raiseTarget, stallBudgetKbps, steadyKbps, MIN_CHANGE_GAP_MS, RAISE_SUSTAIN_MS,
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

afterEach(() => { _resetManualQuality(); });

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

  it('leaves the quality alone once the viewer picked one in the menu', () => {
    const aq = new AutoQuality(0);
    markManualQuality();
    aq.onStall(1 * MIN, 0, episode, 0, 1000);
    aq.onStall(2 * MIN, 0, episode, 0, 1000);
    expect(aq.onStall(3 * MIN, 0, episode, 0, 1000)).toBeNull();
    expect(aq.onSlowFile(episode, 0, 1000)).toBeNull();
    expect(aq.maybeRaise(30 * MIN, episode, 2, 0, 90000)).toBeNull();
  });
});
