/**
 * A preview stays quick; watched, the same stream is raised to the channel's
 * own cushion in place (SnowPlayer.setLiveBuffer, no reload). A stall while
 * previewing still steps the channel up, for when it is watched.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setLiveBuffer } = vi.hoisted(() => ({ setLiveBuffer: vi.fn(async () => {}) }));
vi.mock('@/capacitor/SnowPlayer', () => ({ SnowPlayer: { setLiveBuffer } }));

import { useLiveCushion, type LiveCushionChannel } from './useLiveCushion';
import { CUSHION_LEVELS, DEFAULT_CUSHION, __resetLiveBufferForTests, saveLiveBuffer } from '@/lib/liveBuffer';

const ALIENS: LiveCushionChannel = { lineChannelKey: 'h|u|1', name: 'Ancient Aliens 24/7', category: 'Documentaries' };
const NEWS: LiveCushionChannel = { lineChannelKey: 'h|u|2', name: 'News', category: 'US News' };

const mount = (ch: LiveCushionChannel | null, watched: boolean) =>
  renderHook(({ c, w }) => useLiveCushion(c, w), { initialProps: { c: ch, w: watched } });

beforeEach(() => {
  localStorage.clear();
  __resetLiveBufferForTests();
  setLiveBuffer.mockClear();
});

describe('useLiveCushion', () => {
  it('a 24/7 preview plays quick; watched, it is raised to Large in place', () => {
    const h = mount(ALIENS, false);
    expect(h.result.current.playing).toEqual(DEFAULT_CUSHION);
    expect(h.result.current.cushion).toEqual(CUSHION_LEVELS[2]);
    expect(setLiveBuffer).not.toHaveBeenCalled();
    h.rerender({ c: ALIENS, w: true });
    expect(h.result.current.playing).toEqual(CUSHION_LEVELS[2]);
    expect(setLiveBuffer).toHaveBeenCalledWith({ liveStartBufferMs: 10000, liveRebufferMs: 12000 });
    // Back to browsing in the box: quick again.
    h.rerender({ c: ALIENS, w: false });
    expect(setLiveBuffer).toHaveBeenLastCalledWith({ liveStartBufferMs: 2500, liveRebufferMs: 5000 });
  });

  it("a channel watched from its own load is not told again (the load carries it)", () => {
    const h = mount(ALIENS, true);
    expect(h.result.current.playing).toEqual(CUSHION_LEVELS[2]);
    h.rerender({ c: NEWS, w: true });
    expect(setLiveBuffer).not.toHaveBeenCalled();
  });

  it('a stall while previewing steps the channel up without touching the preview', () => {
    const h = mount(NEWS, false);
    act(() => h.result.current.onStall());
    expect(h.result.current.cushion).toEqual(CUSHION_LEVELS[1]);
    expect(h.result.current.playing).toEqual(DEFAULT_CUSHION);
    expect(setLiveBuffer).not.toHaveBeenCalled();
    h.rerender({ c: NEWS, w: true });
    expect(setLiveBuffer).toHaveBeenCalledWith({ liveStartBufferMs: 6000, liveRebufferMs: 8000 });
  });

  it('a stall while watched raises the playing stream at once', () => {
    const h = mount(NEWS, true);
    act(() => h.result.current.onStall());
    expect(setLiveBuffer).toHaveBeenCalledWith({ liveStartBufferMs: 6000, liveRebufferMs: 8000 });
  });

  it('on MPV: no cushion, no step-up, no label', () => {
    const h = renderHook(() => useLiveCushion(ALIENS, true, 'mpv'));
    expect(h.result.current.cushion).toBeNull();
    expect(h.result.current.playing).toBeNull();
    act(() => h.result.current.onStall());
    expect(setLiveBuffer).not.toHaveBeenCalled();
    // Nothing was stepped for the channel either.
    const exo = renderHook(() => useLiveCushion(ALIENS, true, 'exo'));
    expect(exo.result.current.cushion).toEqual(CUSHION_LEVELS[2]);
  });

  it('a fixed size applies when watched, and previews stay quick', () => {
    saveLiveBuffer('xlarge');
    const h = mount(NEWS, false);
    expect(h.result.current.playing).toEqual(DEFAULT_CUSHION);
    h.rerender({ c: NEWS, w: true });
    expect(h.result.current.playing).toEqual(CUSHION_LEVELS[3]);
  });
});
