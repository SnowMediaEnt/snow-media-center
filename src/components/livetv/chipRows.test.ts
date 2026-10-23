import { describe, expect, it } from 'vitest';
import { chipAcross, chipAcrossIn, type ChipBox } from './chipRows';

/** Chips of these widths laid out from the left in rows `width` wide (8px apart, rows 36px apart). */
const layout = (widths: number[], width: number): ChipBox[] => {
  const out: ChipBox[] = [];
  let x = 0;
  let y = 0;
  for (const w of widths) {
    if (x > 0 && x + w > width) { x = 0; y += 36; }
    out.push({ top: y, left: x, width: w, height: 28 });
    x += w + 8;
  }
  return out;
};

describe('chipAcross: Up and Down over the sport chips as they wrap', () => {
  // Row 0: 0 1 2 · row 1: 3 4 5 · row 2: 6
  const grid = layout([100, 100, 100, 100, 100, 100, 100], 330);

  it('Down goes to the chip below, the nearest across', () => {
    expect(grid.map((b) => b.top)).toEqual([0, 0, 0, 36, 36, 36, 72]);
    expect(chipAcross(grid, 0, 1)).toBe(3);
    expect(chipAcross(grid, 2, 1)).toBe(5);
    expect(chipAcross(grid, 4, 1)).toBe(6);
  });

  it('Up goes to the chip above', () => {
    expect(chipAcross(grid, 6, -1)).toBe(3);
    expect(chipAcross(grid, 5, -1)).toBe(2);
    expect(chipAcross(grid, 4, -1)).toBe(1);
  });

  it('none past the first and the last row (the screen then leaves the chips)', () => {
    expect(chipAcross(grid, 1, -1)).toBe(-1);
    expect(chipAcross(grid, 6, 1)).toBe(-1);
  });

  it('chips of different widths: the one under the middle', () => {
    // Row 0: "All" (40), "PPV" (50), "College Football" (160) · row 1: "NBA" (50), "Premier League" (140), "NHL" (50)
    const mixed = layout([40, 50, 160, 50, 140, 50], 300);
    expect(mixed.map((b) => b.top)).toEqual([0, 0, 0, 36, 36, 36]);
    // Middles: row 0 at 20, 73, 186; row 1 at 25, 128, 231.
    expect(chipAcross(mixed, 2, 1)).toBe(5);
    expect(chipAcross(mixed, 0, 1)).toBe(3);
    expect(chipAcross(mixed, 4, -1)).toBe(1);
    expect(chipAcross(mixed, 5, -1)).toBe(2);
  });

  it('one row, or chips not drawn (no size): nowhere to go', () => {
    const row = layout([100, 100, 100], 1000);
    expect(chipAcross(row, 1, 1)).toBe(-1);
    expect(chipAcross(row, 1, -1)).toBe(-1);
    const flat = [0, 1, 2].map(() => ({ top: 0, left: 0, width: 0, height: 0 }));
    expect(chipAcross(flat, 0, 1)).toBe(-1);
    expect(chipAcross([], 0, 1)).toBe(-1);
    expect(chipAcrossIn(null, 0, 1)).toBe(-1);
  });
});
