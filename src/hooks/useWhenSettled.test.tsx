// Live TV and the Guide ask for the programme info of the rows a list comes
// to rest on, not of every row a fling passes (QA SCR-02: 625 requests
// flicking 640 channels to the end, 239 of them again on the way back).
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROWS_SETTLE_MS, useWhenSettled } from './useWhenSettled';

const Probe = ({ k, run }: { k: string; run: (k: string) => void }) => {
  useWhenSettled(k, () => run(k));
  return null;
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useWhenSettled', () => {
  it('runs once the key has stayed the same for the settle time', () => {
    const run = vi.fn();
    render(<Probe k="rows 0-9" run={run} />);
    act(() => { vi.advanceTimersByTime(ROWS_SETTLE_MS - 1); });
    expect(run).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('rows 0-9');
  });

  it('a fling (the key changing every frame) asks for nothing until it stops, then only for where it stopped', () => {
    const run = vi.fn();
    const { rerender } = render(<Probe k="rows 0-9" run={run} />);
    for (let i = 1; i <= 60; i++) {
      rerender(<Probe k={`rows ${i}-${i + 9}`} run={run} />);
      act(() => { vi.advanceTimersByTime(16); });
    }
    expect(run).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(ROWS_SETTLE_MS); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('rows 60-69');
  });

  it('a re-render with the same key neither restarts the wait nor runs again', () => {
    const run = vi.fn();
    const { rerender } = render(<Probe k="a" run={run} />);
    act(() => { vi.advanceTimersByTime(ROWS_SETTLE_MS - 50); });
    rerender(<Probe k="a" run={run} />); // an EPG reply re-rendered the list
    act(() => { vi.advanceTimersByTime(50); });
    expect(run).toHaveBeenCalledTimes(1);
    rerender(<Probe k="a" run={run} />);
    act(() => { vi.advanceTimersByTime(ROWS_SETTLE_MS * 4); });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('nothing runs after unmount (the list closed mid-wait)', () => {
    const run = vi.fn();
    const { unmount } = render(<Probe k="a" run={run} />);
    unmount();
    act(() => { vi.advanceTimersByTime(ROWS_SETTLE_MS * 2); });
    expect(run).not.toHaveBeenCalled();
  });
});
