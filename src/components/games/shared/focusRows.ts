/**
 * Availability-aware D-pad movement over a small, explicit focus graph.
 *
 * Every game hands in its rows already filtered down to the targets a player
 * can actually use right now, so the remote can never land on an
 * aria-disabled control (an unaffordable chip, a bet stepper at its bound, a
 * Spin the player cannot pay for, or a disabled post-settle action).
 */
export type FocusRows = string[][];
export type FocusDir = 'left' | 'right' | 'up' | 'down';

const locate = (rows: FocusRows, id: string): [number, number] | null => {
  for (let r = 0; r < rows.length; r += 1) {
    const c = rows[r].indexOf(id);
    if (c >= 0) return [r, c];
  }
  return null;
};

/** First usable target anywhere in the graph, or null when nothing is usable. */
export const firstUsable = (rows: FocusRows): string | null => {
  for (const row of rows) if (row.length > 0) return row[0];
  return null;
};

/** The neighbour in `dir`, or null when the move is not possible. */
export const moveInRows = (rows: FocusRows, current: string, dir: FocusDir): string | null => {
  const filled = rows.filter((row) => row.length > 0);
  const at = locate(filled, current);
  if (!at) return firstUsable(filled);
  const [row, col] = at;
  if (dir === 'left') return col > 0 ? filled[row][col - 1] : null;
  if (dir === 'right') return col < filled[row].length - 1 ? filled[row][col + 1] : null;
  const nextRow = dir === 'down' ? row + 1 : row - 1;
  if (nextRow < 0 || nextRow >= filled.length) return null;
  const target = filled[nextRow];
  // Keep the horizontal position as closely as the shorter row allows.
  return target[Math.min(col, target.length - 1)];
};

/**
 * Re-home focus after a phase or availability change: keep the current target
 * when it is still usable, otherwise fall back to the same row, then anywhere.
 */
export const rehome = (rows: FocusRows, current: string): string | null => {
  const filled = rows.filter((row) => row.length > 0);
  if (filled.some((row) => row.includes(current))) return current;
  return firstUsable(filled);
};
