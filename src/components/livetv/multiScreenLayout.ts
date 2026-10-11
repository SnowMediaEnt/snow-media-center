// Where each Multi-Screen tile sits, which tile the remote's arrows move to,
// and which tile has the sound. Pure, so it can be tested without the native
// players.
//
//   2h  two side by side        2v  two stacked        4  a 2x2 grid
//   3   one big screen on top, two small ones under it (dealers, 2026-10-10:
//       "watching one, monitoring two others"; most boxes can't keep four
//       streams going anyway). The big one always has the sound; OK on a
//       small one swaps it into the big one.
//
// Every layout makes its screens 16:9 and as large as the grid allows, the
// block centred (owner, 2026-10-11, as in Tronix 89c42b3: on a TV the
// Player's header and side menu step aside while screens play, so the grid
// is the whole screen).
import type { MultiScreenId } from '@/hooks/useMultiScreenPlayers';

export type Layout = '2h' | '2v' | '3' | '4';
export type Dir = 'up' | 'down' | 'left' | 'right';

export interface TileSpec {
  id: MultiScreenId;
  rect: { left: string; top: string; width: string; height: string };
}

/** The grid's size in CSS px. */
export interface GridBox { width: number; height: number }

export const LAYOUT_TILE_COUNT: Record<Layout, number> = { '2h': 2, '2v': 2, '3': 3, '4': 4 };

/** The picker's order. */
export const LAYOUT_ORDER: Layout[] = ['2h', '2v', '3', '4'];

/** The big screen in the 3-screen layout. */
export const MAIN_TILE = 0;

// Places are worked out in px and handed to the tiles as shares of the grid,
// rounded to millionths so neighbours meet exactly (one's right edge is the
// next one's left).
const UNITS = 1_000_000;
const pct = (u: number) => `${(u / 10_000).toFixed(4)}%`;
type Px = { x: number; y: number; w: number; h: number };
const toSpecs = (ids: readonly MultiScreenId[], rects: Px[], W: number, H: number): TileSpec[] => {
  const x = (v: number) => Math.round((v / W) * UNITS);
  const y = (v: number) => Math.round((v / H) * UNITS);
  return rects.map((r, i) => {
    const [l, t, rr, b] = [x(r.x), y(r.y), x(r.x + r.w), y(r.y + r.h)];
    return { id: ids[i], rect: { left: pct(l), top: pct(t), width: pct(rr - l), height: pct(b - t) } };
  });
};
const sized = (box?: GridBox): box is GridBox => !!box && box.width > 0 && box.height > 0;

/** "3 screens": the smallest a small screen gets, as a share of the grid's
 *  width (still a screen to watch, not a stamp). */
export const SMALL_MIN_SHARE = 0.25;

// The small screens go beside the big one only when that makes it clearly
// larger (a phone sideways): on a TV, with or without the side menu, the big
// screen stays on top, and the remote's ▼ / ▲ stay as they are.
const RIGHT_IF_BIGGER = 1.15;

/** "3 screens", in CSS px: both arrangements (the two small screens under
 *  the big one, or stacked on its right), each with the big screen as large
 *  as it can be while the small ones keep SMALL_MIN_SHARE of the width; the
 *  one whose big screen is larger wins (under, on a tie). */
export const threeScreenPx = (W: number, H: number): { arrangement: 'below' | 'right'; rects: Px[] } => {
  const minS = SMALL_MIN_SHARE * W;
  // Below: the big one on top, the small ones side by side under it.
  let bH = Math.min(H - (minS * 9) / 16, (W * 9) / 16);
  let bW = (bH * 16) / 9;
  let sW = Math.min(W / 2, ((H - bH) * 16) / 9);
  let sH = (sW * 9) / 16;
  const below = { bW, bH, sW, sH };
  // Right: the big one on the left, the small ones one over the other beside it.
  bW = Math.min(W - minS, (H * 16) / 9);
  bH = (bW * 9) / 16;
  sW = Math.min(W - bW, ((H / 2) * 16) / 9);
  sH = (sW * 9) / 16;
  const right = { bW, bH, sW, sH };
  if (right.bW > below.bW * RIGHT_IF_BIGGER) {
    const { bW: w, bH: h, sW: s, sH: t } = right;
    const left = (W - w - s) / 2;
    const tall = Math.max(h, 2 * t);
    const top = (H - tall) / 2;
    const bigTop = top + (tall - h) / 2;
    const smallTop = top + (tall - 2 * t) / 2;
    return { arrangement: 'right', rects: [
      { x: left, y: bigTop, w, h },
      { x: left + w, y: smallTop, w: s, h: t },
      { x: left + w, y: smallTop + t, w: s, h: t },
    ] };
  }
  const { bW: w, bH: h, sW: s, sH: t } = below;
  const top = (H - h - t) / 2;
  const bigLeft = (W - w) / 2;
  const smallLeft = (W - 2 * s) / 2;
  return { arrangement: 'below', rects: [
    { x: bigLeft, y: top, w, h },
    { x: smallLeft, y: top + h, w: s, h: t },
    { x: smallLeft + s, y: top + h, w: s, h: t },
  ] };
};

/** Where "3 screens" puts its small screens on this grid. */
export const threeArrangement = (box?: GridBox): 'below' | 'right' =>
  (sized(box) ? threeScreenPx(box.width, box.height).arrangement : 'below');

// Before the grid is measured (its first frame), "3 screens" is laid out as
// on a 16:9 grid.
const DEFAULT_GRID: GridBox = { width: 1600, height: 900 };

