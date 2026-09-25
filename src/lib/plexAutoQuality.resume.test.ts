// Automatic quality after a resume (the owner's TV, build 39): a film resumed
// part-way stalls once or twice while the server gets going at the resume
// point, then plays smoothly with 30 s and more in hand. Those start-up
// stalls were counted like stalls in the middle of a film, three of them
// lowered it to a conversion ("Lowered to 1080p · 12 Mbps for your speed")
// on a line whose internet check read 184 Mb/s against the 21.6 the file
// needs, and that conversion never started. Starting (or restarting after
// a jump) is not the connection failing, and with the internet plainly fast
// enough, stalls alone never leave the file for a conversion.
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, StallCounter, autoQualityNote, buildQualityLadder, inJumpGrace,
  INTERNET_CLEAR_FACTOR, SEEK_GRACE_MS, START_GRACE_MS,
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
    const ctx = { lastStartAt: began };
    // 0:02 and 0:16 after it began, and one more at 0:25.
    expect(aq.onStall(began + 2 * S, t0, film, 0, 30000, ctx)).toBeNull();
    expect(aq.onStall(began + 16 * S, t0, film, 0, 30000, ctx)).toBeNull();
    expect(aq.onStall(began + 25 * S, t0, film, 0, 30000, ctx)).toBeNull();
    expect(aq.stallCount(began + 25 * S)).toBe(0);
  });

  it('after that, stalls count as before', () => {
    const t0 = 10 * MIN;
    const aq = new AutoQuality(t0);
    const began = t0 + 12 * S;
    const ctx = { lastStartAt: began };
    expect(aq.onStall(began + START_GRACE_MS + 1 * S, t0, film, 0, 12000, ctx)).toBeNull();
    expect(aq.onStall(began + 2 * MIN, t0, film, 0, 12000, ctx)).toBeNull();
    expect(aq.onStall(began + 3 * MIN, t0, film, 0, 12000, ctx)?.direction).toBe('down');
  });

  it('the grace runs from when playback began, not from load() (a hold can take longer than a seek grace)', () => {
    const c = new StallCounter();
    const load = 100 * S;
    const began = load + 20 * S;
    // Old rule: 5 s from the jump, long over by the time the film plays.
    expect(c.isSeek(began + 2 * S, load)).toBe(false);
    expect(c.isSeek(began + 2 * S, load, began)).toBe(true);
    expect(inJumpGrace(began + 2 * S, load, began)).toBe(true);
    expect(inJumpGrace(began + START_GRACE_MS, load, began)).toBe(false);
    // A plain seek keeps its own grace.
    expect(inJumpGrace(load + SEEK_GRACE_MS - 1, load, 0)).toBe(true);
  });
});

describe('a fast internet: stalls alone never leave the file for a conversion', () => {
  const clear = { internetKbps: 184000 };
  it('three stalls in five minutes, internet check 184 Mb/s against a 21.6 Mb/s file: stays on the file', () => {
    const aq = new AutoQuality(0);
    expect(aq.onStall(1 * MIN, 0, film, 0, 12000, clear)).toBeNull();
    expect(aq.onStall(2 * MIN, 0, film, 0, 12000, clear)).toBeNull();
    expect(aq.onStall(3 * MIN, 0, film, 0, 12000, clear)).toBeNull();
  });

  it('a slow internet check still lowers on stalls', () => {
    const aq = new AutoQuality(0);
    const slow = { internetKbps: 21600 * INTERNET_CLEAR_FACTOR - 1 };
    aq.onStall(1 * MIN, 0, film, 0, 12000, slow);
    aq.onStall(2 * MIN, 0, film, 0, 12000, slow);
    expect(aq.onStall(3 * MIN, 0, film, 0, 12000, slow)?.step.presetKey).not.toBe('original');
  });

  it('on the Plex Relay the internet check says nothing about the relay', () => {
    const aq = new AutoQuality(0);
    const relay = { internetKbps: 184000, relay: true };
    aq.onStall(1 * MIN, 0, film, 0, 12000, relay);
    aq.onStall(2 * MIN, 0, film, 0, 12000, relay);
    expect(aq.onStall(3 * MIN, 0, film, 0, 12000, relay)?.direction).toBe('down');
  });

  it('a lighter file as it is is still fine to step to', () => {
    const versions = [
      { id: 'a', ratingKey: '1', mediaIndex: 0, label: '4K', bitrateKbps: 60000, partKey: '/p/a' },
      { id: 'b', ratingKey: '1', mediaIndex: 1, label: '1080p', bitrateKbps: 10000, partKey: '/p/b' },
    ];
    const ladder = buildQualityLadder(versions as never);
    const aq = new AutoQuality(0);
    const ctx = { internetKbps: 184000 };
    aq.onStall(1 * MIN, 0, ladder, 0, 30000, ctx);
    aq.onStall(2 * MIN, 0, ladder, 0, 30000, ctx);
    expect(aq.onStall(3 * MIN, 0, ladder, 0, 30000, ctx)?.step.key).toBe('original@b');
  });

  it("the card's line says so instead of promising a drop", () => {
    const aq = new AutoQuality(0);
    const p = aq.preview(film, 0, 12000, { internetKbps: 184000 });
    expect(p.next).toBeNull();
    expect(autoQualityNote(film, 0, p)).toMatch(/keeps the original/i);
    expect(aq.preview(film, 0, 12000).next?.presetKey).not.toBe('original');
  });
});
