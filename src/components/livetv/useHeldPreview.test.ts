import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHeldPreview, type HeldPreviewOptions } from './useHeldPreview';
import type { XtreamCreds, XtreamLiveStream } from '@/lib/xtream';

// The hook on its own: what holds a channel in the box, what OK does then,
// and what lets go of it (LiveSection.tiviList drives it through the screen).

const lineA: XtreamCreds = { host: 'http://a.test', username: 'ua', password: 'pa' } as XtreamCreds;
const lineB: XtreamCreds = { host: 'http://b.test', username: 'ub', password: 'pb' } as XtreamCreds;
const one: XtreamLiveStream = { stream_id: 1, name: 'One' };
const two: XtreamLiveStream = { stream_id: 2, name: 'Two' };
const lineOf = new Map<XtreamLiveStream, XtreamCreds>([[one, lineB], [two, lineA]]);

function setup(over: Partial<HeldPreviewOptions> = {}) {
  let box: XtreamLiveStream | null = null;
  const calls = { play: vi.fn(), fullScreen: vi.fn(), askFirst: vi.fn(() => false) };
  const base = (): HeldPreviewOptions => ({
    on: true,
    previewChannel: box,
    setPreviewChannel: (st) => { box = st; },
    fullscreen: false,
    playingStream: null,
    lineFor: (st) => lineOf.get(st) ?? lineA,
    play: calls.play,
    fullScreen: calls.fullScreen,
    askFirst: calls.askFirst,
    lines: [lineA, lineB],
    ...over,
  });
  const hook = renderHook((p: Partial<HeldPreviewOptions>) => useHeldPreview({ ...base(), ...p }), { initialProps: {} });
  return { hook, calls, box: () => box, base };
}

describe('useHeldPreview', () => {
  it('holds the channel watched full screen, for the way back', () => {
    const { hook, box } = setup();
    expect(hook.result.current.held).toBe(false);
    hook.rerender({ fullscreen: true, playingStream: one });
    expect(box()).toBe(one);
    hook.rerender({ fullscreen: false, playingStream: one, previewChannel: one });
    expect(hook.result.current.held).toBe(true);
  });

  it('OK on another channel plays it in the box; on the one there, full screen only', () => {
    const { hook, calls, box } = setup();
    hook.rerender({ fullscreen: true, playingStream: one });
    hook.rerender({ fullscreen: false, playingStream: one, previewChannel: one });
    act(() => hook.result.current.ok(two));
    expect(box()).toBe(two);
    expect(calls.play).toHaveBeenCalledWith(two);
    hook.rerender({ previewChannel: two, playingStream: two });
    act(() => hook.result.current.ok(two));
    expect(calls.fullScreen).toHaveBeenCalledWith(two);
    expect(calls.play).toHaveBeenCalledTimes(1);
  });

  it('asks first for one reported down, and plays nothing until Watch anyway', () => {
    const { hook, calls, box } = setup();
    calls.askFirst.mockReturnValue(true);
    hook.rerender({ fullscreen: true, playingStream: one });
    hook.rerender({ fullscreen: false, playingStream: one, previewChannel: one });
    act(() => hook.result.current.ok(two));
    expect(calls.play).not.toHaveBeenCalled();
    expect(box()).toBe(one);
    act(() => hook.result.current.playInBox(two));
    expect(box()).toBe(two);
    expect(calls.play).toHaveBeenCalledWith(two);
  });

  it("lets go when the held channel's service goes", () => {
    const { hook } = setup();
    hook.rerender({ fullscreen: true, playingStream: one });
    hook.rerender({ fullscreen: false, playingStream: one, previewChannel: one });
    expect(hook.result.current.held).toBe(true);
    // Another service removed: still held.
    hook.rerender({ previewChannel: one, playingStream: one, lines: [lineB] });
    expect(hook.result.current.held).toBe(true);
    // Its own (lineB) removed.
    hook.rerender({ previewChannel: one, playingStream: one, lines: [lineA] });
    expect(hook.result.current.held).toBe(false);
  });

  it('lets go when there is no box any more, and on release', () => {
    const { hook } = setup();
    hook.rerender({ fullscreen: true, playingStream: one });
    hook.rerender({ fullscreen: false, playingStream: one, previewChannel: one, on: false });
    expect(hook.result.current.held).toBe(false);
    hook.rerender({ on: true, fullscreen: true, playingStream: two });
    hook.rerender({ on: true, fullscreen: false, playingStream: two, previewChannel: two });
    expect(hook.result.current.held).toBe(true);
    act(() => hook.result.current.release());
    expect(hook.result.current.held).toBe(false);
    expect(hook.result.current.isHeld()).toBe(false);
  });
});
