import { describe, expect, it } from 'vitest';
import { LAYOUT_ORDER, LAYOUT_TILE_COUNT, MAIN_TILE, layoutNeighbor, okSwapsIntoMain, soundTile, tilesForLayout } from './multiScreenLayout';

const pct = (s: string) => Number(s.replace('%', ''));

describe('Multi-Screen layouts', () => {
  it('offers 2 side by side, 2 stacked, 3 (one big, two small) and 4', () => {
    expect(LAYOUT_ORDER).toEqual(['2h', '2v', '3', '4']);
    for (const l of LAYOUT_ORDER) expect(tilesForLayout(l)).toHaveLength(LAYOUT_TILE_COUNT[l]);
  });

  it('3 screens: one big centred screen on top, two small ones under it, the same width together', () => {
    const [main, a, b] = tilesForLayout('3');
    expect(pct(main.rect.left) + pct(main.rect.width) / 2).toBe(50); // centred
    expect(pct(main.rect.height)).toBeGreaterThan(pct(a.rect.height));
    expect(pct(a.rect.top)).toBe(pct(main.rect.height));
    expect(pct(a.rect.width) + pct(b.rect.width)).toBe(pct(main.rect.width));
    expect(pct(a.rect.left)).toBe(pct(main.rect.left));
    expect(pct(b.rect.left)).toBe(pct(a.rect.left) + pct(a.rect.width));
    expect(new Set([main.id, a.id, b.id]).size).toBe(3);
  });

  it('3 screens: ↓ from the big one lands on a small one, ◀ ▶ between them, ▲ back up', () => {
    expect(layoutNeighbor('3', MAIN_TILE, 'down')).toBe(1);
    expect(layoutNeighbor('3', MAIN_TILE, 'left')).toBeNull();
    expect(layoutNeighbor('3', MAIN_TILE, 'right')).toBeNull();
    expect(layoutNeighbor('3', 1, 'right')).toBe(2);
    expect(layoutNeighbor('3', 2, 'left')).toBe(1);
    expect(layoutNeighbor('3', 1, 'up')).toBe(MAIN_TILE);
    expect(layoutNeighbor('3', 2, 'up')).toBe(MAIN_TILE);
    expect(layoutNeighbor('3', 2, 'right')).toBeNull();
  });

  it('3 screens: the big one keeps the sound whichever tile is highlighted; other layouts follow the highlight', () => {
    expect(soundTile('3', 2)).toBe(MAIN_TILE);
    expect(soundTile('4', 3)).toBe(3);
    expect(soundTile('2h', 1)).toBe(1);
  });

  it('OK swaps only from a small screen of the 3-screen layout', () => {
    expect(okSwapsIntoMain('3', 1)).toBe(true);
    expect(okSwapsIntoMain('3', 2)).toBe(true);
    expect(okSwapsIntoMain('3', MAIN_TILE)).toBe(false);
    expect(okSwapsIntoMain('4', 1)).toBe(false);
  });

  it('the 4 grid and the 2-screen layouts move as before', () => {
    expect(layoutNeighbor('4', 0, 'right')).toBe(1);
    expect(layoutNeighbor('4', 0, 'down')).toBe(2);
    expect(layoutNeighbor('4', 3, 'up')).toBe(1);
    expect(layoutNeighbor('2h', 0, 'right')).toBe(1);
    expect(layoutNeighbor('2v', 0, 'down')).toBe(1);
    expect(layoutNeighbor('2v', 0, 'right')).toBeNull();
  });
});
