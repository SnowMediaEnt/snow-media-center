// A Plex server that delivers far less than the file needs (the owner's TV,
// 1.9.6: a 16 Mb/s film at about 1.5 Mb/s from the server while the quick
// internet check read 30-38). The start-up loading ended in an error before
// automatic quality ever acted. Now: a starved file steps down at once, a
// start that ends in an error is rescued at a preset that rate carries
// (never under 720p · 3 Mbps: "at least a 720"; back up on a steady
// signal), and the card's verdict and automatic quality
// agree (the owner's photo: 14.3 of 15 Mb/s, "Pick 1080p · 8 Mbps").
import { describe, expect, it } from 'vitest';
import {
  AutoQuality, MIN_CHANGE_GAP_MS, RAISE_BACKOFF_MS, RATE_TICK_MS, START_GRACE_MS, _resetConversionRefusals, ladderIndex, type QualityStep, autoQualityNote, buildQualityLadder, deliveredKbps, floorPresetFor,
  noteConversionRefused, serverRefusesConversion, startDelivery, startPresetFor, startRescue, type RateReport,
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

  it('down to 720p · 3 Mbps, the floor, however little arrives ("at least a 720")', () => {
    const aq = new AutoQuality(began);
    const d = aq.delivery(rates, now, { lastStartAt: began, direct: true }, began + 4 * S, 16000);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct'));
    expect(keys(ladder)).toEqual(['original', '1080-12', '1080-8', '720-4', '720-3']);
    const move = aq.onDelivery(now, ladder, 0, d, 16000);
    expect(move).toMatchObject({ direction: 'down', reason: 'delivery', kbps: 1500 });
    expect(move?.step.key).toBe('720-3');
  });

  it('the floor is 720p · 3 Mbps off the relay, 480p · 2 Mbps on it', () => {
    expect(floorPresetFor('direct')).toBe('720-3');
    expect(floorPresetFor('lan')).toBe('720-3');
    expect(floorPresetFor('relay')).toBe('480-2');
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
      { t: load + 13 * S, kbps: 8000 }, // playing, topping up: not flat out
      { t: load + 16 * S, kbps: 1500, stalled: true },
    ];
    expect(startDelivery(rates, load, null, load + 20 * S)).toBe(Math.round((1400 + 1600 + 8000 + 1500) / 4));
    expect(startDelivery(rates, load, load + 11 * S, load + 20 * S)).toBe(Math.round((1400 + 1600 + 1500) / 3));
    expect(startDelivery(rates.slice(0, 2), load, null, load + 20 * S)).toBeNull();
  });

  it('a pause is no speed: the windows either side of it are part-filled, so nothing is told', () => {
    const load = 1_000 * S;
    // A fast line (a 4K file) whose server paused for a moment.
    const rates: RateReport[] = [
      { t: load + 4 * S, kbps: 9000, stalled: true }, { t: load + 7 * S, kbps: 0, stalled: true }, { t: load + 10 * S, kbps: 12000, stalled: true },
    ];
    expect(startDelivery(rates, load, null, load + 12 * S)).toBeNull();
  });

  it('windows within a seek\'s grace are the jump, not the line', () => {
    const load = 1_000 * S;
    const rates: RateReport[] = [
      { t: load + 4 * S, kbps: 900, stalled: true }, { t: load + 7 * S, kbps: 60000, stalled: true }, { t: load + 10 * S, kbps: 60000, stalled: true },
    ];
    expect(startDelivery(rates, load, null, load + 12 * S, load + 1 * S)).toBe(60000);
  });

  it('a server that turned a conversion down is remembered for the session', () => {
    _resetConversionRefusals();
    expect(serverRefusesConversion('https://a.plex.direct')).toBe(false);
    noteConversionRefused('https://a.plex.direct');
    expect(serverRefusesConversion('https://a.plex.direct')).toBe(true);
    expect(serverRefusesConversion('https://b.plex.direct')).toBe(false);
    _resetConversionRefusals();
  });

  it('a 16 Mb/s file at 1.5: restarted at 720p · 3 Mbps, never under it; at 5 too; at 12: 1080p · 8', () => {
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '720-3' }, kbps: 1500 });
    expect(startRescue({ deliveredKbps: 5000, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '720-3' } });
    expect(startRescue({ deliveredKbps: 12000, needKbps: 16000, currentKey: 'original' })).toMatchObject({ step: { key: '1080-8' } });
  });

  it('once per level, never a loop: then the error, with the reason', () => {
    expect(startRescue({ deliveredKbps: 9000, needKbps: 16000, currentKey: 'original', tried: ['1080-8'] })).toMatchObject({ step: { key: '720-4' } });
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original', tried: ['720-3'] })).toEqual({ exhausted: true, kbps: 1500, lowest: expect.objectContaining({ key: '720-3' }) });
    // Never under the floor: from 720p · 3 Mbps there is nowhere to go.
    expect(startRescue({ deliveredKbps: 500, needKbps: 3000, currentKey: '720-3' })).toMatchObject({ exhausted: true });
    // A conversion that failed is not offered again.
    expect(startRescue({ deliveredKbps: 1500, needKbps: 4000, currentKey: '720-4', failed: ['720-3'] })).toMatchObject({ exhausted: true });
  });

  it('not a speed problem: no rescue (the usual error and retries stand)', () => {
    expect(startRescue({ deliveredKbps: null, needKbps: 16000, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 1500, needKbps: undefined, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 17000, needKbps: 16000, currentKey: 'original' })).toBeNull();
    expect(startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original', sustainedKbps: 40000 })).toBeNull();
  });

  it('the owner: 1.5 Mb/s → 720p · 3 Mbps; a steady 8 Mb/s for 90 s raises it to 720p · 4 after 2 min, then on up', () => {
    const MIN = 60 * S;
    const aq = new AutoQuality(0);
    const plan = startRescue({ deliveredKbps: 1500, needKbps: 16000, currentKey: 'original' }) as { step: QualityStep; kbps: number };
    expect(plan.step.key).toBe('720-3');
    aq.rescued(plan.step, plan.kbps, 0);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct'));
    const idx = (key: string) => ladderIndex(ladder, key);
    expect(autoQualityNote(ladder, idx('720-3'), aq.preview(ladder, idx('720-3'), {}, 10 * S))).toBe('Auto quality: switched to 720p · 3 Mbps — the Plex server sent 1.5 Mb/s on average');
    // A steady 8 Mb/s: not before two minutes...
    expect(aq.maybeRaise(MIN_CHANGE_GAP_MS - S, ladder, idx('720-3'), 0, 8000)).toBeNull();
    // ...then one step, to 720p · 4 (4 × 1.3 ≤ 8), not to 1080p · 8 (8 × 1.3 > 8).
    const up1 = aq.maybeRaise(MIN_CHANGE_GAP_MS, ladder, idx('720-3'), 0, 8000)!;
    expect(up1).toMatchObject({ direction: 'up', reason: 'speed', step: { key: '720-4' } });
    aq.applied(up1, MIN_CHANGE_GAP_MS);
    expect(aq.maybeRaise(MIN_CHANGE_GAP_MS + 3 * MIN, ladder, idx('720-4'), 0, 8000)).toBeNull();
    // The server keeps up at 12: on up, one step every two minutes or more, to the file.
    let at = MIN_CHANGE_GAP_MS;
    let key = '720-4';
    const climbed: string[] = [];
    for (const speed of [12000, 18000, 30000]) {
      at += MIN_CHANGE_GAP_MS;
      const up = aq.maybeRaise(at, ladder, idx(key), 0, speed)!;
      aq.applied(up, at);
      key = up.step.key;
      climbed.push(key);
    }
    expect(climbed).toEqual(['1080-8', '1080-12', 'original']);
  });

  it('a raise that stalls goes back down and raising backs off: no ping-pong', () => {
    const aq = new AutoQuality(0);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct'));
    aq.rescued(ladder[ladder.length - 1], 1500, 0);
    const up = aq.maybeRaise(MIN_CHANGE_GAP_MS, ladder, ladder.length - 1, 0, 8000)!;
    aq.applied(up, MIN_CHANGE_GAP_MS);
    const back = aq.onStall(MIN_CHANGE_GAP_MS + 30 * S, ladder, ladder.length - 2, {});
    expect(back).toMatchObject({ direction: 'down', reason: 'undo-raise', step: { key: '720-3' } });
    aq.applied(back!, MIN_CHANGE_GAP_MS + 30 * S);
    expect(aq.maybeRaise(MIN_CHANGE_GAP_MS + 30 * S + 5 * 60 * S, ladder, ladder.length - 1, 0, 8000)).toBeNull();
    expect(aq.maybeRaise(MIN_CHANGE_GAP_MS + 30 * S + RAISE_BACKOFF_MS + S, ladder, ladder.length - 1, 0, 8000)?.step.key).toBe('720-4');
    expect(START_GRACE_MS).toBe(30_000);
  });

  it('never above the viewer\'s ceiling', () => {
    const aq = new AutoQuality(0);
    const ladder = buildQualityLadder([], 16000, floorPresetFor('direct'));
    aq.viewerPicked('720-4', 0);
    const ceiling = aq.ceiling(ladder, 0);
    expect(aq.maybeRaise(MIN_CHANGE_GAP_MS, ladder, ladderIndex(ladder, '720-4'), ceiling, 50000)).toBeNull();
  });
});

describe('the title page measured the server too slow for the file', () => {
  it('starts at the converted preset that rate carries', () => {
    expect(startPresetFor(1700, 16000)?.key).toBe('720-3');
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