/** "3 screens": the free corner beside the small screens, in shares of the
 *  grid, where the swap hint goes; null when there is no room for it. */
export function threeHintPlace(box?: GridBox): TileSpec['rect'] | null {
  const { width: W, height: H } = sized(box) ? box : DEFAULT_GRID;
  const { arrangement, rects } = threeScreenPx(W, H);
  const [big, small, last] = rects;
  // Under the big screen, left of the small ones; or, with the small ones
  // beside it, under them.
  const r: Px = arrangement === 'below'
    ? { x: 0, y: big.y + big.h, w: small.x, h: H - (big.y + big.h) }
    : { x: small.x, y: last.y + last.h, w: W - small.x, h: H - (last.y + last.h) };
  if (r.w < 96 || r.h < 40) return null;
  return toSpecs(['ms1'], [r], W, H)[0].rect;
}

/** 2 side by side, 2 stacked, the 2x2 grid: equal 16:9 screens in a row, a
 *  column or a grid, as large as the grid allows, the block centred. */
const evenScreens = (cols: number, rows: number, ids: readonly MultiScreenId[], box: GridBox): TileSpec[] => {
  const { width: W, height: H } = box;
  const w = Math.min(W / cols, ((H / rows) * 16) / 9);
  const h = (w * 9) / 16;
  const left = (W - cols * w) / 2;
  const top = (H - rows * h) / 2;
  const rects: Px[] = ids.map((_, i) => ({ x: left + (i % cols) * w, y: top + Math.floor(i / cols) * h, w, h }));
  return toSpecs(ids, rects, W, H);
};

/** Each tile's place on a grid of this size. Without one (the first frame,
 *  before it is measured) the 2-screen layouts and the grid are plain
 *  shares of it. The ids (which player each tile is) never depend on it. */
export function tilesForLayout(layout: Layout, box?: GridBox): TileSpec[] {
  if (layout === '3') {
    const { width: W, height: H } = sized(box) ? box : DEFAULT_GRID;
    return toSpecs(['ms1', 'ms2', 'ms3'], threeScreenPx(W, H).rects, W, H);
  }
  if (sized(box)) {
    if (layout === '2h') return evenScreens(2, 1, ['ms1', 'ms2'], box);
    if (layout === '2v') return evenScreens(1, 2, ['ms1', 'ms2'], box);
    return evenScreens(2, 2, ['ms1', 'ms2', 'ms3', 'ms4'], box);
  }
  if (layout === '2h') {
    return [
      { id: 'ms1', rect: { left: '0%', top: '0%', width: '50%', height: '100%' } },
      { id: 'ms2', rect: { left: '50%', top: '0%', width: '50%', height: '100%' } },
    ];
  }
  if (layout === '2v') {
    return [
      { id: 'ms1', rect: { left: '0%', top: '0%', width: '100%', height: '50%' } },
      { id: 'ms2', rect: { left: '0%', top: '50%', width: '100%', height: '50%' } },
    ];
  }
  return [
    { id: 'ms1', rect: { left: '0%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms2', rect: { left: '50%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms3', rect: { left: '0%', top: '50%', width: '50%', height: '50%' } },
    { id: 'ms4', rect: { left: '50%', top: '50%', width: '50%', height: '50%' } },
  ];
}

/** The tile an arrow moves to, or null at an edge. `three`: where "3
 *  screens" has put its small screens (threeArrangement). */
export function layoutNeighbor(layout: Layout, idx: number, dir: Dir, three: 'below' | 'right' = 'below'): number | null {
  if (layout === '2h') {
    if (dir === 'left' && idx === 1) return 0;
    if (dir === 'right' && idx === 0) return 1;
    return null;
  }
  if (layout === '2v') {
    if (dir === 'up' && idx === 1) return 0;
    if (dir === 'down' && idx === 0) return 1;
    return null;
  }
  if (layout === '3' && three === 'right') {
    // The big screen with the small ones on its right (1 over 2): ▶ from the
    // big one to the top small one, ▲ ▼ between them, ◀ back.
    if (idx === MAIN_TILE) return dir === 'right' ? 1 : null;
    if (dir === 'left') return MAIN_TILE;
    if (dir === 'down' && idx === 1) return 2;
    if (dir === 'up' && idx === 2) return 1;
    return null;
  }
  if (layout === '3') {
    if (idx === MAIN_TILE) return dir === 'down' ? 1 : null;
    if (dir === 'up') return MAIN_TILE;
    if (dir === 'right' && idx === 1) return 2;
    if (dir === 'left' && idx === 2) return 1;
    return null;
  }
  // 4 grid: 0 1 / 2 3
  const row = idx < 2 ? 0 : 1;
  const col = idx % 2;
  let r = row, c = col;
  if (dir === 'up') r = Math.max(0, row - 1);
  else if (dir === 'down') r = Math.min(1, row + 1);
  else if (dir === 'left') c = Math.max(0, col - 1);
  else if (dir === 'right') c = Math.min(1, col + 1);
  const n = r * 2 + c;
  return n === idx ? null : n;
}

/** The tile whose sound plays: the big screen in the 3-screen layout,
 *  otherwise the highlighted one ("audio follows the highlighter"). */
export function soundTile(layout: Layout, focused: number): number {
  return layout === '3' ? MAIN_TILE : focused;
}

/** OK on this tile swaps it into the big screen (a small screen of the
 *  3-screen layout); everywhere else OK opens the tile's menu or picker. */
export function okSwapsIntoMain(layout: Layout, idx: number): boolean {
  return layout === '3' && idx !== MAIN_TILE;
}
