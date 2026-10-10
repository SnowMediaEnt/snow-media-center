import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VIEW_SIZE, loadViewSize, saveViewSize, useViewSize } from './viewSize';
import { LIVE_LAYOUTS, loadLiveLayout, saveLiveLayout, stripInitial, tvWallLayout, tvWallMinTile, TV_WALL_NAME_H, TV_WALL_PAD } from './liveLayout';

beforeEach(() => { localStorage.clear(); });

describe('Guide and logo wall size', () => {
  it('Compact by default; Large once chosen; anything else is Compact', () => {
    expect(DEFAULT_VIEW_SIZE).toBe('compact');
    expect(loadViewSize()).toBe('compact');
    saveViewSize('large');
    expect(loadViewSize()).toBe('large');
    localStorage.setItem('snow-view-size', 'huge');
    expect(loadViewSize()).toBe('compact');
  });

  it('a change redraws whoever shows it', () => {
    const { result } = renderHook(() => useViewSize());
    expect(result.current).toBe('compact');
    act(() => saveViewSize('large'));
    expect(result.current).toBe('large');
  });
});

describe('the Guide as a Live TV layout', () => {
  it('is offered after the others, and kept once saved', () => {
    expect(LIVE_LAYOUTS.map((l) => l.id)).toEqual(['classic', 'compact', 'grid', 'guide']);
    saveLiveLayout('guide');
    expect(loadLiveLayout()).toBe('guide');
  });
});

describe('the logo wall drawn Compact', () => {
  const fullRows = (listH: number, rowH: number) => Math.floor((listH - 12 + 4) / rowH);

  it('the narrowest tile grows with the screen: 96px at 960, 120 at 1920 and up', () => {
    expect(tvWallMinTile(960)).toBe(96);
    expect(tvWallMinTile(1280)).toBe(104);
    expect(tvWallMinTile(1920)).toBe(120);
    expect(tvWallMinTile(0)).toBe(96);
  });

  it.each([
    ['960x540, categories open', 960, 632, 6],
    ['960x540, categories folded', 960, 832, 8],
    ['1920x1080, categories open', 1920, 1592, 12],
  ])('%s: square tiles fill the width', (_n, screenW, inner, cols) => {
    const l = tvWallLayout(inner, screenW)!;
    expect(l.cols).toBe(cols);
    expect(l.tileW * cols + l.gap * (cols - 1)).toBeCloseTo(inner, 6);
    const tileH = 2 + TV_WALL_PAD + (l.tileW - 2 - 2 * TV_WALL_PAD) + TV_WALL_NAME_H;
    expect(l.rowH - 8).toBeGreaterThanOrEqual(tileH);
    expect(l.rowH - 8 - tileH).toBeLessThan(1);
  });

  it('a full row more than the Large wall (5 tiles in 176px slots) at 960x540', () => {
    expect(fullRows(435, tvWallLayout(632, 960)!.rowH)).toBeGreaterThan(fullRows(435, 176));
  });

  it('not measured yet: nothing (the Large slots meanwhile)', () => {
    expect(tvWallLayout(0, 960)).toBeNull();
  });

  it('the folded strip shows the category initial', () => {
    expect(stripInitial('Events')).toBe('E');
    expect(stripInitial('| Local B')).toBe('L');
    expect(stripInitial('  ')).toBe('');
  });
});
