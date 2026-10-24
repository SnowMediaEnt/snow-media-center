// A Plex server that delivers far less than the file needs (the owner's TV,
// 1.9.6: a 16 Mb/s film at about 1.5 Mb/s from the server while the quick
// internet check read 30-38). The start-up loading ended in an error before
// automatic quality ever acted. Now: a starved file steps down at once, a
// start that ends in an error is rescued at a preset that rate carries
// (under the usual floor too), and the card's verdict and automatic quality
// agree (the owner's photo: 14.3 of 15 Mb/s, "Pick 1080p · 8 Mbps").
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, RATE_TICK_MS, START_GRACE_MS, autoQualityNote, buildQualityLadder, deliveredKbps, floorPresetFor,
  startDelivery, startPresetFor, startRescue, type RateReport,
} from './plexAutoQuality';

const S = 1000;
const stalled = (from: number, kbps: number[]): RateReport[] => kbps.map((k, i) => ({ t: from + (i + 1) * RATE_TICK_MS, kbps: k, stalled: true }));
const keys = (l: { key: string }[]) => l.map((s) => s.key);

describe('a starved file steps down at once', () => {
  const began = 100 * S;
  // Its first stall, 4 s after it began to play: two windows at 1.5 Mb/s.
  const rates = stalled(began + 4 * S, [1500, 1500]);
  const now = began + 11 * S;

  it("inside the start's grace, under half of what it needs: a verdict", () => {
    expect(deliveredKbps(rates, now, { lastStartAt: began, needKbps: 16000, direct: true })).toEqual({ kbps: 1500, windows: 2, paused: false, early: true });
  });

  it('not a conversion warming up, not a proven line, not a seek, not a pause, not merely short', () => {
    expect(deliveredKbps(rates, now, { lastStartAt: began, needKbps: 16000 }).kbps).toBeNull();
    expect(deliveredKbps(rates, now, { lastStartAt: began, needKbps: 16000, direct: true, proven: true }).kbps).toBeNull();
    expect(deliveredKbps(rates, now, { lastStartAt: began, lastSeekAt: began + 4 * S, needKbps: 16000, direct: true }).kbps).toBeNull();
    const paused = [...rates, { t: now, kbps: 0, stalled: true }];
    expect(deliveredKbps(paused, now, { lastStartAt: began, needKbps: 16000, direct: true, stallStart: began + 4 * S }).paused).toBe(true);
    expect(deliveredKbps(paused, now, { lastStartAt: began, needKbps: 16000, direct: true, stallStart: began + 4 * S }).kbps).toBeNull();
    // 10 of 16: short, but the start's grace is waited out for that.
    expect(deliveredKbps(stalled(began + 4 * S, [10000, 10000]), now, { lastStartAt: began, needKbps: 16000, direct: true }).kbps).toBeNull();
  });

  it('down to 480p · 2 Mbps, under the usual floor: that is all 1.5 Mb/s carries', () => {
    const aq = new AutoQuality(began);
    const d = aq.delivery(rates, now, { lastStartAt: began, direct: true }, began + 4 * S, 16000);
    expect(aq.lowDeliveryKbps()).toBe(1500);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct', aq.lowDeliveryKbps()));
    expect(keys(ladder)).toEqual(['original', '1080-12', '1080-8', '720-4', '720-3', '480-2']);
    const move = aq.onDelivery(now, ladder, 0, d, 16000);
    expect(move).toMatchObject({ direction: 'down', reason: 'delivery', kbps: 1500 });
    expect(move?.step.key).toBe('480-2');
  });

  it('the floor stays put when the server carries it', () => {
    expect(floorPresetFor('direct', 3500)).toBe('720-3');
    expect(floorPresetFor('direct', 2900)).toBe('480-2');
    expect(floorPresetFor('direct', null)).toBe('720-3');
    expect(floorPresetFor('relay', 50000)).toBe('480-2');
  });
});

