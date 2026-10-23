import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLASSIC_ROW_SLOT, COMPACT_ROW_SLOT, LIVE_ROW_SIZE_KEY, SLIM_ROW_SLOT, UPRIGHT_ROW_SLOT, listRowSlot, loadLiveRowSize, saveLiveRowSize, useLiveRowSize } from './liveRows';

beforeEach(() => localStorage.clear());

describe('Live TV channel rows (Normal / Slim)', () => {
  it('is Normal until Slim is chosen, and remembers the choice on the box', () => {
    expect(loadLiveRowSize()).toBe('normal');
    saveLiveRowSize('slim');
    expect(localStorage.getItem(LIVE_ROW_SIZE_KEY)).toBe('slim');
    expect(loadLiveRowSize()).toBe('slim');
    localStorage.setItem(LIVE_ROW_SIZE_KEY, 'huge');
    expect(loadLiveRowSize()).toBe('normal');
  });

  it('changes live: the list redraws when Settings saves another size', () => {
    const { result } = renderHook(() => useLiveRowSize());
    expect(result.current).toBe('normal');
    act(() => saveLiveRowSize('slim'));
    expect(result.current).toBe('slim');
    act(() => saveLiveRowSize('normal'));
    expect(result.current).toBe('normal');
  });

  it('fits about ten slim rows in the Compact column at 960x540', () => {
    // The Compact column's rows get 411px there (435px less its 12px padding
    // above and below); Classic's, under its preview, 282px.
    expect(Math.floor(411 / SLIM_ROW_SLOT)).toBeGreaterThanOrEqual(10);
    expect(Math.floor(282 / SLIM_ROW_SLOT)).toBe(7);
  });

  it('Normal rows are about a third thinner: 5+ Classic rows under the preview (was 3.4), 8+ in Compact (was 6.8)', () => {
    expect(listRowSlot('classic')).toBe(CLASSIC_ROW_SLOT);
    expect(listRowSlot('compact')).toBe(COMPACT_ROW_SLOT);
    expect(282 / CLASSIC_ROW_SLOT).toBeGreaterThanOrEqual(5);
    expect(282 / 84).toBeLessThan(3.5);
    expect(1 - CLASSIC_ROW_SLOT / 84).toBeGreaterThanOrEqual(0.3);
    expect(Math.floor(411 / COMPACT_ROW_SLOT)).toBeGreaterThanOrEqual(8);
    expect(1 - COMPACT_ROW_SLOT / 60).toBeGreaterThanOrEqual(0.2);
  });

  it('Slim stays thinner than Normal in both layouts; a phone held upright keeps its finger-sized row', () => {
    expect(listRowSlot('classic', { slim: true })).toBe(SLIM_ROW_SLOT);
    expect(listRowSlot('compact', { slim: true })).toBe(SLIM_ROW_SLOT);
    expect(SLIM_ROW_SLOT).toBeLessThan(COMPACT_ROW_SLOT);
    expect(SLIM_ROW_SLOT).toBeLessThan(CLASSIC_ROW_SLOT);
    expect(listRowSlot('compact', { upright: true })).toBe(UPRIGHT_ROW_SLOT);
    expect(UPRIGHT_ROW_SLOT).toBe(60);
  });
});
