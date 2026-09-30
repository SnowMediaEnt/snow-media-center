// Automatic quality follows what the Plex server actually delivers, not the
// quick internet check. A customer's box (VPN off): the quick check read
// 42.5 Mb/s, the player got 1.4-5.7 Mb/s from the Plex server, the file needs
// 12 Mb/s, and the card said "keeps the original — your internet is fast
// enough for it" while it buffered for good. And (VPN on) a conversion the
// server answered with an HTTP error status was loaded again and again as
// it was: the recovery below never repeats the identical session.
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, CONVERT_RECOVERY_MAX, CONVERT_RECOVERY_RESET_MS, RAISE_BACKOFF_MS, RATE_TICK_MS, START_GRACE_MS,
  autoQualityNote, buildQualityLadder, convertAlternative, convertRecoveryStep, freshConvertRecovery, lineClearFor,
  starvedKbps, type RateReport,
} from './plexAutoQuality';

const S = 1000;
const MIN = 60 * S;
// The customer's film: one 12 Mb/s file. Its ladder: the file, then
// 1080p · 8, 720p · 4, 720p · 3 (the floor).
const film = buildQualityLadder([], 12000);
const QUICK = 42500;

/** Stalls from `t0`, each `len` long with a report every 3 s inside it at
 *  the given rates, and a gap of `gap` between them. */
function stallsWith(t0: number, kbps: number[][], len = 9 * S, gap = 20 * S): { rates: RateReport[]; stalls: number[]; end: number } {
  const rates: RateReport[] = [];
  const stalls: number[] = [];
  let t = t0;
  for (const inStall of kbps) {
    stalls.push(t);
    inStall.forEach((k, i) => rates.push({ t: t + (i + 1) * RATE_TICK_MS, kbps: k, stalled: true }));
    t += len;
    // Between stalls it plays on what came in, topping up at what arrives.
    rates.push({ t: t + gap / 2, kbps: inStall[inStall.length - 1] });
    t += gap;
  }
  return { rates, stalls, end: t };
}

describe('starving: what the Plex server delivers, over the last stalls', () => {
  const t0 = 10 * MIN;
  const opts = (stalls: number[]) => ({ since: 0, stalls, lastStartAt: t0 - START_GRACE_MS - S });

  it('quick check 42.5, delivered 1.4-5.7, need 12: starving, at the best rate it got', () => {
    const { rates, stalls, end } = stallsWith(t0, [[1400, 5700, 3000], [2000, 4100, 1400]]);
    expect(starvedKbps(rates, end, 12000, opts(stalls))).toBe(5700);
  });

  it('delivered healthy (the server refills flat out): not starving', () => {
    const { rates, stalls, end } = stallsWith(t0, [[9000, 30000, 42000], [28000, 35000, 40000]]);
    expect(starvedKbps(rates, end, 12000, opts(stalls))).toBeNull();
  });

  it('one stall is not a sustained window', () => {
    const { rates, stalls, end } = stallsWith(t0, [[1400, 5700, 3000]]);
    expect(starvedKbps(rates, end, 12000, opts(stalls))).toBeNull();
  });

  it('a buffer topped up at a quiet scene\'s bitrate, then stalls where the server paused: no data in the stalls, no verdict', () => {
    const rates: RateReport[] = [];
    for (let i = 0; i < 20; i += 1) rates.push({ t: t0 + i * RATE_TICK_MS, kbps: 9000 });
    const stalls = [t0 + 61 * S, t0 + 90 * S];
    rates.push({ t: stalls[0] + 3 * S, kbps: 0, stalled: true }, { t: stalls[1] + 3 * S, kbps: 0, stalled: true });
    expect(starvedKbps(rates, t0 + 100 * S, 12000, opts(stalls))).toBeNull();
  });

  it('the first half minute after playback began (a start, a resume, a seek) never counts', () => {
    const { rates, stalls, end } = stallsWith(t0, [[1400, 5700, 3000], [2000, 4100, 1400]]);
    expect(starvedKbps(rates, end, 12000, { since: 0, stalls, lastStartAt: t0 - 5 * S })).toBeNull();
  });

  it('only since the last quality change: the new stream is judged on its own', () => {
    const { rates, stalls, end } = stallsWith(t0, [[1400, 5700, 3000], [2000, 4100, 1400]]);
    expect(starvedKbps(rates, end, 12000, { ...opts(stalls), since: end - 5 * S })).toBeNull();
  });
});