describe("the owner's photo: 14.3 Mb/s from the server, 15 needed", () => {
  const film = buildQualityLadder([], 15000);
  const t0 = 10 * 60 * S;

  it('short by a shade is short (busy scenes need more than the average): it takes the step itself', () => {
    const aq = new AutoQuality(0);
    const d = aq.delivery(stalled(t0, [1100, 27500, 14300]), t0 + 10 * S, { lastStartAt: 0, sustainedKbps: 27500 }, t0, 15000);
    expect(d.kbps).toBe(14300);
    expect(aq.onDelivery(t0 + 10 * S, film, 0, d, 15000)?.step.key).toBe('1080-8');
  });

  it("the card's evidence names that very step, and says it comes within seconds", () => {
    const aq = new AutoQuality(0);
    const p = aq.preview(film, 0, { lastStartAt: 0, stallKbps: 14300, needKbps: 15000, stallAt: t0, direct: true });
    expect(p.next?.key).toBe('1080-8');
    expect(p.soon).toBe(true);
    expect(autoQualityNote(film, 0, p)).toBe('Auto quality: lowering to 1080p · 8 Mbps — the Plex server is only delivering 14.3 Mb/s');
  });

  it("inside the start's grace: if it keeps stalling", () => {
    const p = new AutoQuality(0).preview(film, 0, { lastStartAt: t0 - 5 * S, stallKbps: 14300, needKbps: 15000, stallAt: t0, direct: true });
    expect(p.soon).toBe(false);
    expect(autoQualityNote(film, 0, p)).toBe('Auto quality: will lower to 1080p · 8 Mbps if it keeps stalling — the Plex server is sending 14.3 Mb/s');
  });

  it('on a proven line it is a slow spell, which the buffer is there for', () => {
    const p = new AutoQuality(0).preview(film, 0, { lastStartAt: 0, stallKbps: 14300, needKbps: 15000, stallAt: t0, sustainedKbps: 40000 });
    expect(p.next).toBeNull();
    expect(p.provenKbps).toBe(40000);
  });

  it('after the switch the card says what it did, then goes back to its usual line', () => {
    const aq = new AutoQuality(0);
    const move = aq.onDelivery(t0, film, 0, { kbps: 14300, windows: 3, paused: false }, 15000)!;
    aq.applied(move, t0);
    const at = film.findIndex((s) => s.key === '1080-8');
    expect(autoQualityNote(film, at, aq.preview(film, at, {}, t0 + 30 * S))).toBe('Auto quality: switched to 1080p · 8 Mbps — the Plex server sent 14.3 Mb/s on average');
    expect(autoQualityNote(film, at, aq.preview(film, at, {}, t0 + 4 * 60 * S))).toBe('Auto quality: steps down by itself if the Plex server sends less than this needs');
  });
});

describe('start-up rescue', () => {
  it("what the server delivered while the start loaded: the windows before it played, and stalled ones after", () => {
    const load = 1_000 * S;
    const rates: RateReport[] = [
      { t: load + 1 * S, kbps: 90000 }, // mostly the stream before
      { t: load + 4 * S, kbps: 1400, stalled: true },
      { t: load + 7 * S, kbps: 1600, stalled: true },
      { t: load + 10 * S, kbps: 0, stalled: true }, // a pause is not a speed
      { t: load + 13 * S, kbps: 8000 }, // playing, topping up: not flat out
      { t: load + 16 * S, kbps: 1500, stalled: true },
    ];
    expect(startDelivery(rates, load, null, load + 20 * S)).toBe(Math.round((1400 + 1600 + 8000 + 1500) / 4));
    expect(startDelivery(rates, load, load + 11 * S, load + 20 * S)).toBe(1500);
    expect(startDelivery(rates.slice(0, 2), load, null, load + 20 * S)).toBeNull();
  });

  it('a 16 Mb/s file at 1.5: restarted at 480p · 2 Mbps; at 5: 720p · 3 Mbps', () => {
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '480-2' }, kbps: 1500 });
    expect(startRescue({ deliveredKbps: 5000, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '720-3' } });
    expect(startRescue({ deliveredKbps: 12000, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '1080-8' } });
  });

  it('once per level, never a loop: then the error, with the reason', () => {
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original', tried: ['480-2'] })).toMatchObject({ step: { key: '720-3' } });
    expect(startRescue({ deliveredKbps: 500, needKbps: 2000, currentKey: '480-2', tried: ['480-2'] })).toEqual({ exhausted: true, kbps: 500, lowest: expect.objectContaining({ key: '480-2' }) });
    // A conversion that failed is not offered again.
    expect(startRescue({ deliveredKbps: 1500, needKbps: 3000, currentKey: '720-3', failed: ['480-2'] })).toMatchObject({ exhausted: true });
  });

  it('not a speed problem: no rescue (the usual error and retries stand)', () => {
    expect(startRescue({ deliveredKbps: null, needKbps: 16000, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 1500, needKbps: undefined, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 17000, needKbps: 16000, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original', sustainedKbps: 40000 })).toBeNull();
  });

  it('a rescue counts as a change: nothing raised for ten minutes, and the card says it', () => {
    const aq = new AutoQuality(0);
    const step = startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original' }) as { step: never; kbps: number };
    aq.rescued(step.step, step.kbps, 0);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct', aq.lowDeliveryKbps()));
    const at = ladder.findIndex((s) => s.key === '480-2');
    expect(aq.maybeRaise(5 * 60 * S, ladder, at, 0, 50000)).toBeNull();
    expect(autoQualityNote(ladder, at, aq.preview(ladder, at, {}, 10 * S))).toBe('Auto quality: switched to 480p · 2 Mbps — the Plex server sent 1.5 Mb/s on average');
    expect(START_GRACE_MS).toBe(30_000);
  });
});

describe('the title page measured the server too slow for the file', () => {
  it('starts at the converted preset that rate carries', () => {
    expect(startPresetFor(1700, 16000)?.key).toBe('480-2');
    expect(startPresetFor(6000, 16000)?.key).toBe('720-4');
    expect(startPresetFor(14300, 15000)?.key).toBe('1080-8');
  });
  it('the file when the rate carries it, or nothing is known', () => {
    expect(startPresetFor(16000, 16000)).toBeNull();
    expect(startPresetFor(12000, 10000)).toBeNull();
    expect(startPresetFor(null, 16000)).toBeNull();
    expect(startPresetFor(1700, undefined)).toBeNull();
  });
});
