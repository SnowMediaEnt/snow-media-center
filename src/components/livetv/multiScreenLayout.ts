// Where each Multi-Screen tile sits, which tile the remote's arrows move to,
// and which tile has the sound. Pure, so it can be tested without the native
// players.
//
//   2h  two side by side        2v  two stacked        4  a 2x2 grid
//   3   one big screen on top, two small ones under it (dealers, 2026-10-10:
//       "watching one, monitoring two others"; most boxes can't keep four
//       streams going anyway). The big one always has the sound; OK on a
//       small one swaps it into the big one.
//   5   the same big screen with FOUR small ones along the bottom (owner,
//       2026-10-23: "i see there's space for like 2 more options down there
//       on the bottom"): on a 16:9 grid the 3-screen layout leaves exactly
//       two small screens' room either side of its pair. Same sound and swap
//       rules as 3. Five decoders at once is a lot for a 2 GB box: see
//       MultiScreenSection (the warning before the fifth).
//
// Every layout makes its screens 16:9 and as large as the grid allows, the
// block centred (owner, 2026-10-11, as in Tronix 89c42b3: on a TV the
// Player's header and side menu step aside while screens play, so the grid
// is the whole screen).
import type { MultiScreenId } from '@/hooks/useMultiScreenPlayers';

export type Layout = '2h' | '2v' | '3' | '4' | '5';
export type Dir = 'up' | 'down' | 'left' | 'right';
/** Where a big-screen layout (3 or 5) puts its small screens: under the big
 *  one, or in a column on its right. */
export type Arrangement = 'below' | 'right';

export interface TileSpec {
  id: MultiScreenId;
  rect: { left: string; top: string; width: string; height: string };
}

/** The grid's size in CSS px. */
export interface GridBox { width: number; height: number }

export const LAYOUT_TILE_COUNT: Record<Layout, number> = { '2h': 2, '2v': 2, '3': 3, '4': 4, '5': 5 };

/** The picker's order. */
export const LAYOUT_ORDER: Layout[] = ['2h', '2v', '3', '4', '5'];

/** The most screens any layout has (one native player each: ms1..ms5). */
export const MAX_TILES = 5;

/** The big screen in the 3- and 5-screen layouts. */
export const MAIN_TILE = 0;

/** One big screen with small ones beside it (3 and 5): the big one has the
 *  sound, OK on a small one swaps it in. */
export const hasBigScreen = (layout: Layout | null | undefined): layout is '3' | '5' => layout === '3' || layout === '5';

/** The small screens of a big-screen layout. */
const smallCount = (layout: '3' | '5'): 2 | 4 => (layout === '5' ? 4 : 2);

// Places are worked out in px, their edges rounded to whole px (each edge
// once, so a tile's bottom and the next one's top are the same number: the
// native players round every edge on their own, and two fractions either side
// of .5 left a 1 px line between rows), and handed to the tiles as shares of
// the grid, rounded to millionths so neighbours meet exactly.
const UNITS = 1_000_000;
const pct = (u: number) => `${(u / 10_000).toFixed(4)}%`;
type Px = { x: number; y: number; w: number; h: number };
const toSpecs = (ids: readonly MultiScreenId[], rects: Px[], W: number, H: number): TileSpec[] => {
  const x = (v: number) => Math.round((v / W) * UNITS);
  const y = (v: number) => Math.round((v / H) * UNITS);
  return rects.map((r, i) => {
    const [l, t, rr, b] = [x(Math.round(r.x)), y(Math.round(r.y)), x(Math.round(r.x + r.w)), y(Math.round(r.y + r.h))];
    return { id: ids[i], rect: { left: pct(l), top: pct(t), width: pct(rr - l), height: pct(b - t) } };
  });
};
const sized = (box?: GridBox): box is GridBox => !!box && box.width > 0 && box.height > 0;

/** "3 screens" and "5 screens": the smallest a small screen gets, as a share
 *  of the grid's width (still a screen to watch, not a stamp). With four of
 *  them along the bottom that is all the width there is. */
export const SMALL_MIN_SHARE = 0.25;

// The small screens go beside the big one only when that makes it clearly
// larger (a phone sideways): on a TV, with or without the side menu, the big
// screen stays on top, and the remote's ▼ / ▲ stay as they are.
const RIGHT_IF_BIGGER = 1.15;

/** A big screen and `n` small ones (2 or 4), in CSS px: both arrangements
 *  (the small screens side by side under the big one, or one over the other
 *  on its right), each with the big screen as large as it can be while the
 *  small ones keep SMALL_MIN_SHARE of the width; the one whose big screen is
 *  larger wins (under, on a tie). */
