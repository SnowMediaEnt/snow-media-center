import { describe, expect, it } from 'vitest';
import {
  LAYOUT_ORDER, LAYOUT_TILE_COUNT, MAIN_TILE, SMALL_MIN_SHARE,
  layoutNeighbor, okSwapsIntoMain, soundTile, threeArrangement, threeHintPlace, threeScreenPx, tilesForLayout,
  type Layout,
} from './multiScreenLayout';

const pct = (s: string) => Number(s.replace('%', ''));

// Every layout (owner, 2026-10-11, from Tronix 89c42b3: "making the screens
// larger"): its screens 16:9 and as large as the grid allows, inside it, no
// overlap. On a TV the grid is the whole screen while screens play (the
// header and side menu step aside); with them showing it is the rest.
type R = { x: number; y: number; w: number; h: number };
const toPx = (box: { width: number; height: number }, rect: { left: string; top: string; width: string; height: string }): R => ({
  x: (pct(rect.left) / 100) * box.width,
  y: (pct(rect.top) / 100) * box.height,
  w: (pct(rect.width) / 100) * box.width,
  h: (pct(rect.height) / 100) * box.height,
});
const px = (layout: Layout, box: { width: number; height: number }): R[] => tilesForLayout(layout, box).map(({ rect }) => toPx(box, rect));
const overlap = (a: R, b: R) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
// The Fire TV Cube's 960x540 css viewport with the Player's header (57 px)
// and side menu (48 px folded, 176 px open) showing or stepped aside, a
// 1080p viewport, and a few more shapes besides.
const BOXES = {
  'TV 960x540, whole screen': { width: 960, height: 540 },
  'TV 960x540, header and folded side menu': { width: 912, height: 483 },
  'TV 960x540, header and open side menu': { width: 784, height: 483 },
  'TV 1920x1080, whole screen': { width: 1920, height: 1080 },
  'tablet sideways': { width: 1104, height: 743 },
  'tablet 4:3 sideways': { width: 940, height: 690 },
  'phone sideways': { width: 752, height: 337 },
  'a square grid': { width: 700, height: 700 },
};
const fits = (box: { width: number; height: number }, rects: R[]) => {
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(-0.01);
    expect(r.y).toBeGreaterThanOrEqual(-0.01);
    expect(r.x + r.w).toBeLessThanOrEqual(box.width + 0.01);
    expect(r.y + r.h).toBeLessThanOrEqual(box.height + 0.01);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1);
  }
  rects.forEach((a, i) => rects.forEach((b, j) => { if (j > i) expect(overlap(a, b)).toBe(false); }));
};

