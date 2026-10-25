/**
 * The viewer's jumps in a film, as the native player hook marks them
 * (playerSeek markJump): a seek, Fast-forward / Rewind, and playing on after
 * a pause. Automatic quality and the buffering card grace a jump until
 * playback picks up again and for the half minute after (plexAutoQuality
 * afterJump). Live TV keeps its plain seek mark, and a channel's pause is
 * never a jump.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listeners, ctl } = vi.hoisted(() => ({
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  ctl: { onPausedChange: null as null | ((p: boolean) => void) },
}));

vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: {
    setRect: async () => {},
    load: async () => {},
    seekTo: async () => {},
    stop: async () => {},
    setVolume: async () => {},
    getPosition: async () => ({ position: 100, duration: 5400, playing: true }),
    addListener: async (ev: string, cb: (d: Record<string, unknown>) => void) => {
      listeners.set(ev, [...(listeners.get(ev) ?? []), cb]);
      return { remove: () => { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== cb)); } };
    },
  },
}));
vi.mock('@/lib/nativeVideoController', () => ({
  createNativeVideoController: (cb: { onPausedChange?: (p: boolean) => void }) => {
    ctl.onPausedChange = cb.onPausedChange ?? null;
    return { controller: {}, prime: async () => {}, resetPaused: () => {}, dispose: () => {} };
  },
}));
vi.mock('@/lib/mediaKeys', () => ({ onMediaKey: () => () => {} }));
vi.mock('@/utils/quietMode', () => ({ enterQuiet: () => {}, exitQuiet: () => {} }));
vi.mock('@/lib/bufferDiagnostics', () => ({ beginStream: () => {}, endStream: () => {}, setBuffering: () => {}, recordPlayerRate: () => {} }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));

import { useNativePlayer } from './useNativePlayer';
import { lastJumpAt, lastPlaybackStartAt, lastSeekAt, markJump, markPlaybackStart, markSeek } from '@/lib/playerSeek';

const FILM = 'https://srv.plex.direct:32400/library/parts/42/1700000000/file.mkv';
const CHANNEL = 'http://iptv.example/live/1.ts';

const mount = (url: string, live: boolean) => renderHook(() => useNativePlayer({ active: true, url, volume: 1, live }));
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });

beforeEach(() => {
  listeners.clear();
  ctl.onPausedChange = null;
  markSeek(0);
  markJump(0);
  markPlaybackStart(0);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe("a film: the viewer's jumps", () => {
  it('a seek is a jump, and playing on after it begins the grace', async () => {
    const { result } = mount(FILM, false);
    await waitFor(() => expect(listeners.get('playerState')?.length).toBeTruthy());
    fire('playerState', { playing: true });
    const before = lastPlaybackStartAt();
    vi.setSystemTime(new Date('2026-10-25T10:05:00Z'));
    await act(async () => { await result.current.seekTo(1800); });
    expect(lastJumpAt()).toBe(Date.now());
    expect(lastSeekAt()).toBe(Date.now());
    // Still loading the jump: playback last began before it.
    expect(lastPlaybackStartAt()).toBe(before);
    vi.setSystemTime(new Date('2026-10-25T10:05:06Z'));
    fire('playerState', { playing: true });
    expect(lastPlaybackStartAt()).toBe(Date.now());
  });

  it('playing on after a pause is a jump; the pause itself is not', async () => {
    mount(FILM, false);
    await waitFor(() => expect(ctl.onPausedChange).not.toBeNull());
    fire('playerState', { playing: true });
    vi.setSystemTime(new Date('2026-10-25T10:10:00Z'));
    act(() => { ctl.onPausedChange?.(true); });
    expect(lastJumpAt()).toBe(0);
    vi.setSystemTime(new Date('2026-10-25T10:20:00Z'));
    act(() => { ctl.onPausedChange?.(false); });
    expect(lastJumpAt()).toBe(Date.now());
    // Its first 'playing' is the jump playing on.
    vi.setSystemTime(new Date('2026-10-25T10:20:04Z'));
    fire('playerState', { playing: true });
    expect(lastPlaybackStartAt()).toBe(Date.now());
  });

  it('a "playing" report without a pause before it is no jump', async () => {
    mount(FILM, false);
    await waitFor(() => expect(ctl.onPausedChange).not.toBeNull());
    act(() => { ctl.onPausedChange?.(false); });
    expect(lastJumpAt()).toBe(0);
  });
});

describe('Live TV', () => {
  it("a channel's seek keeps the plain seek mark, and its unpause is no jump", async () => {
    const { result } = mount(CHANNEL, true);
    await waitFor(() => expect(ctl.onPausedChange).not.toBeNull());
    await act(async () => { await result.current.seekTo(10); });
    expect(lastSeekAt()).toBe(Date.now());
    expect(lastJumpAt()).toBe(0);
    act(() => { ctl.onPausedChange?.(true); });
    act(() => { ctl.onPausedChange?.(false); });
    expect(lastJumpAt()).toBe(0);
  });
});
