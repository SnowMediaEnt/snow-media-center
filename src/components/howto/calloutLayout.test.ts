import { describe, expect, it } from 'vitest';
import type { ShotRect } from '@/data/howtoContract';
import { REMOTE_BODY, REMOTE_RECTS, REMOTE_SIDES } from './RemoteDiagram';
import { EDGE_MAX, EDGE_MIN, LABEL_MAX_WIDTH, growRing, layoutCallouts, spotlightHoles, type Box } from './calloutLayout';

const inside = (b: Box) =>
  b.left >= EDGE_MIN - 0.001 && b.top >= EDGE_MIN - 0.001 && b.left + b.width <= EDGE_MAX + 0.001 && b.top + b.height <= EDGE_MAX + 0.001;
const touch = (a: Box, b: Box) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

// Rects shaped like real ones: a bar at the top, cards low, a preview on the right, corners, the whole frame.
const SAMPLE: ShotRect[] = [
  [0, 0, 100, 8], [82, 1, 17, 9], [2, 35, 96, 24], [9, 61, 82, 27], [71, 61, 20, 27], [0, 92, 100, 8],
  [0, 0, 100, 100], [45, 45, 10, 10], [60, 20, 38, 45], [1, 20, 25, 60], [74, 20, 25, 60], [40, 92, 20, 7],
];