describe('Multi-Screen layouts', () => {
  it('offers 2 side by side, 2 stacked, 3 (one big, two small) and 4', () => {
    expect(LAYOUT_ORDER).toEqual(['2h', '2v', '3', '4']);
    for (const l of LAYOUT_ORDER) {
      expect(tilesForLayout(l)).toHaveLength(LAYOUT_TILE_COUNT[l]);
      expect(tilesForLayout(l, { width: 960, height: 540 })).toHaveLength(LAYOUT_TILE_COUNT[l]);
    }
  });

  it('3 screens: one big centred screen on top, two small ones side by side under it', () => {
    const [main, a, b] = tilesForLayout('3');
    expect(pct(main.rect.left) + pct(main.rect.width) / 2).toBeCloseTo(50, 3); // centred
    expect(pct(main.rect.height)).toBeGreaterThan(pct(a.rect.height));
    expect(pct(a.rect.top)).toBeCloseTo(pct(main.rect.top) + pct(main.rect.height), 3);
    expect(pct(b.rect.top)).toBe(pct(a.rect.top));
    expect(pct(b.rect.left)).toBeCloseTo(pct(a.rect.left) + pct(a.rect.width), 3);
    expect(pct(a.rect.left) + (pct(a.rect.width) + pct(b.rect.width)) / 2).toBeCloseTo(50, 3); // the pair centred too
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

  it('3 screens with the small ones beside the big one (a phone sideways): ▶ to them, ▲ ▼ between them, ◀ back', () => {
    expect(layoutNeighbor('3', MAIN_TILE, 'right', 'right')).toBe(1);
    expect(layoutNeighbor('3', MAIN_TILE, 'down', 'right')).toBeNull();
    expect(layoutNeighbor('3', 1, 'down', 'right')).toBe(2);
    expect(layoutNeighbor('3', 2, 'up', 'right')).toBe(1);
    expect(layoutNeighbor('3', 2, 'left', 'right')).toBe(MAIN_TILE);
    expect(layoutNeighbor('3', 1, 'up', 'right')).toBeNull();
    expect(layoutNeighbor('3', 1, 'right', 'right')).toBeNull();
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

describe('every layout fills the grid with 16:9 screens', () => {
  for (const [name, box] of Object.entries(BOXES)) {
    it(`${name}: inside, no overlap, 16:9, as large as the grid allows`, () => {
      const two = px('2h', box);
      fits(box, two);
      // Side by side: the width or the height is used up.
      // Within a px: the edges are whole px.
      expect(Math.abs(two[0].w * 2 - box.width) <= 1.01 || Math.abs(two[0].h - box.height) <= 1.01).toBe(true);
      const stacked = px('2v', box);
      fits(box, stacked);
      expect(Math.abs(stacked[0].h * 2 - box.height) <= 1.01 || Math.abs(stacked[0].w - box.width) <= 1.01).toBe(true);
      const four = px('4', box);
      fits(box, four);
      expect(Math.abs(four[0].w * 2 - box.width) <= 1.01 || Math.abs(four[0].h * 2 - box.height) <= 1.01).toBe(true);
      const three = px('3', box);
      fits(box, three);
      // The small screens keep a quarter of the width each.
      expect(three[1].w).toBeGreaterThanOrEqual(SMALL_MIN_SHARE * box.width - 1);
      expect(Math.abs(three[2].w - three[1].w)).toBeLessThanOrEqual(1);
    });
  }

  it('the Fire TV, whole screen (960x540 css): four 480x270; two 480x270 side by side or stacked; three: 720x405 on top, two 240x135 under it', () => {
    const tv = { width: 960, height: 540 };
    const round = (r: R) => [r.x, r.y, r.w, r.h].map(Math.round);
    expect(px('4', tv).map(round)).toEqual([[0, 0, 480, 270], [480, 0, 480, 270], [0, 270, 480, 270], [480, 270, 480, 270]]);
    expect(px('2h', tv).map(round)).toEqual([[0, 135, 480, 270], [480, 135, 480, 270]]);
    expect(px('2v', tv).map(round)).toEqual([[240, 0, 480, 270], [240, 270, 480, 270]]);
    expect(px('3', tv).map(round)).toEqual([[120, 0, 720, 405], [240, 405, 240, 135], [480, 405, 240, 135]]);
    expect(threeArrangement(tv)).toBe('below');
  });

  it('a 1080p TV, whole screen: 3 screens is 1440x810 with two 480x270 under it', () => {
    const [big, left, right] = px('3', { width: 1920, height: 1080 });
    expect([big.x, big.y, big.w, big.h].map(Math.round)).toEqual([240, 0, 1440, 810]);
    expect([left.x, left.y, left.w, left.h].map(Math.round)).toEqual([480, 810, 480, 270]);
    expect([right.x, right.y].map(Math.round)).toEqual([960, 810]);
  });

  it('3 screens: the arrangement with the bigger big screen (under it on a TV; beside it on a phone sideways)', () => {
    for (const [W, H] of [[960, 540], [912, 483], [784, 483], [1920, 1080], [1104, 743]]) {
      expect(threeScreenPx(W, H).arrangement).toBe('below');
    }
    const phone = threeScreenPx(752, 337);
    expect(phone.arrangement).toBe('right');
    const [big, top, bottom] = phone.rects;
    expect(top.x).toBeCloseTo(big.x + big.w, 3);
    expect(bottom.y).toBeCloseTo(top.y + top.h, 3);
    // Bigger than the big screen with the small ones under it would be.
    expect(big.w).toBeGreaterThan(411);
    expect(threeArrangement({ width: 752, height: 337 })).toBe('right');
    expect(threeArrangement(undefined)).toBe('below');
  });

  it('without a size yet: the old shares (2 and 4) and a 16:9 grid (3)', () => {
    expect(tilesForLayout('2h')[0].rect).toEqual({ left: '0%', top: '0%', width: '50%', height: '100%' });
    expect(tilesForLayout('4')[3].rect).toEqual({ left: '50%', top: '50%', width: '50%', height: '50%' });
    expect(tilesForLayout('3')).toEqual(tilesForLayout('3', { width: 1600, height: 900 }));
    expect(tilesForLayout('3', { width: 0, height: 0 })).toEqual(tilesForLayout('3'));
  });

  it('neighbours meet exactly: the left small screen ends where the right one starts', () => {
    const t = tilesForLayout('3', { width: 912, height: 483 });
    expect(pct(t[1].rect.left) + pct(t[1].rect.width)).toBeCloseTo(pct(t[2].rect.left), 6);
  });
});

describe('3 screens: the swap hint', () => {
  it('sits in the free corner beside the small screens, over none of them', () => {
    for (const box of [{ width: 960, height: 540 }, { width: 784, height: 483 }, { width: 912, height: 483 }]) {
      const place = threeHintPlace(box);
      expect(place).not.toBeNull();
      const hint = toPx(box, place!);
      for (const r of px('3', box)) expect(overlap(hint, r)).toBe(false);
      expect(hint.w).toBeGreaterThanOrEqual(96);
    }
    // The Fire TV, whole screen: 240x135 under the big screen, left of the small ones.
    const hint = toPx({ width: 960, height: 540 }, threeHintPlace({ width: 960, height: 540 })!);
    expect([hint.x, hint.y, hint.w, hint.h].map(Math.round)).toEqual([0, 405, 240, 135]);
  });

  it('none where there is no room for it', () => {
    expect(threeHintPlace({ width: 700, height: 700 })).toBeNull();
  });
});
