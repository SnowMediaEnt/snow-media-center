// Automatic quality around the viewer's jumps (the owner, 1.9.7: "when you
// start it from the beginning it plays just fine, but if you try to do
// anything else, pause it and come back or fast forward or rewind it, then
// everything just fucks up"). On his TV every seek showed as a 4-5 s gap
// and more before the next frame, against a limited server (1.5-14 Mb/s for
// 15-16 Mb/s files). SEEK_GRACE_MS was 5 s from the press, so the rest of
// that rebuffer was judged as the server too slow for the film: a drop, a
// starved verdict, the card blaming the server. Now a jump (a seek, an
// unpause, a resume) is graced until playback picks up again and for the
// half minute after, measured from that pick-up, as a start is.
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, JUMP_PENDING_MAX_MS, MIN_CHANGE_GAP_MS, RATE_TICK_MS, START_GRACE_MS, afterJump, buildQualityLadder,
  deliveredKbps, inJumpGrace, jumpGraceEnd, jumpPending, type RateReport, type StallContext,
} from './plexAutoQuality';

const S = 1000;
const MIN = 60 * S;
// The owner's film: one 16 Mb/s file.
const NEED = 16000;
const film = buildQualityLadder([], NEED);

/** The player's windows while stalled, every 3 s from `from`, at `kbps`. */
const stalledWindows = (from: number, kbps: number[], stalled = true): RateReport[] =>
  kbps.map((k, i) => ({ t: from + (i + 1) * RATE_TICK_MS, kbps: k, ...(stalled ? { stalled: true } : {}) }));

describe('a jump is graced until playback picks up again (jumpPending, afterJump)', () => {
  const started = 1 * MIN;
  const seek = 20 * MIN;

  it('pending from the press until the next start, at most JUMP_PENDING_MAX_MS', () => {
    expect(jumpPending(seek + 6 * S, seek, started)).toBe(true);
    expect(jumpPending(seek + JUMP_PENDING_MAX_MS - 1, seek, started)).toBe(true);
    expect(jumpPending(seek + JUMP_PENDING_MAX_MS, seek, started)).toBe(false);
    // Played on at +8 s: no longer pending.
    expect(jumpPending(seek + 9 * S, seek, seek + 8 * S)).toBe(false);
    expect(jumpPending(seek - 1, seek, started)).toBe(false);
  });

  it("the grace: while pending, then START_GRACE_MS from when it played on — not from the press", () => {
    const resumed = seek + 8 * S;
    expect(afterJump(seek + 7 * S, seek, started)).toBe(true);
    expect(afterJump(resumed + START_GRACE_MS - 1, seek, resumed)).toBe(true);
    expect(afterJump(resumed + START_GRACE_MS, seek, resumed)).toBe(false);
    expect(jumpGraceEnd(seek + 7 * S, seek, started)).toBe(seek + JUMP_PENDING_MAX_MS);
    expect(jumpGraceEnd(resumed + 1, seek, resumed)).toBe(resumed + START_GRACE_MS);
    // No jump, or a start long after it: nothing.
    expect(jumpGraceEnd(seek, 0, started)).toBe(0);
    expect(jumpGraceEnd(seek + 5 * MIN, seek, seek + 3 * MIN)).toBe(0);
  });

  it('inJumpGrace takes the pending jump in: the 5 s from the press is no longer all there is', () => {
    expect(inJumpGrace(seek + 6 * S, seek, started)).toBe(false);
    expect(inJumpGrace(seek + 6 * S, seek, started, seek)).toBe(true);
  });
});