const bigPlusSmallPx = (W: number, H: number, n: 2 | 4): { arrangement: Arrangement; rects: Px[] } => {
  const minS = SMALL_MIN_SHARE * W;
  // Below: the big one on top, the small ones side by side under it.
  let bH = Math.min(H - (minS * 9) / 16, (W * 9) / 16);
  let bW = (bH * 16) / 9;
  let sW = Math.min(W / n, ((H - bH) * 16) / 9);
  let sH = (sW * 9) / 16;
  const below = { bW, bH, sW, sH };
  // Right: the big one on the left, the small ones one over the other beside it.
  bW = Math.min(W - minS, (H * 16) / 9);
  bH = (bW * 9) / 16;
  sW = Math.min(W - bW, ((H / n) * 16) / 9);
  sH = (sW * 9) / 16;
  const right = { bW, bH, sW, sH };
  const smalls = (x0: number, y0: number, dx: number, dy: number, w: number, h: number): Px[] =>
    Array.from({ length: n }, (_, i) => ({ x: x0 + i * dx, y: y0 + i * dy, w, h }));
  if (right.bW > below.bW * RIGHT_IF_BIGGER) {
    const { bW: w, bH: h, sW: s, sH: t } = right;
    const left = (W - w - s) / 2;
    const tall = Math.max(h, n * t);
    const top = (H - tall) / 2;
    const bigTop = top + (tall - h) / 2;
    const smallTop = top + (tall - n * t) / 2;
    return { arrangement: 'right', rects: [{ x: left, y: bigTop, w, h }, ...smalls(left + w, smallTop, 0, t, s, t)] };
  }
  const { bW: w, bH: h, sW: s, sH: t } = below;
  const top = (H - h - t) / 2;
  const bigLeft = (W - w) / 2;
  const smallLeft = (W - n * s) / 2;
  return { arrangement: 'below', rects: [{ x: bigLeft, y: top, w, h }, ...smalls(smallLeft, top + h, s, 0, s, t)] };
};

/** "3 screens", in CSS px: the big screen and two small ones (bigPlusSmallPx). */
export const threeScreenPx = (W: number, H: number): { arrangement: Arrangement; rects: Px[] } => bigPlusSmallPx(W, H, 2);

/** "5 screens", in CSS px: the big screen and four small ones (bigPlusSmallPx). */
export const fiveScreenPx = (W: number, H: number): { arrangement: Arrangement; rects: Px[] } => bigPlusSmallPx(W, H, 4);

/** Where "3 screens" puts its small screens on this grid. */
export const threeArrangement = (box?: GridBox): Arrangement =>
  (sized(box) ? threeScreenPx(box.width, box.height).arrangement : 'below');

/** Where a big-screen layout (3 or 5) puts its small screens on this grid
 *  ('below' for every other layout, where it means nothing). */
export const smallArrangement = (layout: Layout | null | undefined, box?: GridBox): Arrangement =>
  (hasBigScreen(layout) && sized(box) ? bigPlusSmallPx(box.width, box.height, smallCount(layout)).arrangement : 'below');

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

/** "5 screens": the free band beside the big screen (left of it, with the
 *  small ones under it; under it, with them on its right), where the swap
 *  hint goes; null when there is no room for it. "3 screens": threeHintPlace. */
export function swapHintPlace(layout: Layout | null | undefined, box?: GridBox): TileSpec['rect'] | null {
  if (layout === '3') return threeHintPlace(box);
  if (layout !== '5') return null;
  const { width: W, height: H } = sized(box) ? box : DEFAULT_GRID;
  const { arrangement, rects } = fiveScreenPx(W, H);
  const big = rects[MAIN_TILE];
  const r: Px = arrangement === 'below'
    ? { x: 0, y: big.y, w: big.x, h: big.h }
    : { x: big.x, y: big.y + big.h, w: big.w, h: H - (big.y + big.h) };
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
  if (layout === '5') {
    const { width: W, height: H } = sized(box) ? box : DEFAULT_GRID;
    return toSpecs(['ms1', 'ms2', 'ms3', 'ms4', 'ms5'], fiveScreenPx(W, H).rects, W, H);
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

/** The tile an arrow moves to, or null at an edge. `arrangement`: where "3
 *  screens" or "5 screens" has put its small screens on this grid
 *  (smallArrangement). */
export function layoutNeighbor(layout: Layout, idx: number, dir: Dir, arrangement: Arrangement = 'below'): number | null {
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
  if (hasBigScreen(layout)) {
    const last = smallCount(layout); // the small screens are 1..last
    // Along the small screens: ◀ ▶ in a row under the big one, ▲ ▼ in a
    // column on its right; across them, back to (or from) the big one.
    const [toBig, fromBig, prev, next]: Dir[] = arrangement === 'right'
      ? ['left', 'right', 'up', 'down']
      : ['up', 'down', 'left', 'right'];
    // From the big one: the first small screen (the left one, or the top one).
    if (idx === MAIN_TILE) return dir === fromBig ? 1 : null;
    if (dir === toBig) return MAIN_TILE;
    if (dir === next && idx < last) return idx + 1;
    if (dir === prev && idx > 1) return idx - 1;
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

/** The tile whose sound plays: the big screen in the 3- and 5-screen
 *  layouts, otherwise the highlighted one ("audio follows the highlighter"). */
export function soundTile(layout: Layout, focused: number): number {
  return hasBigScreen(layout) ? MAIN_TILE : focused;
}

/** OK on this tile swaps it into the big screen (a small screen of the 3- or
 *  5-screen layout); everywhere else OK opens the tile's menu or picker. */
export function okSwapsIntoMain(layout: Layout, idx: number): boolean {
  return hasBigScreen(layout) && idx !== MAIN_TILE;
}
