// The one down rule, on the cases that shaped it. A customer's box: the
// quick internet check read 42.5 Mb/s, the player got 4-6 Mb/s of a 12 Mb/s
// file from the Plex server, and the card said "keeps the original — your
// internet is fast enough" while it buffered for good. The owner's box: a
// line the server fills at 84 Mb/s average (peaks ~300) for a 21.6 Mb/s
// file, which must never be left. And a server that pauses: no bytes is a
// pause, never a drop.
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, DELIVERY_FACTOR, PROVEN_WINDOWS, RATE_TICK_MS, START_GRACE_MS, autoQualityNote, buildQualityLadder, ladderIndex,
  sustainedKbps, type RateReport, type StallContext,
} from './plexAutoQuality';

const S = 1000;
const MIN = 60 * S;
// The customer's film: one 12 Mb/s file. Its ladder: the file, then
// 1080p · 8, 720p · 4, 720p · 3 (the floor).
const film = buildQualityLadder([], 12000);
// The owner's film: one 21.6 Mb/s file.
const owner = buildQualityLadder([], 21600);

/**
 * A wall clock for one title: `arrival(t)` says what the server delivers in
 * each 3 s window (0 = nothing); playback alternates `play` s of playing on
 * what it got and `stall` s of stalling while the stream needs more than
 * arrives (a rung the arrival carries with headroom plays smoothly). Runs
 * the rules the way PlexSection does: onStall at each stall's start, the
 * delivery rule every window while stalled, the raise check every 15 s
 * while playing. Returns every move made, in order.
 */
function run(opts: {
  ladder: ReturnType<typeof buildQualityLadder>; need: (index: number) => number; arrival: (t: number) => number;
  seconds: number; play?: number; stall?: number; ctx?: StallContext;
}) {
  const aq = new AutoQuality(0);
  const began = 5 * S;
  const rates: RateReport[] = [];
  const moves: Array<{ t: number; key: string; reason: string }> = [];
  let index = 0;
  let sustained: number | null = null;
  let stalled = false;
  let phaseEnd = began + (opts.play ?? 5) * S;
  let lastRaiseCheck = 0;
  const ctx = (): StallContext => ({ lastStartAt: began, lastSeekAt: 0, sustainedKbps: sustained, ...opts.ctx });
  for (let t = began; t < began + opts.seconds * S; t += RATE_TICK_MS) {
    const kbps = opts.arrival(t);
    rates.push(stalled ? { t, kbps, stalled: true } : { t, kbps });
    const s = sustainedKbps(rates, t);
    if (s != null && s > (sustained ?? 0)) sustained = s;
    const need = opts.need(index);
    // A rung whose need the arrival covers on average (the buffer smooths
    // the windows out) plays smoothly.
    const recent = rates.slice(-5).map((r) => r.kbps);
    const smooth = kbps > 0 && recent.reduce((a, b) => a + b, 0) / recent.length >= need * 1.05;
    if (!smooth && t >= phaseEnd) {
      stalled = !stalled;
      phaseEnd = t + (stalled ? (opts.stall ?? 10) : (opts.play ?? 5)) * S;
      if (stalled) {
        const m = aq.onStall(t, opts.ladder, index, ctx());
        if (m) { aq.applied(m, t); moves.push({ t, key: m.step.key, reason: m.reason }); index = ladderIndex(opts.ladder, m.step.key, m.step.versionId); stalled = false; continue; }
      }
    }
    if (smooth) stalled = false;
    if (stalled) {
      const d = aq.delivery(rates, t, ctx(), t, need);
      const m = aq.onDelivery(t, opts.ladder, index, d, need);
      if (m) { aq.applied(m, t); moves.push({ t, key: m.step.key, reason: m.reason }); index = ladderIndex(opts.ladder, m.step.key, m.step.versionId); stalled = false; }
    } else if (t - lastRaiseCheck >= 15 * S) {
      lastRaiseCheck = t;
      const window = rates.filter((r) => t - r.t <= 90 * S && r.kbps > 0).map((r) => r.kbps).sort((a, b) => a - b);
      const steady = window.length >= 2 ? window[Math.floor(window.length / 2)] : null;
      const m = aq.maybeRaise(t, opts.ladder, index, 0, steady);
      if (m) { aq.applied(m, t); moves.push({ t, key: m.step.key, reason: m.reason }); index = ladderIndex(opts.ladder, m.step.key, m.step.versionId); }
    }
  }
  return { moves, aq, index, sustained, began };
}

