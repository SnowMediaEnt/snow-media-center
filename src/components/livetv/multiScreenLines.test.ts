/**
 * Multi-Screen and the line's live connections (owner, 2026-10-23): the
 * marker by a screen's name (nothing under the limit, F at it, O past it),
 * the check before a screen is added, and the panel read gently: once a
 * minute per line at most, never in a loop (a provider bans an IP for a
 * burst of player_api calls).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  authenticate: vi.fn(async (_c: unknown): Promise<unknown> => ({ user_info: { max_connections: '2', active_cons: '1' } })),
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  authenticate: (c: unknown) => h.authenticate(c),
}));

import {
  LINE_ASK_TIMEOUT_MS, LINE_POLL_MS, LINE_SETTLE_MS,
  __resetLineReadingsForTests, addGoesOver, freshLineReading, lineMark, lineReading, lineTotal, othersOf, useLineReadings,
} from './multiScreenLines';
import { lineKey } from '@/lib/favoritesSync';

const line = { host: 'http://dream.test:8080', username: 'Josh', password: 'p', output: 'ts' } as const;
const other = { host: 'http://vibez.test', username: 'amy', password: 'q', output: 'ts' } as const;

beforeEach(() => {
  __resetLineReadingsForTests();
  h.authenticate.mockReset();
  h.authenticate.mockImplementation(async () => ({ user_info: { max_connections: '2', active_cons: '1' } }));
});
afterEach(() => { vi.useRealTimers(); });

describe('the line math', () => {
  it('others = the panel\'s count less our screens when it was asked; total = others + ours now', () => {
    expect(othersOf({ active: 3, own: 2 })).toBe(1);
    expect(othersOf({ active: 1, own: 2 })).toBe(0); // the panel had not counted ours yet: never below 0
    expect(othersOf(null)).toBe(0);
    expect(lineTotal({ active: 3, own: 2 }, 3)).toBe(4);
    expect(lineTotal(null, 2)).toBe(2); // the panel did not say: our own screens still count
  });

  it('the marker: nothing under the limit, F exactly at it, O past it; nothing with no limit known', () => {
    expect(lineMark(1, 2)).toBeNull();
    expect(lineMark(2, 2)).toBe('full');
    expect(lineMark(3, 2)).toBe('over');
    expect(lineMark(5, null)).toBeNull();
    expect(lineMark(5, 0)).toBeNull(); // 0 = no limit on some panels
  });

  it('a screen added goes over only past the limit (reaching it is fine)', () => {
    expect(addGoesOver(2, 2)).toBe(false);
    expect(addGoesOver(3, 2)).toBe(true);
    expect(addGoesOver(9, null)).toBe(false);
  });
});

describe('asking the panel', () => {
  it('one read per line per minute at most, a failed one included; a second caller shares the read in flight', async () => {
    let answer: (v: unknown) => void = () => {};
    h.authenticate.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const a = freshLineReading(line, 0);
    const b = freshLineReading(line, 0);
    answer({ user_info: { max_connections: 2, active_cons: 1 } });
    expect(await a).toMatchObject({ max: 2, active: 1, own: 0 });
    expect(await b).toMatchObject({ max: 2, active: 1 });
    expect(h.authenticate).toHaveBeenCalledTimes(1);
    // Kept for a minute: no new read.
    expect(await freshLineReading(line, 1)).toMatchObject({ active: 1, own: 0 });
    expect(h.authenticate).toHaveBeenCalledTimes(1);

    // Another line is its own.
    h.authenticate.mockRejectedValueOnce(new Error('HTTP 503'));
    expect(await freshLineReading(other, 0)).toBeNull();
    // Failed: not asked again before the minute is up.
    expect(await freshLineReading(other, 0)).toBeNull();
    expect(h.authenticate).toHaveBeenCalledTimes(2);
  });

  it('the check before a screen is added waits 3 s at most; the late answer is still kept', async () => {
    vi.useFakeTimers();
    let answer: (v: unknown) => void = () => {};
    h.authenticate.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const p = freshLineReading(line, 2);
    await vi.advanceTimersByTimeAsync(LINE_ASK_TIMEOUT_MS + 10);
    expect(await p).toBeNull();
    answer({ user_info: { max_connections: '3', active_cons: '3' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(lineReading(line)).toMatchObject({ max: 3, active: 3, own: 2 });
  });

  it('no usable answer (a panel that leaves the counts out): no reading', async () => {
    h.authenticate.mockResolvedValueOnce({ user_info: { status: 'Active' } });
    expect(await freshLineReading(line, 0)).toBeNull();
    expect(lineReading(line)).toBeNull();
  });
});

describe('while screens play', () => {
  it('each line is read once a minute at most, after its screens settle, and not while the app is in the background', async () => {
    vi.useFakeTimers();
    const own: Record<string, number> = { [lineKey(line)]: 2 };
    let changedAt = Date.now();
    const { result, rerender } = renderHook(({ on }) => useLineReadings([line], (k) => own[k] ?? 0, () => changedAt, on), { initialProps: { on: true } });
    expect(result.current).toEqual({});
    // Not before the screens have settled.
    await act(async () => { await vi.advanceTimersByTimeAsync(LINE_SETTLE_MS - 100); });
    expect(h.authenticate).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(h.authenticate).toHaveBeenCalledTimes(1);
    expect(result.current[lineKey(line)]).toMatchObject({ max: 2, active: 1, own: 2 });

    // Ten minutes of playing: ten reads, never more than one a minute.
    h.authenticate.mockResolvedValue({ user_info: { max_connections: 2, active_cons: 3 } });
    for (let i = 0; i < 10; i++) await act(async () => { await vi.advanceTimersByTimeAsync(LINE_POLL_MS); });
    expect(h.authenticate.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(h.authenticate.mock.calls.length).toBeLessThanOrEqual(11);
    // The panel's count changed: the reading follows (the marker with it).
    expect(result.current[lineKey(line)]).toMatchObject({ active: 3 });

    // In the background: nothing asked.
    const before = h.authenticate.mock.calls.length;
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * LINE_POLL_MS); });
    expect(h.authenticate.mock.calls.length).toBe(before);
    hidden.mockRestore();

    // Screens just changed: that line waits for them to settle.
    changedAt = Date.now();
    await act(async () => { await vi.advanceTimersByTimeAsync(LINE_SETTLE_MS - 1000); });
    expect(h.authenticate.mock.calls.length).toBe(before);

    // Off (no screen playing): nothing more, ever.
    rerender({ on: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * LINE_POLL_MS); });
    expect(h.authenticate.mock.calls.length).toBeLessThanOrEqual(before + 1);
    const settled = h.authenticate.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * LINE_POLL_MS); });
    expect(h.authenticate.mock.calls.length).toBe(settled);
  });

  it('a panel that keeps failing is still asked only once a minute', async () => {
    vi.useFakeTimers();
    h.authenticate.mockRejectedValue(new Error('HTTP 403'));
    renderHook(() => useLineReadings([line, other], () => 1, () => 0, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(LINE_SETTLE_MS + 10 * LINE_POLL_MS); });
    const per = (host: string) => h.authenticate.mock.calls.filter(([c]) => (c as { host: string }).host === host).length;
    expect(per(line.host)).toBeLessThanOrEqual(11);
    expect(per(other.host)).toBeLessThanOrEqual(11);
    expect(per(line.host)).toBeGreaterThanOrEqual(9);
  });
});
