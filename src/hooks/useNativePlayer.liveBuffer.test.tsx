/**
 * Live TV's Live buffer (lib/liveBuffer): the cushion goes with a live load
 * only, and a stall is told only once the channel has played (never its
 * start-up fill, a seek's refill or a film's). The Kotlin half is
 * LiveCushionTest's; its wiring is pinned here.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, listeners } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
}));

vi.mock('@/capacitor/SnowPlayer', () => {
  const rec = (fn: string) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); };
  return {
    SnowPlayer: {
      setRect: rec('setRect'),
      load: rec('load'),
      stop: rec('stop'),
      seekTo: rec('seekTo'),
      setVolume: async () => {},
      getPosition: async () => ({ position: 0, duration: 0, playing: true }),
      addListener: async (ev: string, cb: (d: Record<string, unknown>) => void) => {
        listeners.set(ev, [...(listeners.get(ev) ?? []), cb]);
        return { remove: () => { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== cb)); } };
      },
    },
  };
});
vi.mock('@/lib/nativeVideoController', () => ({
  createNativeVideoController: () => ({ controller: {}, prime: async () => {}, resetPaused: () => {}, dispose: () => {} }),
}));
vi.mock('@/lib/mediaKeys', () => ({ onMediaKey: () => () => {} }));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@/lib/bufferDiagnostics', () => ({ beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));

import { useNativePlayer } from './useNativePlayer';
import { markSeek } from '@/lib/playerSeek';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';

const CH = 'http://panel.example/live/u/p/1.ts';
const BIG = { startMs: 10000, rebufferMs: 12000 };

const loads = () => calls.filter((c) => c.fn === 'load');
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
const ready = async () => {
  await waitFor(() => expect(loads()).toHaveLength(1));
  await waitFor(() => expect(listeners.get('playerState')?.length ?? 0).toBeGreaterThan(0));
};

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  markSeek(0);
});

describe('the Live buffer', () => {
  it('goes with a live load', async () => {
    renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live: true, liveBuffer: BIG }));
    await ready();
    expect(loads()[0].opts).toMatchObject({ liveStartBufferMs: 10000, liveRebufferMs: 12000 });
  });

  it('never with a film or catch-up', async () => {
    renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live: false, liveBuffer: BIG }));
    await ready();
    expect(loads()[0].opts).not.toHaveProperty('liveStartBufferMs');
  });

  it('a change alone never reloads', async () => {
    const h = renderHook(({ c }) => useNativePlayer({ active: true, url: CH, volume: 1, live: true, liveBuffer: c }), { initialProps: { c: BIG } });
    await ready();
    h.rerender({ c: { startMs: 15000, rebufferMs: 18000 } });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(loads()).toHaveLength(1);
  });
});

describe('a live stall', () => {
  it('is told once the channel has played, once per stall; never for the start-up fill', async () => {
    const onLiveStall = vi.fn();
    renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live: true, onLiveStall }));
    await ready();
    fire('playerState', { state: 'buffering' });
    expect(onLiveStall).not.toHaveBeenCalled();
    fire('playerState', { playing: true });
    fire('playerState', { state: 'buffering' });
    fire('playerState', { state: 'buffering' });
    expect(onLiveStall).toHaveBeenCalledTimes(1);
    fire('playerState', { state: 'ready' });
    fire('playerState', { state: 'buffering' });
    expect(onLiveStall).toHaveBeenCalledTimes(2);
  });

  it('not right after a seek (rewind, Go live)', async () => {
    const onLiveStall = vi.fn();
    renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live: true, onLiveStall }));
    await ready();
    fire('playerState', { playing: true });
    markSeek();
    fire('playerState', { state: 'buffering' });
    expect(onLiveStall).not.toHaveBeenCalled();
  });

  it('not on a film', async () => {
    const onLiveStall = vi.fn();
    renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live: false, onLiveStall }));
    await ready();
    fire('playerState', { playing: true });
    fire('playerState', { state: 'buffering' });
    expect(onLiveStall).not.toHaveBeenCalled();
  });
});

describe('the plugin', () => {
  it('reads the cushion for live loads and keeps it off the rewind buffer', () => {
    expect(plugin).toMatch(/liveStartBufferMs = if \(live\) LiveCushion\.clamp/);
    expect(plugin).toMatch(/fun setLiveBuffer\(call: PluginCall\)/);
    // The on-box rewind buffer gets none (it may hold only seconds ahead).
    expect(plugin).toMatch(/no\s+\/\/ cushion[\s\S]{0,120}beginStream\(film = false\)\n/);
  });
});
