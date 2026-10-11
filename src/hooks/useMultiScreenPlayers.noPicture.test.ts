/**
 * A Multi-Screen tile whose picture never starts (NO_PICTURE, after the
 * plugin's own steps): one fresh start, then the tile says so. The stream is
 * READY all along (its sound plays), and READY resets a slot's retries, so
 * the second NO_PICTURE for the same stream used to start it again, a full
 * player rebuild every 12 s for as long as the tile was up.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: {} as Record<string, (data: unknown) => void>,
  load: vi.fn(async (_o: unknown) => {}),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: vi.fn(), exitQuiet: vi.fn() }));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: new Proxy({}, {
    get: (_t, name: string) => {
      if (name === 'addListener') return async (ev: string, cb: (data: unknown) => void) => { h.listeners[ev] = cb; return { remove() {} }; };
      if (name === 'load') return h.load;
      return async () => {};
    },
  }),
}));

import { useMultiScreenPlayers } from './useMultiScreenPlayers';

const URL = 'http://line.test/live/u/p/7.ts';
const fire = (ev: string, data: unknown) => act(() => { h.listeners[ev]?.(data); });
const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

beforeEach(() => { h.listeners = {}; h.load.mockClear(); });

describe('Multi-Screen: a tile with sound and no picture', () => {
  it('one fresh start after NO_PICTURE, then "unavailable" for the same stream (READY in between does not reset it)', async () => {
    const { result } = renderHook(() => useMultiScreenPlayers());
    await wait(10);
    await act(async () => { await result.current.loadSlot('ms2', URL); });
    expect(h.load).toHaveBeenCalledTimes(1);
    // Sound plays (READY), no picture, every plugin step fails.
    fire('playerState', { screenId: 'ms2', state: 'ready' });
    fire('playerError', { screenId: 'ms2', code: 'NO_PICTURE', message: 'The picture didn\'t start.' });
    await wait(700); // the first retry goes out after 500 ms
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(result.current.slots.ms2.error).toBeNull();
    // The fresh start plays its sound again (READY: retries back to 0)…
    fire('playerState', { screenId: 'ms2', state: 'ready' });
    // …and still no picture: the tile says so, nothing more is loaded.
    fire('playerError', { screenId: 'ms2', code: 'NO_PICTURE', message: 'The picture didn\'t start.' });
    await wait(700);
    expect(result.current.slots.ms2.error).toBe('unavailable');
    expect(h.load).toHaveBeenCalledTimes(2);
  });

  it('another channel in the tile starts its own count', async () => {
    const { result } = renderHook(() => useMultiScreenPlayers());
    await wait(10);
    await act(async () => { await result.current.loadSlot('ms1', URL); });
    fire('playerError', { screenId: 'ms1', code: 'NO_PICTURE' });
    await wait(700);
    await act(async () => { await result.current.loadSlot('ms1', URL.replace('7.ts', '8.ts')); });
    fire('playerState', { screenId: 'ms1', state: 'ready' });
    fire('playerError', { screenId: 'ms1', code: 'NO_PICTURE' });
    await wait(700);
    expect(result.current.slots.ms1.error).toBeNull(); // its first: one fresh start
  });
});