describe('AutoQuality: starving steps down, whatever the quick check says', () => {
  const t0 = 10 * MIN;
  const began = t0 - START_GRACE_MS - S;

  function customer(aq: AutoQuality, kbps: number[][], ctx: { serverKbps?: number } = {}) {
    const { rates, stalls, end } = stallsWith(t0, kbps);
    const base = { lastStartAt: began, internetKbps: QUICK, ...ctx };
    const moves = stalls.map((at) => aq.onStall(at, 0, film, 0, 5700, base));
    return { rates, end, base, moves };
  }

  it('quick check 42.5, delivered 1.4-5.7, need 12: steps down to what the server carries', () => {
    const aq = new AutoQuality(0);
    const { rates, end, base, moves } = customer(aq, [[1400, 5700, 3000], [2000, 4100, 1400]]);
    // Two stalls: not the three-stall rule yet.
    expect(moves).toEqual([null, null]);
    const starved = aq.starved(rates, end, 12000, base);
    expect(starved).toBe(5700);
    // The quick check does not make the line clear, and nothing keeps the file.
    expect(lineClearFor(12000, { ...base, starvedKbps: starved })).toBe(false);
    const p = aq.preview(film, 0, 5700, { ...base, starvedKbps: starved });
    expect(p.keepsFile).toBeFalsy();
    expect(p.next?.key).toBe('720-4');
    const note = autoQualityNote(film, 0, p);
    expect(note).toBe('Auto quality: lowering to 720p · 4 Mbps — the Plex server is only delivering 5.7 Mb/s');
    expect(note).not.toMatch(/fast enough/);
    const move = aq.onStarved(end, film, 0, starved);
    expect(move).toEqual({ step: film.find((s) => s.key === '720-4'), direction: 'down', reason: 'starved' });
  });

  it('a lower best rate goes lower, to the floor at most', () => {
    const aq = new AutoQuality(0);
    const { rates, end, base } = customer(aq, [[1400, 2600, 1400], [2000, 1900, 1400]]);
    const move = aq.onStarved(end, film, 0, aq.starved(rates, end, 12000, base));
    expect(move?.step.key).toBe('720-3');
  });

  it('delivered healthy: no change', () => {
    const aq = new AutoQuality(0);
    const { rates, end, base, moves } = customer(aq, [[9000, 30000, 42000], [28000, 35000, 40000]], { serverKbps: 42000 });
    expect(moves).toEqual([null, null]);
    expect(aq.starved(rates, end, 12000, base)).toBeNull();
    expect(aq.onStarved(end, film, 0, null)).toBeNull();
    // The server was seen sending it twice over: the card says so.
    expect(autoQualityNote(film, 0, aq.preview(film, 0, 30000, base))).toBe('Auto quality: keeps the original — the Plex server has sent it fast enough');
  });

  it('a line once seen fast (its start fill) takes one stall more, then starving still wins', () => {
    const aq = new AutoQuality(0);
    const two = customer(aq, [[1400, 5700, 3000], [2000, 4100, 1400]], { serverKbps: 30000 });
    expect(aq.starved(two.rates, two.end, 12000, two.base)).toBeNull();
    const aq3 = new AutoQuality(0);
    const three = customer(aq3, [[1400, 5700, 3000], [2000, 4100, 1400], [1500, 3000, 2500]], { serverKbps: 30000 });
    expect(aq3.starved(three.rates, three.end, 12000, three.base)).toBe(5700);
  });

  it('after a starved drop, the way back up waits, and then needs the measured speed', () => {
    const aq = new AutoQuality(0);
    const { rates, end, base } = customer(aq, [[1400, 5700, 3000], [2000, 4100, 1400]]);
    const move = aq.onStarved(end, film, 0, aq.starved(rates, end, 12000, base));
    expect(move).not.toBeNull();
    aq.applied(move as NonNullable<typeof move>, end);
    const at = film.findIndex((s) => s.key === '720-4');
    // Past the 2-minute gap, a read of 50 Mb/s: still waiting.
    expect(aq.maybeRaise(end + 3 * MIN, film, at, 0, 50000)).toBeNull();
    // After the wait, only a measured speed that carries the step above.
    expect(aq.maybeRaise(end + RAISE_BACKOFF_MS + S, film, at, 0, 6000)).toBeNull();
    expect(aq.maybeRaise(end + RAISE_BACKOFF_MS + S, film, at, 0, 50000)?.step.key).toBe('1080-8');
  });
});

describe('a conversion the server answers with an HTTP error: the recovery', () => {
  it('fresh session, then another quality, then a message; never the same thing twice', () => {
    const r = freshConvertRecovery();
    expect(convertRecoveryStep(r, 1_000, false)).toBe('fresh');
    expect(convertRecoveryStep(r, 2_000, false)).toBe('other');
    expect(convertRecoveryStep(r, 3_000, false)).toBe('give-up');
    expect(convertRecoveryStep(r, 4_000, false)).toBe('give-up');
    expect(r.total).toBe(2);
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
    expect(steps[steps.length - 1]).toBe('give-up');
    // Played only briefly: no reset.
    const q = freshConvertRecovery();
    convertRecoveryStep(q, 1_000, true);
    expect(convertRecoveryStep(q, 2_000, true)).toBe('other');
  });

  it('another quality: the file as it is when the measured rate carries it, else a lighter conversion', () => {
    const at = film.findIndex((s) => s.key === '720-4');
    // 20 Mb/s measured from the server: the 12 Mb/s file as it is.
    expect(convertAlternative(film, at, '720-4', { measuredKbps: 20000 })?.key).toBe('original');
    // Too slow for the file: the next lighter conversion.
    expect(convertAlternative(film, at, '720-4', { measuredKbps: 5000 })?.key).toBe('720-3');
    // Not measured: one step down.
    expect(convertAlternative(film, at, '720-4', {})?.key).toBe('720-3');
    // Audio that must be converted: never the file as it is.
    expect(convertAlternative(film, at, '720-4', { measuredKbps: 20000, files: false })?.key).toBe('720-3');
    // At the floor with nothing lighter: nothing to try.
    const floor = film.findIndex((s) => s.key === '720-3');
    expect(convertAlternative(film, floor, '720-3', { measuredKbps: 5000 })).toBeNull();
    // Steps that already failed are skipped.
    expect(convertAlternative(film, 1, '1080-8', { measuredKbps: 9000, failed: ['720-4'] })?.key).toBe('720-3');
  });
});
