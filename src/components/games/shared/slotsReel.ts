/**
 * Slots reel geometry.
 *
 * Each reel renders a bounded, recycled strip: 12 unique cells plus 3 clones of
 * the first three, which makes a wrap at exactly 12 cells visually seamless
 * (the window shows cells 12,13,14 — identical to 0,1,2 — right as the position
 * resets). Motion is therefore unbounded in distance while the DOM stays at 15
 * nodes per reel, and it always travels in ONE direction: position only ever
 * increases, including through the deceleration onto the committed symbols.
 */
export const REELS = 5;
export const ROWS = 3;
export const CYCLE_CELLS = 12;
export const CLONE_CELLS = ROWS;
export const RENDER_CELLS = CYCLE_CELLS + CLONE_CELLS; // 15 nodes per reel
/** Minimum travel, in cell heights, before a reel may settle. */
export const MIN_TRAVEL_CELLS = 6;
/** How far ahead of the visible window a committed column is written. */
export const LANDING_LEAD_CELLS = 6;

export const SYMBOL_KEYS = [
  'p1', 'p2', 'p3', 'p4', 'la', 'lk', 'lq', 'lj', 'wild', 'scatter',
  'relic_red', 'relic_blue', 'relic_yellow',
] as const;
export type SymbolKey = typeof SYMBOL_KEYS[number];

const SYMBOL_SET = new Set<string>(SYMBOL_KEYS);
export const isSymbolKey = (value: unknown): value is SymbolKey =>
  typeof value === 'string' && SYMBOL_SET.has(value);

export const randomSymbol = (): SymbolKey => SYMBOL_KEYS[Math.floor(Math.random() * SYMBOL_KEYS.length)];

export const cyclePx = (cellHeight: number): number => CYCLE_CELLS * cellHeight;

/** A fresh strip of random symbols with its wrap clones already mirrored. */
export const buildCells = (pick: () => SymbolKey = randomSymbol): string[] => {
  const unique = Array.from({ length: CYCLE_CELLS }, pick);
  return [...unique, ...unique.slice(0, CLONE_CELLS)];
};

/**
 * Server payload guard: exactly ROWS rows of exactly REELS known symbol keys.
 * Anything else must never schedule a settle.
 */
export const validateGrid = (grid: unknown): grid is string[][] => {
  if (!Array.isArray(grid) || grid.length !== ROWS) return false;
  return grid.every((row) => Array.isArray(row) && row.length === REELS && row.every(isSymbolKey));
};

/** Row-major server grid → one column (top, middle, bottom) per reel. */
export const gridToColumns = (grid: string[][]): string[][] =>
  Array.from({ length: REELS }, (_, reel) => Array.from({ length: ROWS }, (_, row) => grid[row][reel]));

/** Index, 6 cells ahead of the visible window, where a column may be written. */
export const pickLandingIndex = (pos: number, cellHeight: number): number => {
  const top = Math.floor(pos / cellHeight);
  return (((top + LANDING_LEAD_CELLS) % CYCLE_CELLS) + CYCLE_CELLS) % CYCLE_CELLS;
};

/** Write a committed column at `landingIndex`, keeping the wrap clones in sync. */
export const withLanding = (cells: string[], landingIndex: number, column: string[]): string[] => {
  const out = [...cells];
  for (let row = 0; row < ROWS; row += 1) {
    const idx = (landingIndex + row) % CYCLE_CELLS;
    out[idx] = column[row];
    if (idx < CLONE_CELLS) out[CYCLE_CELLS + idx] = column[row];
  }
  return out;
};

/**
 * Smallest position greater than `pos + minTravel` that lands `landingIndex` at
 * the top of the window. Always forward, so the stop never reverses.
 */
export const computeSettleTarget = (
  pos: number,
  landingIndex: number,
  cellHeight: number,
  minTravelCells: number = MIN_TRAVEL_CELLS,
): number => {
  const cycle = cyclePx(cellHeight);
  const desired = landingIndex * cellHeight;
  const minimum = pos + minTravelCells * cellHeight;
  const turns = Math.ceil((minimum - desired) / cycle);
  return desired + turns * cycle;
};

/** The three symbols visible for a strip parked at `pos`. */
export const visibleSymbolsAt = (cells: string[], pos: number, cellHeight: number): string[] => {
  const cycle = cyclePx(cellHeight);
  const wrapped = ((pos % cycle) + cycle) % cycle;
  const top = Math.round(wrapped / cellHeight);
  return Array.from({ length: ROWS }, (_, row) => cells[(top + row) % CYCLE_CELLS]);
};

export interface SlotWin { symbol: string; count: number; payout: number }

/**
 * Win highlighting. A win of count N is a left-to-right line: it may only light
 * reels 0..N-1, never a matching symbol sitting on a later reel.
 */
export const winningCellsFor = (columns: string[][], wins: SlotWin[]): boolean[][] => {
  const lit = Array.from({ length: REELS }, () => Array<boolean>(ROWS).fill(false));
  wins.filter((win) => win.payout > 0 && win.count > 0).forEach((win) => {
    const reach = Math.min(win.count, REELS);
    for (let reel = 0; reel < reach; reel += 1) {
      for (let row = 0; row < ROWS; row += 1) {
        const symbol = columns[reel]?.[row];
        if (symbol === win.symbol || symbol === 'wild') lit[reel][row] = true;
      }
    }
  });
  return lit;
};
