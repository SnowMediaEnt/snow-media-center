// Game Day's sport chips wrap onto several rows on a TV. Up and Down move
// between those rows, to the chip nearest across, and leave the chips only
// from the first row (Up) or the last (Down). Read from where the chips are
// drawn, so it follows the wrapping (and the one scrolling row on a phone).

export interface ChipBox { top: number; left: number; width: number; height: number }

/** The chip on the row above (`dir` -1) or below (1) chip `i`: the one whose
 *  middle is nearest across (the first of two as near). -1 when `i` is on the
 *  first (last) row, or the chips have no size (not drawn: one row). A chip
 *  is on another row when its middle is more than half a chip's height above
 *  or below. */
export function chipAcross(boxes: ChipBox[], i: number, dir: 1 | -1): number {
  const cur = boxes[i];
  if (!cur || !(cur.height > 0)) return -1;
  const mid = (b: ChipBox) => b.top + b.height / 2;
  const cy = mid(cur);
  const cx = cur.left + cur.width / 2;
  const tol = cur.height / 2;
  // The nearest row that way.
  let row: number | null = null;
  for (const b of boxes) {
    if (!b || !(b.height > 0)) continue;
    const y = mid(b);
    if ((y - cy) * dir > tol && (row === null || (y - row) * dir < 0)) row = y;
  }
  if (row === null) return -1;
  let best = -1;
  let bestDx = Infinity;
  boxes.forEach((b, j) => {
    if (!b || !(b.height > 0) || Math.abs(mid(b) - (row as number)) > tol) return;
    const dx = Math.abs(b.left + b.width / 2 - cx);
    if (dx < bestDx) { bestDx = dx; best = j; }
  });
  return best;
}

/** chipAcross for the chips drawn in `box` (each with `data-gd-chip`). */
export function chipAcrossIn(box: HTMLElement | null, i: number, dir: 1 | -1): number {
  if (!box) return -1;
  try {
    const els = box.querySelectorAll<HTMLElement>('[data-gd-chip]');
    return chipAcross(Array.from(els, (el) => el.getBoundingClientRect()), i, dir);
  } catch {
    return -1;
  }
}
