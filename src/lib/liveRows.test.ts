import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LIVE_ROW_SIZE_KEY, SLIM_ROW_SLOT, loadLiveRowSize, saveLiveRowSize, useLiveRowSize } from './liveRows';

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
    expect(Math.floor(411 / 60)).toBe(6);
    expect(Math.floor(282 / SLIM_ROW_SLOT)).toBe(7);
  });
});