describe("the customer's box: a 12 Mb/s file, 4-6 Mb/s arriving", () => {
  // What the server delivers, window by window: 4.1, 5.7, 4.4, 5.2, 6.0, 4.8 Mb/s.
  const arrival = (t: number) => [4100, 5700, 4400, 5200, 6000, 4800][Math.floor(t / RATE_TICK_MS) % 6];

  it('settles within a minute of the start grace on a quality that rate carries, and stays there: no oscillation', () => {
    const { moves, began, index } = run({ ladder: film, need: (i) => film[i].kbps ?? 12000, arrival, seconds: 15 * 60 });
    expect(moves[0].reason).toBe('delivery');
    // 5 Mb/s on average: 720p · 3 Mbps (3 × 1.3 ≤ 5), or 720p · 4 when the
    // windows it judged ran a shade higher. Never the 8 Mbps rung (8 × 1.3).
    expect(['720-3', '720-4']).toContain(moves[0].key);
    expect(moves[0].t - began).toBeLessThan(START_GRACE_MS + 60 * S);
    // Fifteen minutes on at 4-6 Mb/s: one step back up to 720p · 4 at most
    // (which that rate carries), never to what it can't, and never down again.
    expect(moves.length).toBeLessThanOrEqual(2);
    expect(moves.slice(1).every((m) => m.reason === 'speed' && m.key === '720-4')).toBe(true);
    expect(['720-3', '720-4']).toContain(film[index].key);
  });

  it('is what the card says, not "your internet is fast enough"', () => {
    const aq = new AutoQuality(0);
    const t = 10 * MIN;
    const rates: RateReport[] = [1, 2, 3].map((i) => ({ t: t + i * RATE_TICK_MS, kbps: [4100, 5700, 4400][i - 1], stalled: true }));
    const d = aq.delivery(rates, t + 12 * S, { lastStartAt: 0 }, undefined, 12000);
    const short = d.kbps != null && d.kbps < 12000 * DELIVERY_FACTOR ? d.kbps : null;
    expect(short).toBe(4733);
    const note = autoQualityNote(film, 0, aq.preview(film, 0, { shortKbps: short }));
    expect(note).toBe('Auto quality: lowering to 720p · 3 Mbps — the Plex server is only delivering 4.7 Mb/s');
    expect(note).not.toMatch(/fast enough/);
  });
});

