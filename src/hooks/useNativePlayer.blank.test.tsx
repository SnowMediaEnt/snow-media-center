/**
 * Changing stream used to open on a frozen frame of the previous one: the
 * native TextureView keeps its last picture. The plugin now covers it with a
 * black shutter from load() to the new stream's first frame, and this hook
 * asks for that cover on the setRect it sends just before load() — so a
 * resize landing in between (preview box ↔ fullscreen on another channel)
 * cannot show the old picture at the new size. A move of the SAME stream
 * must not blank it: nothing would uncover it again.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the imports; so must this be.
const { calls, rec } = vi.hoisted(() => {
  const calls: Array<{ fn: string; opts?: Record<string, unknown> }> = [];
  const rec = (fn: string) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); };
  return { calls, rec };
});

vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: {
    setRect: rec('setRect'),
    load: rec('load'),
    stop: rec('stop'),
    seekTo: rec('seekTo'),
    setVolume: vi.fn(async () => {}),
    getPosition: vi.fn(async () => ({ position: 0, duration: 0, playing: false })),
    addListener: vi.fn(async () => ({ remove: () => {} })),
  },
}));
vi.mock('@/lib/nativeVideoController', () => ({
  createNativeVideoController: () => ({ controller: {}, prime: async () => {}, dispose: () => {} }),
}));
vi.mock('@/lib/mediaKeys', () => ({ onMediaKey: () => () => {} }));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@/lib/bufferDiagnostics', () => ({ beginStream: () => {}, endStream: () => {}, setBuffering: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));

import { useNativePlayer, type NativeRect } from './useNativePlayer';
// The Kotlin half can't run here; pin its shape the way the transparency
// test pins MultiScreenSection's markup.
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';

type Props = { url: string | null; rect?: NativeRect | null };
const BOX: NativeRect = { x: 40, y: 60, width: 320, height: 180 };

function mount(initial: Props) {
  return renderHook((p: Props) => useNativePlayer({ active: true, url: p.url, volume: 1, rect: p.rect }), { initialProps: initial });
}
const loads = () => calls.filter((c) => c.fn === 'load');
/** The setRect calls sent since the load before `n` (0-based). */
const setRectsBefore = (n: number) => {
  const idx = calls.indexOf(loads()[n]);
  const prev = n > 0 ? calls.indexOf(loads()[n - 1]) : -1;
  return calls.slice(prev + 1, idx).filter((c) => c.fn === 'setRect');
};

beforeEach(() => { calls.length = 0; });

describe('useNativePlayer — no frozen frame on a stream change', () => {
  it('fullscreen: the setRect before load asks the plugin to blank the old picture', async () => {
    mount({ url: 'http://a/1.ts', rect: undefined });
    await waitFor(() => expect(loads()).toHaveLength(1));
    const [r] = setRectsBefore(0);
    expect(r.opts).toMatchObject({ fullscreen: true, blank: true });
  });

  it('preview box: a channel change blanks before the next load', async () => {
    const h = mount({ url: 'http://a/1.ts', rect: BOX });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(setRectsBefore(0)[0].opts).toMatchObject({ x: 40, y: 60, width: 320, height: 180, blank: true });

    h.rerender({ url: 'http://a/2.ts', rect: BOX });
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ url: 'http://a/2.ts' });
    expect(setRectsBefore(1)[0].opts).toMatchObject({ blank: true });
  });

  it('new channel AND new rect: the blank lands before the resize', async () => {
    const h = mount({ url: 'http://a/1.ts', rect: BOX });
    await waitFor(() => expect(loads()).toHaveLength(1));

    // OK on a different channel from the preview: fullscreen, new stream.
    h.rerender({ url: 'http://a/2.ts', rect: undefined });
    await waitFor(() => expect(loads()).toHaveLength(2));
    const rects = setRectsBefore(1);
    expect(rects[0].opts).toMatchObject({ blank: true });
    expect(rects.find((c) => c.opts?.fullscreen === true)).toBeTruthy();
  });

  it('same stream moved between the box and fullscreen: no blank, no reload', async () => {
    const h = mount({ url: 'http://a/1.ts', rect: BOX });
    await waitFor(() => expect(loads()).toHaveLength(1));
    calls.length = 0;

    await act(async () => { h.rerender({ url: 'http://a/1.ts', rect: undefined }); });
    await waitFor(() => expect(calls.some((c) => c.fn === 'setRect')).toBe(true));
    await act(async () => { h.rerender({ url: 'http://a/1.ts', rect: BOX }); });
    await waitFor(() => expect(calls.filter((c) => c.fn === 'setRect')).toHaveLength(2));

    expect(loads()).toHaveLength(0);
    for (const c of calls.filter((x) => x.fn === 'setRect')) expect(c.opts?.blank).toBeFalsy();
  });

  it('plugin: shutter closes on load / stop / blank setRect and opens only on the first frame', () => {
    const body = (from: string) => plugin.slice(plugin.indexOf(from), plugin.indexOf('\n    }\n', plugin.indexOf(from)));
    const load = body('fun load(call: PluginCall)');
    expect(load.indexOf('shutterView?.visibility = View.VISIBLE')).toBeGreaterThan(-1);
    expect(load.indexOf('shutterView?.visibility = View.VISIBLE')).toBeLessThan(load.indexOf('p.setMediaItem('));
    expect(body('private fun stopSlot(')).toContain('shutterView?.visibility = View.VISIBLE');
    expect(body('fun setRect(call: PluginCall)')).toMatch(/if \(blank\) s\.shutterView\?\.visibility = View\.VISIBLE/);
    const opens = plugin.split('shutterView?.visibility = View.INVISIBLE').length - 1;
    expect(opens).toBe(1);
    expect(body('override fun onRenderedFirstFrame()')).toContain('shutterView?.visibility = View.INVISIBLE');
  });
});