describe('a seek on a file played as it is, the server slow to start there (the TV: 4-5 s and more)', () => {
  const started = 1 * MIN;
  const seek = 20 * MIN;
  // 12 s of rebuffer at 1.5 Mb/s, past SEEK_GRACE_MS.
  const rates = stalledWindows(seek, [1500, 1500, 1500, 1500]);
  const now = seek + 12 * S;

  it('before: the rebuffer past 5 s was read as the server too slow, and dropped the film', () => {
    const aq = new AutoQuality(0);
    const old: StallContext = { lastStartAt: started, lastSeekAt: seek, direct: true };
    const d = aq.delivery(rates, now, old, seek, NEED);
    expect(d.kbps).toBe(1500);
    expect(aq.onDelivery(now, film, 0, d, NEED)?.direction).toBe('down');
  });

  it('now: no stall counted, no delivery verdict, no drop, while it has not played on', () => {
    const aq = new AutoQuality(0);
    const ctx: StallContext = { lastStartAt: started, lastSeekAt: seek, lastJumpAt: seek, direct: true };
    expect(aq.onStall(seek + 1, film, 0, ctx)).toBeNull();
    expect(aq.stallsWithin(seek + 1)).toBe(0);
    const d = aq.delivery(rates, now, ctx, seek, NEED);
    expect(d.kbps).toBeNull();
    expect(d.early).toBeFalsy();
    expect(aq.onDelivery(now, film, 0, d, NEED)).toBeNull();
  });

  it('played on, then a stall inside the half minute after: still the jump (no drop, no starved verdict)', () => {
    const aq = new AutoQuality(0);
    const resumed = seek + 14 * S;
    const ctx: StallContext = { lastStartAt: resumed, lastSeekAt: seek, lastJumpAt: seek, direct: true };
    const again = resumed + 8 * S;
    const r = [...rates, ...stalledWindows(again, [1500, 1500, 1500])];
    expect(aq.onStall(again, film, 0, ctx)).toBeNull();
    const d = aq.delivery(r, again + 9 * S, ctx, again, NEED);
    expect(d.kbps).toBeNull();
    expect(d.early).toBeFalsy();
    expect(aq.onDelivery(again + 9 * S, film, 0, d, NEED)).toBeNull();
  });

  it('after that grace, a server really too slow for the film is still dropped (the rule stands)', () => {
    const aq = new AutoQuality(0);
    const resumed = seek + 14 * S;
    const ctx: StallContext = { lastStartAt: resumed, lastSeekAt: seek, lastJumpAt: seek, direct: true };
    const late = resumed + START_GRACE_MS + 10 * S;
    const r = stalledWindows(late, [4000, 4000, 4000]);
    const d = aq.delivery(r, late + 9 * S, ctx, late, NEED);
    expect(d.kbps).toBe(4000);
    const m = aq.onDelivery(late + 9 * S, film, 0, d, NEED);
    expect(m?.reason).toBe('delivery');
    expect(m?.direction).toBe('down');
  });

  it('a jump that never plays on is judged like any stall once JUMP_PENDING_MAX_MS is over', () => {
    const ctx = { lastStartAt: started, lastSeekAt: seek, lastJumpAt: seek };
    const late = seek + JUMP_PENDING_MAX_MS;
    const r = stalledWindows(late, [1500, 1500, 1500]);
    expect(deliveredKbps(r, late + 9 * S, ctx).kbps).toBe(1500);
  });
});

describe('a start from the beginning is unchanged', () => {
  it('a file starved on its first stall still steps down at once (no jump)', () => {
    const began = 5 * MIN;
    const r = stalledWindows(began + 2 * S, [1500, 1500]);
    const d = deliveredKbps(r, began + 9 * S, { lastStartAt: began, needKbps: NEED, direct: true });
    expect(d.early).toBe(true);
    expect(d.kbps).toBe(1500);
  });

  it('a resume (a start part-way in, a jump) is not starved inside its grace', () => {
    const load = 5 * MIN;
    const began = load + 12 * S;
    const r = stalledWindows(began + 6 * S, [1500, 1500]);
    const d = deliveredKbps(r, began + 13 * S, { lastStartAt: began, lastSeekAt: load, lastJumpAt: load, needKbps: NEED, direct: true });
    expect(d.early).toBeFalsy();
    expect(d.kbps).toBeNull();
  });
});

describe('playing on after a pause is a jump too', () => {
  it('the rebuffer after an unpause (the connection the server closed) is no evidence', () => {
    const aq = new AutoQuality(0);
    const started = 1 * MIN;
    const unpaused = 30 * MIN;
    const ctx: StallContext = { lastStartAt: started, lastSeekAt: unpaused, lastJumpAt: unpaused, direct: true };
    const r = stalledWindows(unpaused, [800, 800, 800, 800]);
    expect(aq.onStall(unpaused + 1, film, 0, ctx)).toBeNull();
    expect(aq.delivery(r, unpaused + 12 * S, ctx, unpaused, NEED).kbps).toBeNull();
  });
});

describe('no ping-pong: nothing is raised under a jump still settling', () => {
  // A conversion at 720p · 3 Mbps that the speed would raise.
  const ladder = buildQualityLadder([], 12000);
  const at = ladder.findIndex((s) => s.key === '720-3');

  it('no raise while a jump is pending or in the half minute after it played on; then as before', () => {
    const aq = new AutoQuality(0);
    const t = 10 * MIN;
    expect(t).toBeGreaterThan(MIN_CHANGE_GAP_MS);
    const pending: StallContext = { lastStartAt: 1 * MIN, lastSeekAt: t - 2 * S, lastJumpAt: t - 2 * S };
    expect(aq.maybeRaise(t, ladder, at, 0, 50000, pending)).toBeNull();
    expect(aq.raiseWindowOpen(t, pending)).toBe(false);
    const settling: StallContext = { lastStartAt: t - 10 * S, lastSeekAt: t - 15 * S, lastJumpAt: t - 15 * S };
    expect(aq.maybeRaise(t, ladder, at, 0, 50000, settling)).toBeNull();
    const settled: StallContext = { lastStartAt: t - START_GRACE_MS, lastSeekAt: t - START_GRACE_MS - 5 * S, lastJumpAt: t - START_GRACE_MS - 5 * S };
    expect(aq.maybeRaise(t, ladder, at, 0, 50000, settled)?.direction).toBe('up');
  });
});

describe("the card's preview during a jump's stall", () => {
  it('never "lowers now" on a jump: not soon, not starved', () => {
    const aq = new AutoQuality(0);
    const seek = 20 * MIN;
    const p = aq.preview(film, 0, {
      lastStartAt: 1 * MIN, lastSeekAt: seek, lastJumpAt: seek, direct: true,
      stallKbps: 1500, needKbps: NEED, stallAt: seek + 1,
    }, seek + 10 * S);
    expect(p.soon).toBe(false);
  });
});
