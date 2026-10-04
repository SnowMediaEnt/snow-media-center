/**
 * The native player's remote switches, kept fresh in the flag cache: one read
 * of all of them, and one realtime channel. A row deleted on the server
 * (Supabase sends it in `old`, `new` is empty) goes back to its default.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [] as Array<{ key: string; enabled: boolean }>,
  onChange: null as null | ((p: Record<string, unknown>) => void),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ in: async () => ({ data: h.rows, error: null }) }) }),
    channel: () => {
      const ch = {
        on: (_e: string, _f: unknown, cb: (p: Record<string, unknown>) => void) => { h.onChange = cb; return ch; },
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => undefined,
  },
}));
vi.mock('@/utils/idle', () => ({
  runWhenIdle: (fn: () => void) => { fn(); return () => {}; },
  onFirstInteraction: (fn: () => void) => { fn(); return () => {}; },
}));

import { usePlayerFlagSync } from './usePlayerFlagSync';
import { playerFlag } from '@/lib/playerFlags';

beforeEach(() => { localStorage.clear(); h.rows = []; h.onChange = null; });

describe('usePlayerFlagSync', () => {
  it('reads the rows, and a missing row is the default', async () => {
    h.rows = [{ key: 'match_frame_rate', enabled: false }];
    renderHook(() => usePlayerFlagSync());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(playerFlag('match_frame_rate')).toBe(false);
    expect(playerFlag('video_surface_view')).toBe(true);
    expect(playerFlag('async_codec')).toBe(false);
  });

  it('an update applies; a delete (row in `old`) goes back to the default', async () => {
    renderHook(() => usePlayerFlagSync());
    await act(async () => { await Promise.resolve(); });
    act(() => { h.onChange?.({ eventType: 'UPDATE', new: { key: 'video_surface_view', enabled: false }, old: {} }); });
    expect(playerFlag('video_surface_view')).toBe(false);
    act(() => { h.onChange?.({ eventType: 'DELETE', new: {}, old: { key: 'video_surface_view', enabled: false } }); });
    expect(playerFlag('video_surface_view')).toBe(true);
  });
});
