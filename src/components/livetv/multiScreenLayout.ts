// Where each Multi-Screen tile sits, which tile the remote's arrows move to,
// and which tile has the sound. Pure, so it can be tested without the native
// players.
//
//   2h  two side by side        2v  two stacked        4  a 2x2 grid
//   3   one big screen on top, two small ones under it (dealers, 2026-10-10:
//       "watching one, monitoring two others"; most boxes can't keep four
//       streams going anyway). The big one always has the sound; OK on a
//       small one swaps it into the big one.
import type { MultiScreenId } from '@/hooks/useMultiScreenPlayers';

export type Layout = '2h' | '2v' | '3' | '4';
export type Dir = 'up' | 'down' | 'left' | 'right';

export interface TileSpec {
  id: MultiScreenId;
  rect: { left: string; top: string; width: string; height: string };
}

export const LAYOUT_TILE_COUNT: Record<Layout, number> = { '2h': 2, '2v': 2, '3': 3, '4': 4 };

/** The picker's order. */
export const LAYOUT_ORDER: Layout[] = ['2h', '2v', '3', '4'];

/** The big screen in the 3-screen layout. */
export const MAIN_TILE = 0;

export function tilesForLayout(layout: Layout): TileSpec[] {
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
  if (layout === '3') {
    // Big and centred on top; the two small ones side by side under it,
    // together exactly as wide as the big one.
    return [
      { id: 'ms1', rect: { left: '15%', top: '0%', width: '70%', height: '65%' } },
      { id: 'ms2', rect: { left: '15%', top: '65%', width: '35%', height: '35%' } },
      { id: 'ms3', rect: { left: '50%', top: '65%', width: '35%', height: '35%' } },
    ];
  }
  return [
    { id: 'ms1', rect: { left: '0%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms2', rect: { left: '50%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms3', rect: { left: '0%', top: '50%', width: '50%', height: '50%' } },
    { id: 'ms4', rect: { left: '50%', top: '50%', width: '50%', height: '50%' } },
  ];
}

/** The tile an arrow moves to, or null at an edge. */
export function layoutNeighbor(layout: Layout, idx: number, dir: Dir): number | null {
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