describe('layoutCallouts', () => {
  it('keeps every label inside 1..99% and no wider than 38%', () => {
    for (const rect of SAMPLE) {
      for (const chars of [4, 14, 26]) {
        const [c] = layoutCallouts([{ rect, chars }]);
        expect(inside(c.label), JSON.stringify({ rect, chars, label: c.label })).toBe(true);
        expect(c.label.width).toBeLessThanOrEqual(LABEL_MAX_WIDTH + 0.001);
        expect(c.label.left + c.label.maxWidth).toBeLessThanOrEqual(EDGE_MAX + 0.001);
      }
    }
  });

  it('keeps labels inside when the frame is small or the numbers are measured', () => {
    for (const rect of SAMPLE) {
      const [a, b] = layoutCallouts([{ rect }, { rect: [30, 30, 20, 20] }], {
        frame: { width: 320, height: 180 },
        sizes: [{ width: 38, height: 22 }, { width: 30, height: 12 }],
      });
      expect(inside(a.label)).toBe(true);
      expect(inside(b.label)).toBe(true);
    }
  });

  it('never lets 3 labels overlap', () => {
    const sets: ShotRect[][] = [
      [[9, 61, 20, 27], [40, 61, 20, 27], [71, 61, 20, 27]],
      [[82, 1, 6, 8], [88, 1, 5, 8], [94, 1, 5, 8]],
      [[2, 12, 20, 60], [30, 12, 20, 60], [58, 12, 20, 60]],
      [[10, 20, 30, 10], [10, 33, 30, 10], [10, 46, 30, 10]],
      [[0, 0, 100, 100], [0, 0, 100, 100], [0, 0, 100, 100]],
      [[5, 90, 30, 8], [35, 90, 30, 8], [65, 90, 30, 8]],
    ];
    for (const rects of sets) {
      for (const chars of [10, 26]) {
        const out = layoutCallouts(rects.map((rect) => ({ rect, chars })));
        expect(out).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
          expect(inside(out[i].label), JSON.stringify({ rects, i })).toBe(true);
          for (let j = i + 1; j < 3; j++) {
            expect(touch(out[i].label, out[j].label), JSON.stringify({ rects, i, j, a: out[i].label, b: out[j].label })).toBe(false);
          }
        }
      }
    }
  });

  it('puts the label below the ring if it ends above 70%, else above if it starts below 30%, else beside', () => {
    expect(layoutCallouts([{ rect: [40, 10, 20, 30] }])[0].label.side).toBe('below');
    expect(layoutCallouts([{ rect: [40, 50, 20, 19] }])[0].label.side).toBe('below'); // ends at 69, ring grown to 69.8
    expect(layoutCallouts([{ rect: [40, 60, 20, 30] }])[0].label.side).toBe('above');
    // Tall: starts above 30 and ends below 70 -> beside it, right first.
    expect(layoutCallouts([{ rect: [5, 20, 20, 60] }])[0].label.side).toBe('right');
    // ... and left when the right side is full.
    expect(layoutCallouts([{ rect: [60, 20, 38, 60] }])[0].label.side).toBe('left');
  });

  it('places the label just past the ring on that side', () => {
    const below = layoutCallouts([{ rect: [40, 10, 20, 30] }])[0];
    expect(below.label.top).toBeGreaterThan(below.ring.top + below.ring.height);
    const above = layoutCallouts([{ rect: [40, 60, 20, 30] }])[0];
    expect(above.label.top + above.label.height).toBeLessThan(above.ring.top);
    const right = layoutCallouts([{ rect: [5, 20, 20, 60] }])[0];
    expect(right.label.left).toBeGreaterThan(right.ring.left + right.ring.width);
  });

  it('numbers the highlights only when there is more than one', () => {
    expect(layoutCallouts([{ rect: [10, 10, 20, 20] }])[0].badge).toBeNull();
    expect(layoutCallouts([{ rect: [10, 10, 20, 20] }, { rect: [50, 10, 20, 20] }]).map((c) => c.badge)).toEqual([1, 2]);
    expect(layoutCallouts([{ rect: [10, 10, 20, 20] }, { rect: [40, 10, 20, 20] }, { rect: [70, 10, 20, 20] }]).map((c) => c.badge)).toEqual([1, 2, 3]);
  });

  it('moves the later of two colliding labels down, or up at the bottom edge', () => {
    // Sides forced, so no other side is tried first.
    const [a, b] = layoutCallouts([{ rect: [40, 10, 20, 20], side: 'below' }, { rect: [40, 10, 20, 20], side: 'below' }]);
    expect(b.label.top).toBeGreaterThan(a.label.top);
    const [c, d] = layoutCallouts([{ rect: [40, 60, 20, 30], side: 'above' }, { rect: [40, 60, 20, 30], side: 'above' }]);
    expect(d.label.top).toBeLessThan(c.label.top);
  });

  it('takes another side when the rule\'s spot would cover a ring (stacked menu rows)', () => {
    // Three rows one under the other, as in the hold-OK menu: a label below the
    // first row would sit on the second.
    const rows: ShotRect[] = [[30, 40, 45, 7], [30, 48, 45, 7], [30, 56, 45, 7]];
    const out = layoutCallouts(rows.map((rect) => ({ rect, chars: 10 })));
    for (const c of out) {
      for (const r of out) expect(touch(c.label, r.ring)).toBe(false);
      expect(inside(c.label)).toBe(true);
    }
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) expect(touch(out[i].label, out[j].label)).toBe(false);
    }
  });

  it('points from the label edge that faces the ring, and stretches when the label moved away', () => {
    const [a] = layoutCallouts([{ rect: [40, 10, 20, 30] }]);
    expect(a.pointer).not.toBeNull();
    expect(a.pointer!.edge).toBe('top');
    expect(a.pointer!.offset).toBeGreaterThanOrEqual(10);
    expect(a.pointer!.offset).toBeLessThanOrEqual(90);
    const [b, c] = layoutCallouts([{ rect: [40, 10, 20, 20], side: 'below' }, { rect: [40, 10, 20, 20], side: 'below' }]);
    expect(c.pointer!.length).toBeGreaterThan(b.pointer!.length);
  });

  it('grows the ring by 0.8% and keeps it inside the frame', () => {
    expect(growRing([10, 20, 30, 40])).toEqual({ left: 9.2, top: 19.2, width: 31.6, height: 41.6 });
    const edge = growRing([0, 0, 100, 100]);
    expect(edge).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('uses at most 3 highlights', () => {
    expect(layoutCallouts(SAMPLE.slice(0, 5).map((rect) => ({ rect })))).toHaveLength(3);
  });

  it('keeps labels off the areas to avoid (the remote chip)', () => {
    const chip: Box = { left: 1.8, top: 86, width: 30, height: 11 };
    const [c] = layoutCallouts([{ rect: [2, 70, 20, 15] }], { avoid: [chip] });
    expect(touch(c.label, chip)).toBe(false);
    expect(inside(c.label)).toBe(true);
  });

  it('lays the drawn remote out with all 5 labels apart, beside the body', () => {
    const ids = Object.keys(REMOTE_RECTS);
    const out = layoutCallouts(ids.map((id) => ({ rect: REMOTE_RECTS[id], side: REMOTE_SIDES[id], anchor: REMOTE_BODY, chars: 22 })).slice(0, 3));
    out.forEach((c) => expect(inside(c.label)).toBe(true));
    const bodyRight = REMOTE_BODY.left + REMOTE_BODY.width;
    expect(out[0].label.left + out[0].label.width).toBeLessThanOrEqual(REMOTE_BODY.left); // arrows: left of the remote
    expect(out[1].label.left).toBeGreaterThanOrEqual(bodyRight); // OK: right of it
  });
});

describe('spotlightHoles', () => {
  const a: Box = { left: 10, top: 10, width: 20, height: 20 };
  it('keeps separate rings as they are', () => {
    const b: Box = { left: 50, top: 50, width: 10, height: 10 };
    expect(spotlightHoles([a, b])).toEqual([a, b]);
  });
  it('merges a ring inside another and rings that overlap into one hole', () => {
    expect(spotlightHoles([a, { left: 15, top: 15, width: 5, height: 5 }])).toEqual([a]);
    expect(spotlightHoles([a, { left: 25, top: 25, width: 20, height: 20 }])).toEqual([{ left: 10, top: 10, width: 35, height: 35 }]);
  });
});