describe("the owner's box: a fast line never leaves the original", () => {
  // The start fills flat out at 84 Mb/s (peaks 300); once the buffer is
  // full the player tops up at the file's own 21.6; the server has the odd
  // slow spell in which it still sends 15-20 Mb/s.
  const arrival = (t: number) => {
    const w = Math.floor(t / RATE_TICK_MS);
    if (w < 8) return [84000, 300000, 90000, 84000, 84000, 60000, 84000, 84000][w];
    return w % 40 < 3 ? [15000, 20000, 18000][w % 40] : 21600;
  };

  it('three stalls in five minutes, a 9 s slow spell of the server: stays on the file', () => {
    const { moves, sustained } = run({ ladder: owner, need: () => 21600, arrival, seconds: 20 * 60, play: 50, stall: 9 });
    expect(sustained).toBeGreaterThanOrEqual(21600 * 2);
    expect(moves).toEqual([]);
  });

  it('the card says so', () => {
    const rates: RateReport[] = Array.from({ length: PROVEN_WINDOWS }, (_, i) => ({ t: (i + 1) * RATE_TICK_MS, kbps: 84000 }));
    const aq = new AutoQuality(0);
    const p = aq.preview(owner, 0, { sustainedKbps: sustainedKbps(rates, 20 * S) });
    expect(p.keepsFile).toBe(true);
    expect(autoQualityNote(owner, 0, p)).toBe('Auto quality: keeps the original — the Plex server has sent it fast enough');
  });

  it('a 4K file on such a line keeps 4K on stalls alone; one on a slower line goes to the 1080p file', () => {
    const versions = [
      { id: 'a', ratingKey: '1', mediaIndex: 0, label: '4K', bitrateKbps: 60000, partKey: '/p/a', height: 2160 },
      { id: 'b', ratingKey: '1', mediaIndex: 1, label: '1080p', bitrateKbps: 10000, partKey: '/p/b', height: 1080 },
    ];
    const ladder = buildQualityLadder(versions as never);
    const stallsAt = [MIN, 2 * MIN, 3 * MIN];
    const proven = new AutoQuality(0);
    expect(stallsAt.map((t) => proven.onStall(t, ladder, 0, { uhd: true, sustainedKbps: 200000 }))).toEqual([null, null, null]);
    const slow = new AutoQuality(0);
    expect(stallsAt.map((t) => slow.onStall(t, ladder, 0, { uhd: true, sustainedKbps: 70000 })).pop()?.step.key).toBe('original@b');
  });

  it('a line that really is too slow still lowers, proven or not: a longer look, then the drop', () => {
    const aq = new AutoQuality(0);
    const t = 10 * MIN;
    const ctx = { lastStartAt: 0, sustainedKbps: 200000 };
    const windows = (n: number): RateReport[] => Array.from({ length: n }, (_, i) => ({ t: t + (i + 1) * RATE_TICK_MS, kbps: 8000, stalled: true }));
    // Three windows at 8 Mb/s: not yet, on a proven line.
    expect(aq.onDelivery(t + 9 * S, owner, 0, aq.delivery(windows(3), t + 9 * S, ctx, t, 21600), 21600)).toBeNull();
    // Five: a 21.6 Mb/s file at 8 can't play; to what 8 carries.
    expect(aq.onDelivery(t + 15 * S, owner, 0, aq.delivery(windows(5), t + 15 * S, ctx, t, 21600), 21600)?.step.key).toBe('720-4');
  });
});

describe('a server that pauses: no bytes is a pause, never a drop', () => {
  it('stalls where nothing arrives, however many, never lower the file', () => {
    // Topping up at the file's rate, then the server pauses in every stall.
    const arrival = (t: number) => (Math.floor(t / RATE_TICK_MS) % 5 === 0 ? 0 : 12000);
    const { moves } = run({ ladder: film, need: () => 12000, arrival, seconds: 10 * 60, play: 10, stall: 6 });
    expect(moves).toEqual([]);
  });

  it('nor does a 0 window count towards delivery once data flows again', () => {
    const aq = new AutoQuality(0);
    const t = 10 * MIN;
    const rates: RateReport[] = [
      { t: t + 3 * S, kbps: 0, stalled: true }, { t: t + 6 * S, kbps: 11000, stalled: true }, { t: t + 9 * S, kbps: 11500, stalled: true }, { t: t + 12 * S, kbps: 12000, stalled: true },
    ];
    // Judged on the stall under way: its 0 window makes it a pause.
    expect(aq.delivery(rates, t + 12 * S, { lastStartAt: 0 }, t, 12000)).toEqual({ kbps: null, windows: 3, paused: true });
    // A later stall judges the windows with data; healthy here.
    const d = aq.delivery(rates, t + 40 * S, { lastStartAt: 0 }, t + 30 * S, 12000);
    expect(d.kbps).toBe(11500);
    expect(aq.onDelivery(t + 40 * S, film, 0, d, 12000)).toBeNull();
  });
});
