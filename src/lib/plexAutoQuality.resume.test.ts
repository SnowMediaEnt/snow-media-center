// Automatic quality after a resume (the owner's TV, build 39): a film resumed
// part-way stalls once or twice while the server gets going at the resume
// point, then plays smoothly with 30 s and more in hand. Those start-up
// stalls were counted like stalls in the middle of a film, three of them
// lowered it to a conversion ("Lowered to 1080p · 12 Mbps for your speed")
// on a line whose internet check read 184 Mb/s against the 21.6 the file
// needs, and that conversion never started. Starting (or restarting after
// a jump) is not the connection failing; stalls alone never leave a file
// for a conversion at all now; and a line the server has delivered twice
// the file over, sustained, is proven — the quick internet check never
// proves anything (it kept a customer's 12 Mb/s file that the server sent
// at 1.4-5.7 Mb/s).
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, autoQualityNote, buildQualityLadder, inJumpGrace,
  PROVEN_FACTOR, RATE_TICK_MS, SEEK_GRACE_MS, START_GRACE_MS, type RateReport,
} from './plexAutoQuality';

const S = 1000;
const MIN = 60 * S;
// The owner's film: one 21.6 Mb/s file.
const film = buildQualityLadder([], 21600);

describe('the start of playback is not a stall', () => {
  it('stalls within the first 30 s after playback begins (a resume) are not counted', () => {
    const t0 = 10 * MIN;
    const aq = new AutoQuality(t0);
    const began = t0 + 12 * S; // the start-up hold, then playing
    const ctx = { lastStartAt: began, lastSeekAt: t0 };
    // 0:02 and 0:16 after it began, and one more at 0:25.
    expect(aq.onStall(began + 2 * S, film, 0, ctx)).toBeNull();
    expect(aq.onStall(began + 16 * S, film, 0, ctx)).toBeNull();
    expect(aq.onStall(began + 25 * S, film, 0, ctx)).toBeNull();
    expect(aq.stallsWithin(began + 25 * S)).toBe(0);
  });

  it('after that, stalls count as before', () => {
    const t0 = 10 * MIN;
    const aq = new AutoQuality(t0);
    const began = t0 + 12 * S;
    const ctx = { lastStartAt: began, lastSeekAt: t0 };
    expect(aq.onStall(began + START_GRACE_MS + 1 * S, film, 0, ctx)).toBeNull();
    expect(aq.stallsWithin(began + START_GRACE_MS + 1 * S)).toBe(1);
  });

  it('the grace runs from when playback began, not from load() (a hold can take longer than a seek grace)', () => {
    const load = 100 * S;
    const began = load + 20 * S;
    // Old rule: 5 s from the jump, long over by the time the film plays.
    expect(inJumpGrace(began + 2 * S, load)).toBe(false);
    expect(inJumpGrace(began + 2 * S, load, began)).toBe(true);
    expect(inJumpGrace(began + START_GRACE_MS, load, began)).toBe(false);
    // A plain seek keeps its own grace.
    expect(inJumpGrace(load + SEEK_GRACE_MS - 1, load, 0)).toBe(true);
  });

  it("the server's slow first seconds at the resume point are not delivery evidence either", () => {
    const aq = new AutoQuality(0);
    const began = 10 * MIN;
    // Three windows at 6 Mb/s inside a stall right after it began to play.
    const rates: RateReport[] = [1, 2, 3].map((i) => ({ t: began + i * RATE_TICK_MS, kbps: 6000, stalled: true }));
    const d = aq.delivery(rates, began + 12 * S, { lastStartAt: began }, began + 1, 21600);
    expect(d.kbps).toBeNull();
    expect(aq.onDelivery(began + 12 * S, film, 0, d, 21600)).toBeNull();
  });
});

describe('stalls alone never leave the file for a conversion', () => {
  it('three stalls in five minutes, whatever the line: stays on the file', () => {
    for (const ctx of [{ sustainedKbps: 84000 }, {}, { sustainedKbps: 21600 * PROVEN_FACTOR - 1 }, { relay: true }]) {
      const aq = new AutoQuality(0);
      expect(aq.onStall(1 * MIN, film, 0, ctx)).toBeNull();
      expect(aq.onStall(2 * MIN, film, 0, ctx)).toBeNull();
      expect(aq.onStall(3 * MIN, film, 0, ctx)).toBeNull();
    }
  });

  it('a lighter file as it is is still fine to step to', () => {
    const versions = [
      { id: 'a', ratingKey: '1', mediaIndex: 0, label: '4K', bitrateKbps: 60000, partKey: '/p/a' },
      { id: 'b', ratingKey: '1', mediaIndex: 1, label: '1080p', bitrateKbps: 10000, partKey: '/p/b' },
    ];
    const ladder = buildQualityLadder(versions as never);
    const aq = new AutoQuality(0);
    const ctx = { sustainedKbps: 184000 };
    aq.onStall(1 * MIN, ladder, 0, ctx);
    aq.onStall(2 * MIN, ladder, 0, ctx);
    expect(aq.onStall(3 * MIN, ladder, 0, ctx)?.step.key).toBe('original@b');
  });

  it("the card's line: a proven line keeps the file; otherwise it lowers only on too little delivered", () => {
    const aq = new AutoQuality(0);
    const p = aq.preview(film, 0, { sustainedKbps: 84000 });
    expect(p.next).toBeNull();
    expect(autoQualityNote(film, 0, p)).toBe('Auto quality: keeps the original — the Plex server has sent it fast enough');
    const q = aq.preview(film, 0);
    expect(q.next).toBeNull();
    expect(q.holds).toBe(true);
    expect(autoQualityNote(film, 0, q)).toBe('Auto quality: lowers only if the Plex server delivers less than this needs');
  });
});

describe('a proven line and a raise that stalls', () => {
  it('the undo-raise respects a proven line', () => {
    const aq = new AutoQuality(0);
    const ladder = buildQualityLadder([], 12000);
    const at = ladder.findIndex((s) => s.key === '720-4');
    const up = aq.maybeRaise(10 * MIN, ladder, at, 0, 50000)!;
    expect(up.step.key).toBe('1080-8');
    aq.applied(up, 10 * MIN);
    // The server has sustained twice what 1080p · 8 Mbps needs.
    expect(aq.onStall(11 * MIN, ladder, at - 1, { sustainedKbps: 16000 })).toBeNull();
    // Not proven: straight back.
    const other = new AutoQuality(0);
    other.applied(other.maybeRaise(10 * MIN, ladder, at, 0, 50000)!, 10 * MIN);
    expect(other.onStall(11 * MIN, ladder, at - 1, { sustainedKbps: 12000 })?.reason).toBe('undo-raise');
  });
});
