/**
 * Rewind live TV (TRACKER 25): when the on-box buffer starts, and every way it
 * is wiped (leaving the player, switching rewind off, unmount, recordings
 * taking the streams), the buffer coming back after Home, panel catch-up
 * channels using the timeshift address instead (no buffer), and the two gates
 * SMC adds: never on mpv, and the buffer only when the plan allows 2 or more
 * streams. Stream addresses carry the line's password: none of this may print
 * one. (Sign-out wipes in playerSignOut, tested there.)
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, status } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  status: { value: { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 } as Record<string, unknown> },
}));

vi.mock('@/capacitor/SnowPlayer', () => {
  const rec = (fn: string, ret?: () => unknown) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); return ret?.(); };
  return {
    SnowPlayer: {
      timeshiftStart: rec('timeshiftStart'),
      timeshiftWipe: rec('timeshiftWipe'),
      timeshiftStatus: rec('timeshiftStatus', () => status.value),
      timeshiftSeek: rec('timeshiftSeek', () => status.value),
      timeshiftGoLive: rec('timeshiftGoLive', () => ({ ...status.value, mode: 'live', behindSec: 0 })),
      getPosition: rec('getPosition', () => ({ position: 0, duration: 0, playing: true })),
      seekTo: rec('seekTo'),
    },
  };
});
vi.mock('@/lib/xtream', () => ({
  authenticate: async () => ({ server_info: { time_now: '2026-09-28 12:00:00', timestamp_now: Date.UTC(2026, 8, 28, 12, 0, 0) / 1000 } }),
}));

import { bufferGate, rewindOffMessage, useLiveRewind } from './useLiveRewind';
import { REWIND_SETTINGS_KEY, saveRewindSettings } from '@/lib/liveRewind';

const LINE = { host: 'http://panel.example', username: 'viewer', password: 'S3cretPass', output: 'ts' as const };
const url = (id: number) => `${LINE.host}/live/${LINE.username}/${LINE.password}/${id}.ts`;
const CHANNEL = { stream_id: 7 };
const ARCHIVE = { stream_id: 8, tv_archive: 1, tv_archive_duration: 3 };

type P = {
  active: boolean; directUrl: string | null; stream: typeof CHANNEL | typeof ARCHIVE | null;
  engine?: 'exo' | 'mpv'; maxConnections?: number | null; activeRecordings?: number;
};
// A plan with two streams unless a test says otherwise.
const mount = (p: P) => renderHook((q: P) => useLiveRewind({ maxConnections: 2, ...q, line: LINE, watching: true }), { initialProps: p });
const count = (fn: string) => calls.filter((c) => c.fn === fn).length;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

let logSpies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  calls.length = 0;
  localStorage.removeItem(REWIND_SETTINGS_KEY);
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => {
  // Nothing printed anywhere carries the line's password.
  for (const s of logSpies) {
    for (const args of s.mock.calls) expect(JSON.stringify(args)).not.toContain(LINE.password);
    s.mockRestore();
  }
});

describe('the on-box buffer', () => {
  it('starts with the channel full screen, once per channel', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    const start = calls.find((c) => c.fn === 'timeshiftStart');
    expect(start?.opts).toMatchObject({ url: url(7), key: 'http://panel.example|7', maxMinutes: 0 });
    // The key never holds the credentials.
    expect(String(start?.opts?.key)).not.toContain(LINE.password);
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(count('timeshiftStart')).toBe(1);
    // A new channel: a new buffer (the plugin keeps the last one a few seconds).
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(count('timeshiftStart')).toBe(2);
    expect(count('timeshiftWipe')).toBe(0);
  });

  it('is wiped when the player is left', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    h.rerender({ active: false, directUrl: null, stream: null });
    await flush();
    expect(count('timeshiftWipe')).toBe(1);
    expect(h.result.current.kind).toBe('off');
  });

  it('is wiped when Live TV goes away (unmount)', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    h.unmount();
    await flush();
    expect(count('timeshiftWipe')).toBe(1);
  });

  it('switched off in Settings: wiped, and nothing starts', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    act(() => { saveRewindSettings({ enabled: false, maxRewind: 'auto' }); });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('disabled');
    expect(count('timeshiftWipe')).toBe(1);
    const starts = count('timeshiftStart');
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(count('timeshiftStart')).toBe(starts);
  });

  it('Max rewind goes to the plugin in minutes', async () => {
    saveRewindSettings({ enabled: true, maxRewind: 30 });
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(calls.find((c) => c.fn === 'timeshiftStart')?.opts?.maxMinutes).toBe(30);
  });

  it('starts again when the app comes back from Home (the plugin wiped it)', async () => {
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    hidden.mockRestore();
    expect(count('timeshiftStart')).toBe(2);
  });

  it('Back 10s asks the plugin, and says why when there is nothing yet', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    status.value = { state: 'starting', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0 };
    let msg: string | null = 'x';
    await act(async () => { msg = await h.result.current.rewind(10); });
    expect(calls.find((c) => c.fn === 'timeshiftSeek')?.opts).toEqual({ deltaSec: -10 });
    expect(msg).toMatch(/getting ready/);
    status.value = { state: 'capturing', mode: 'buffer', availableSec: 300, behindSec: 14, usedBytes: 5 };
    await act(async () => { msg = await h.result.current.rewind(10); });
    expect(msg).toBeNull();
    expect(h.result.current.info).toMatchObject({ availableSec: 300, behindSec: 14 });
    status.value = { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 };
  });
});

describe('the engine gate (rewind is ExoPlayer only)', () => {
  it('a channel on mpv has no rewind: no buffer, no catch-up, and it says why', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, engine: 'mpv' });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('engine');
    expect(h.result.current.info).toBeNull();
    expect(count('timeshiftStart')).toBe(0);
    h.rerender({ active: true, directUrl: url(8), stream: ARCHIVE, engine: 'mpv' });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(count('timeshiftStart')).toBe(0);
  });

  it('switching back to ExoPlayer turns it on', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, engine: 'mpv' });
    await flush();
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, engine: 'exo' });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(1);
  });
});

describe('the streams gate (the buffer is a second stream on the line)', () => {
  it('one stream: no buffer for an ordinary channel, and it says why', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 1 });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('streams');
    expect(count('timeshiftStart')).toBe(0);
    expect(rewindOffMessage(h.result.current.offReason)).toMatch(/1 stream.*catch-up/);
  });

  it('one stream: a catch-up channel still rewinds (the archive replaces the picture, no second stream)', async () => {
    const h = mount({ active: true, directUrl: url(8), stream: ARCHIVE, maxConnections: 1 });
    await flush();
    expect(h.result.current.kind).toBe('catchup');
    expect(count('timeshiftStart')).toBe(0);
    await act(async () => { await h.result.current.rewind(10); });
    await flush();
    expect(h.result.current.playUrl).toMatch(/\/timeshift\//);
  });

  it('a plan that is not known counts as one stream for the buffer', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: null });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('streams-unknown');
    expect(count('timeshiftStart')).toBe(0);
  });

  it('a recording takes a stream: the buffer is wiped and stays off until it stops', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 2 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 2, activeRecordings: 1 });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('recording');
    expect(count('timeshiftWipe')).toBe(1);
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 2, activeRecordings: 0 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(2);
  });

  it('three streams leave room for one recording and the buffer', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3, activeRecordings: 1 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
  });

  it('on 3 streams a recording start wipes the buffer first, and the buffer opens again once the recording counts', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3 });
    await flush();
    expect(count('timeshiftStart')).toBe(1);
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3, activeRecordings: 1 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(2); // the native side keeps the same channel as it is; after a wipe it opens anew
  });

  it('bufferGate', () => {
    expect(bufferGate(1)).toBe('few');
    expect(bufferGate(2)).toBe('ok');
    expect(bufferGate(5, 2)).toBe('ok');
    expect(bufferGate(2, 1)).toBe('few');
    expect(bufferGate(null)).toBe('unknown');
    expect(bufferGate(undefined)).toBe('unknown');
    expect(bufferGate(0)).toBe('unknown');
    expect(bufferGate(Number.NaN)).toBe('unknown');
  });
});

describe('panel catch-up', () => {
  it('uses the timeshift address and keeps nothing on the box', async () => {
    const h = mount({ active: true, directUrl: url(8), stream: ARCHIVE });
    await flush();
    expect(h.result.current.kind).toBe('catchup');
    expect(count('timeshiftStart')).toBe(0);
    expect(h.result.current.playUrl).toBeNull();
    await act(async () => { await h.result.current.rewind(10); });
    await flush();
    const u = h.result.current.playUrl;
    expect(u).toMatch(/^http:\/\/panel\.example\/timeshift\/viewer\/S3cretPass\/\d+\/\d{4}-\d{2}-\d{2}:\d{2}-\d{2}\/8\.ts$/);
    expect(h.result.current.info?.archiveDays).toBe(3);
    await act(async () => { await h.result.current.goLive(); });
    expect(h.result.current.playUrl).toBeNull();
  });

  it('the archive running out goes back to live', async () => {
    const h = mount({ active: true, directUrl: url(8), stream: ARCHIVE });
    await act(async () => { await h.result.current.rewind(120); });
    await flush();
    expect(h.result.current.playUrl).not.toBeNull();
    act(() => { h.result.current.onEnded(); });
    expect(h.result.current.playUrl).toBeNull();
  });
});

describe('rewindOffMessage', () => {
  it('says the right thing for each reason', () => {
    expect(rewindOffMessage('disabled')).toMatch(/Turn on Rewind live TV/);
    expect(rewindOffMessage(null)).toMatch(/Turn on Rewind live TV/);
    expect(rewindOffMessage('recording')).toMatch(/paused while recording/);
    expect(rewindOffMessage('engine')).toMatch(/ExoPlayer/);
    expect(rewindOffMessage('streams-unknown')).toMatch(/catch-up/);
  });
});
