/**
 * The `engine` option — mpv for Live TV (owner test builds only). Callers
 * that don't pass it behave exactly as before ('exo', no change on rerender);
 * passing 'mpv' goes out with load() and a change reloads like `url` does.
 * engineFallback surfaces once as engineNotice, and clears on the next load.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, rec, listeners } = vi.hoisted(() => {
  const calls: Array<{ fn: string; opts?: Record<string, unknown> }> = [];
  const rec = (fn: string) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); };
  const listeners = new Map<string, Array<(data: Record<string, unknown>) => void>>();
  return { calls, rec, listeners };
});

vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: {
    setRect: rec('setRect'),
    load: rec('load'),
    stop: rec('stop'),
    seekTo: rec('seekTo'),
    setVolume: vi.fn(async () => {}),
    getPosition: vi.fn(async () => ({ position: 0, duration: 0, playing: false })),
    addListener: vi.fn(async (event: string, cb: (data: Record<string, unknown>) => void) => {
      const arr = listeners.get(event) ?? [];
      arr.push(cb);
      listeners.set(event, arr);
      return { remove: async () => { listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== cb)); } };
    }),
  },
}));
vi.mock('@/lib/nativeVideoController', () => ({
  createNativeVideoController: () => ({ controller: {}, prime: async () => {}, dispose: () => {} }),
}));
vi.mock('@/lib/mediaKeys', () => ({ onMediaKey: () => () => {} }));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@/lib/bufferDiagnostics', () => ({ beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));

import { useNativePlayer } from './useNativePlayer';

type Props = { url: string | null; engine?: 'exo' | 'mpv' };
const loads = () => calls.filter((c) => c.fn === 'load');
const fire = (event: string, data: Record<string, unknown>) => {
  for (const cb of listeners.get(event) ?? []) cb(data);
};

function mount(initial: Props) {
  return renderHook((p: Props) => useNativePlayer({ active: true, url: p.url, volume: 1, engine: p.engine }), { initialProps: initial });
}

beforeEach(() => { calls.length = 0; listeners.clear(); });

describe('useNativePlayer — engine', () => {
  it('a caller that never passes engine sends none extra, and behaves exactly as before', async () => {
    mount({ url: 'http://a/1.ts' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).toMatchObject({ url: 'http://a/1.ts', engine: 'exo' });
  });

  it('engine: "mpv" goes out with load()', async () => {
    mount({ url: 'http://a/1.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).toMatchObject({ engine: 'mpv' });
  });

  it('a change of engine alone (same url) reloads, like a change of url', async () => {
    const h = mount({ url: 'http://a/1.ts', engine: 'exo' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    h.rerender({ url: 'http://a/1.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ url: 'http://a/1.ts', engine: 'mpv' });
  });

  it('engineFallback surfaces once as engineNotice, with the reason', async () => {
    const h = mount({ url: 'http://a/1.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(h.result.current.engineNotice).toBeNull();
    await act(async () => { fire('engineFallback', { screenId: 'main', reason: 'init-failed' }); });
    expect(h.result.current.engineNotice).toBe('init-failed');
  });

  it('engineNotice clears on the next load', async () => {
    const h = mount({ url: 'http://a/1.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await act(async () => { fire('engineFallback', { screenId: 'main', reason: 'android-too-old' }); });
    expect(h.result.current.engineNotice).toBe('android-too-old');
    h.rerender({ url: 'http://a/2.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(h.result.current.engineNotice).toBeNull();
  });

  it('a fallback reported for a different screen is ignored', async () => {
    const h = mount({ url: 'http://a/1.ts', engine: 'mpv' });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await act(async () => { fire('engineFallback', { screenId: 'tile-1', reason: 'init-failed' }); });
    expect(h.result.current.engineNotice).toBeNull();
  });
});
