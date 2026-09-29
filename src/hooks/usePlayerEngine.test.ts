/**
 * The viewer's player-engine choice (owner test builds only — PlaybackScreen),
 * per box like useScreenFormat: read once from Preferences, 'exo' until it
 * answers, saved on change, and applied live to every other mounted instance
 * this same visit via a window event.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: h.store.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => { h.store.set(key, value); }),
  },
}));

import { usePlayerEngine, PLAYER_ENGINE_KEY, PLAYER_ENGINE_CHANGED_EVENT } from './usePlayerEngine';

beforeEach(() => { h.store.clear(); });

describe('usePlayerEngine', () => {
  it('defaults to exo before the stored value has loaded, then keeps it if none is stored', async () => {
    const { result } = renderHook(() => usePlayerEngine());
    expect(result.current.engine).toBe('exo');
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.engine).toBe('exo');
  });

  it('reads a stored choice', async () => {
    h.store.set(PLAYER_ENGINE_KEY, 'mpv');
    const { result } = renderHook(() => usePlayerEngine());
    await waitFor(() => expect(result.current.engine).toBe('mpv'));
  });

  it('an unrecognised stored value is ignored, not crashed on', async () => {
    h.store.set(PLAYER_ENGINE_KEY, 'vlc');
    const { result } = renderHook(() => usePlayerEngine());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.engine).toBe('exo');
  });

  it('setEngine updates the hook and saves it', async () => {
    const { result } = renderHook(() => usePlayerEngine());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.setEngine('mpv'); });
    expect(result.current.engine).toBe('mpv');
    expect(h.store.get(PLAYER_ENGINE_KEY)).toBe('mpv');
  });

  it('applies live to another mounted instance via the window event', async () => {
    const a = renderHook(() => usePlayerEngine());
    const b = renderHook(() => usePlayerEngine());
    await waitFor(() => expect(a.result.current.loaded).toBe(true));
    await waitFor(() => expect(b.result.current.loaded).toBe(true));
    await act(async () => { await a.result.current.setEngine('mpv'); });
    expect(b.result.current.engine).toBe('mpv');
  });

  it('ignores an unrecognised value on the change event too', async () => {
    const { result } = renderHook(() => usePlayerEngine());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      window.dispatchEvent(new CustomEvent(PLAYER_ENGINE_CHANGED_EVENT, { detail: 'vlc' }));
    });
    expect(result.current.engine).toBe('exo');
  });
});
