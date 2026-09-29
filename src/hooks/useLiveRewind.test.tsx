/**
 * Rewind live TV (TRACKER 25): when the on-box buffer starts, and every way it
 * is wiped (leaving the player, switching rewind off, unmount, recordings
 * taking the streams), the buffer coming back after Home, panel catch-up
 * channels using the timeshift address instead (no buffer), and the gates SMC
 * adds: never on mpv, the buffer only when the plan allows 2 or more streams,
 * and only when the panel (player_api.php user_info) says a stream is free
 * right now, checked again every 60 s while it runs. Stream addresses carry
 * the line's password: none of this may print one. (Sign-out wipes in
 * playerSignOut, tested there.)
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LIVE_STATUS = { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 };
const { calls, status, panel, toastSpy } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  status: { value: { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 } as Record<string, unknown> },
  // What the panel's user_info says; `asks` counts every read of it.
  panel: { max: 2 as unknown, active: 1 as unknown, fail: false, asks: 0 },
  toastSpy: vi.fn(),
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
  authenticate: async () => {
    panel.asks += 1;
    if (panel.fail) throw new Error('HTTP 500');
    return {
      server_info: { time_now: '2026-09-28 12:00:00', timestamp_now: Date.UTC(2026, 8, 28, 12, 0, 0) / 1000 },
      user_info: { max_connections: panel.max, active_cons: panel.active },
    };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: toastSpy }));

import { bufferGate, rewindOffMessage, useLiveRewind } from './useLiveRewind';
import {
  LINE_CHECK_SETTLE_MS, LINE_RECHECK_MS, LINE_RETRY_MS, LINE_TAKEN_MESSAGE, REWIND_SETTINGS_KEY, saveRewindSettings,
} from '@/lib/liveRewind';

// Slow under a loaded full run (fake timers and many hook renders); the default 5 s flakes.
vi.setConfig({ testTimeout: 20_000 });

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
// Time passes for the fake clock; the start check waits for the channel to settle.
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const flush = () => tick(LINE_CHECK_SETTLE_MS + 50);
const at = (fn: string) => calls.findIndex((c) => c.fn === fn);

let logSpies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  status.value = { ...LIVE_STATUS };
  panel.max = 2; panel.active = 1; panel.fail = false; panel.asks = 0;
  toastSpy.mockClear();
  localStorage.removeItem(REWIND_SETTINGS_KEY);
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => {
  // Nothing printed anywhere carries the line's password.
  for (const s of logSpies) {
    for (const args of s.mock.calls) expect(JSON.stringify(args)).not.toContain(LINE.password);
    s.mockRestore();
  }
  vi.useRealTimers();
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
    // A new channel: the old buffer goes at once (it must not hold a stream
    // while the panel is asked), and a new one starts once the line is checked.
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(count('timeshiftStart')).toBe(2);
    expect(count('timeshiftWipe')).toBe(1);
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
    expect(panel.asks).toBe(0); // the plan says no: the panel isn't asked
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
    expect(panel.asks).toBe(0);
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
    panel.max = 3; panel.active = 2; // the picture and the recording
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3, activeRecordings: 1 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
  });

  it('on 3 streams a recording start keeps the buffer, tells the plugin, and does not ask the panel again', async () => {
    panel.max = 3;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3 });
    await flush();
    expect(count('timeshiftStart')).toBe(1);
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3, activeRecordings: 1 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(2); // the native side keeps the same channel as it is; after a wipe it opens anew
    expect(panel.asks).toBe(1);
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

  it('bufferGate with what the panel says: a stream must be free', () => {
    expect(bufferGate(2, 0, { max: 2, active: 1 })).toBe('ok');
    expect(bufferGate(2, 0, { max: 2, active: 2 })).toBe('full');
    expect(bufferGate(2, 0, { max: 2, active: 3 })).toBe('full');
    expect(bufferGate(null, 0, { max: 3, active: 2 })).toBe('ok'); // the panel's own max is used
    expect(bufferGate(5, 0, { max: 1, active: 1 })).toBe('few'); // and it can say the plan is smaller
    expect(bufferGate(3, 1, { max: 3, active: 2 })).toBe('ok');
    expect(bufferGate(2, 1, { max: 2, active: 1 })).toBe('few');
    expect(bufferGate(2, 0, { max: 2, active: 0 })).toBe('unknown'); // it doesn't even count the picture
    expect(bufferGate(2, 0, null)).toBe('unknown'); // could not be asked
  });
});

describe('the line check (a stream must be free right now)', () => {
  it('a stream is free: the buffer starts after one ask, once the channel has settled', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await tick(LINE_CHECK_SETTLE_MS - 500);
    expect(panel.asks).toBe(0);
    expect(count('timeshiftStart')).toBe(0);
    expect(h.result.current.offReason).toBe('line-checking');
    expect(rewindOffMessage('line-checking')).toMatch(/checking your line/);
    await tick(600);
    expect(panel.asks).toBe(1);
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(1);
  });

  it('the line is full: no buffer, it says why, and the panel is not asked again for 5 minutes', async () => {
    panel.active = 2;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('line-full');
    expect(rewindOffMessage('line-full')).toMatch(/another device is using your line's streams/);
    expect(count('timeshiftStart')).toBe(0);
    expect(panel.asks).toBe(1);
    await tick(LINE_RETRY_MS - 5_000);
    expect(panel.asks).toBe(1);
    // After 5 minutes it asks once more, and starts when a stream has come free.
    panel.active = 1;
    await tick(5_100);
    await flush();
    expect(panel.asks).toBe(2);
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(1);
  });

  it('the line is full: the next channel asks again at once', async () => {
    panel.active = 2;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    panel.active = 1;
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(panel.asks).toBe(2);
    expect(h.result.current.kind).toBe('buffer');
  });

  it('the panel can not be reached: no buffer', async () => {
    panel.fail = true;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('line-unknown');
    expect(count('timeshiftStart')).toBe(0);
    expect(rewindOffMessage('line-unknown')).toMatch(/couldn't check/);
  });

  it('active_cons missing (or max_connections): no buffer', async () => {
    panel.active = undefined;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.offReason).toBe('line-unknown');
    expect(count('timeshiftStart')).toBe(0);
    panel.active = 1; panel.max = '';
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(h.result.current.offReason).toBe('line-unknown');
    expect(count('timeshiftStart')).toBe(0);
  });

  it('a panel that counts 0 while we play is not believed', async () => {
    panel.active = 0;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.offReason).toBe('line-unknown');
    expect(count('timeshiftStart')).toBe(0);
  });

  it('string numbers from the panel are read ("2" streams, "1" in use)', async () => {
    panel.max = '2'; panel.active = '1';
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
  });

  it('the panel says the line has one stream although the account said two: no buffer', async () => {
    panel.max = 1; panel.active = 1;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.offReason).toBe('streams');
    expect(count('timeshiftStart')).toBe(0);
  });

  it('zapping does not ask per channel: only a channel that stays open is checked', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await tick(1_000);
    h.rerender({ active: true, directUrl: url(8), stream: { stream_id: 8 } });
    await tick(1_000);
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(panel.asks).toBe(1);
    expect(calls.find((c) => c.fn === 'timeshiftStart')?.opts).toMatchObject({ key: 'http://panel.example|9' });
  });

  it('asks nothing when rewind is off, on mpv, on catch-up, or when not full screen', async () => {
    mount({ active: true, directUrl: url(7), stream: CHANNEL, engine: 'mpv' });
    mount({ active: true, directUrl: url(8), stream: ARCHIVE });
    mount({ active: false, directUrl: null, stream: null });
    mount({ active: true, directUrl: url(8), stream: ARCHIVE, engine: 'mpv' });
    await tick(LINE_RETRY_MS * 2);
    expect(panel.asks).toBe(0);
    expect(count('timeshiftStart')).toBe(0);
    // Switched off in Settings.
    saveRewindSettings({ enabled: false, maxRewind: 'auto' });
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await tick(LINE_RETRY_MS * 2);
    expect(panel.asks).toBe(0);
  });

  it('coming back from Home starts again, with a fresh ask', async () => {
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    const hidden = vi.spyOn(document, 'hidden', 'get');
    hidden.mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    hidden.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    hidden.mockRestore();
    expect(panel.asks).toBe(2);
    expect(count('timeshiftStart')).toBe(2);
  });
});

describe('while the buffer runs', () => {
  it('asks again every 60 s and never more often', async () => {
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush(); // the start ask
    expect(panel.asks).toBe(1);
    // Our own buffer makes the panel say 2 of 2: that is not another device.
    panel.active = 2;
    // (The start ask was LINE_CHECK_SETTLE_MS in; the next is 60 s after it.)
    await tick(LINE_RECHECK_MS - 1_000);
    expect(panel.asks).toBe(1);
    await tick(1_000);
    expect(panel.asks).toBe(2);
    await tick(LINE_RECHECK_MS - 1_000);
    expect(panel.asks).toBe(2);
    await tick(1_000);
    expect(panel.asks).toBe(3);
    await tick(LINE_RECHECK_MS * 5);
    expect(panel.asks).toBe(8);
    expect(count('timeshiftWipe')).toBe(0);
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it('stops asking when the buffer is wiped (player left)', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    h.rerender({ active: false, directUrl: null, stream: null });
    await tick(LINE_RECHECK_MS * 3);
    expect(panel.asks).toBe(1);
  });

  it('does not ask while the app is in the background', async () => {
    mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await tick(LINE_RECHECK_MS * 3);
    hidden.mockRestore();
    expect(panel.asks).toBe(1);
  });

  it('another device takes the last stream: jump to live, wipe, one toast, no ask for 5 minutes', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    // The viewer is 40 s behind live when the other TV starts (picture + buffer + the other TV = 3).
    status.value = { state: 'capturing', mode: 'buffer', availableSec: 300, behindSec: 40, usedBytes: 5 };
    panel.active = 3;
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('line-taken');
    expect(count('timeshiftGoLive')).toBe(1);
    expect(count('timeshiftWipe')).toBe(1);
    expect(at('timeshiftGoLive')).toBeLessThan(calls.map((c) => c.fn).lastIndexOf('timeshiftWipe'));
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy).toHaveBeenCalledWith({ title: 'Rewind turned off: another device is using your line\'s streams.' });
    expect(LINE_TAKEN_MESSAGE).toBe('Rewind turned off: another device is using your line\'s streams.');
    expect(rewindOffMessage('line-taken')).toBe(LINE_TAKEN_MESSAGE);
    // Not hammered: the next ask is after 5 minutes, or on the next channel.
    const asks = panel.asks;
    await tick(LINE_RETRY_MS - 5_000);
    expect(panel.asks).toBe(asks);
    // Still full after 5 minutes: it stays off (and waits another 5).
    await tick(5_100);
    await flush();
    expect(panel.asks).toBe(asks + 1);
    expect(h.result.current.kind).toBe('off');
    expect(h.result.current.offReason).toBe('line-full');
    expect(toastSpy).toHaveBeenCalledTimes(1);
    // The other TV stops: the next channel gets the buffer back.
    panel.active = 1;
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
  });

  it('a viewer on live is not moved: the wipe alone', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    panel.active = 3;
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.offReason).toBe('line-taken');
    expect(count('timeshiftGoLive')).toBe(0);
    expect(count('timeshiftWipe')).toBe(1);
  });

  it('after 5 minutes the buffer comes back if the line is free', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    panel.active = 3;
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.offReason).toBe('line-taken');
    panel.active = 1;
    await tick(LINE_RETRY_MS + 100);
    await flush(); // (each step in its own act: React renders between them)
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftStart')).toBe(2);
  });

  it('a 3-stream line with another TV already on: the buffer starts and stays; a third device ends it', async () => {
    panel.max = 3; panel.active = 2; // the picture and the other TV
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 3 });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    panel.active = 3; // now the buffer counts: the line is full, but nobody new
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.kind).toBe('buffer');
    panel.active = 4; // a third device
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.offReason).toBe('line-taken');
  });

  it('a line with streams left over is not given up when another device joins', async () => {
    panel.max = 5; panel.active = 1;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 5 });
    await flush();
    panel.active = 3; // buffer + another device, 2 of 5 streams still free
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.kind).toBe('buffer');
  });

  it('a failed or empty read while it runs changes nothing', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    panel.fail = true;
    await tick(LINE_RECHECK_MS);
    panel.fail = false; panel.active = undefined;
    await tick(LINE_RECHECK_MS);
    expect(panel.asks).toBe(3);
    expect(h.result.current.kind).toBe('buffer');
    expect(count('timeshiftWipe')).toBe(0);
  });

  it('a recording starting or stopping does not look like another device', async () => {
    panel.max = 4; panel.active = 1;
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 4 });
    await flush();
    // The recording joins: picture + buffer + recording = 3 of 4... and one lagging extra read.
    h.rerender({ active: true, directUrl: url(7), stream: CHANNEL, maxConnections: 4, activeRecordings: 1 });
    panel.active = 4;
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.kind).toBe('buffer');
    panel.active = 3;
    await tick(LINE_RECHECK_MS);
    expect(h.result.current.kind).toBe('buffer');
  });

  it('the provider refusing or dropping the capture ends the buffer the same way', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    status.value = { state: 'unavailable', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0, reason: 'The channel stopped sending, so rewind is paused.' };
    await tick(6_000); // the bar is on screen: the status is read every second
    expect(h.result.current.offReason).toBe('line-taken');
    expect(count('timeshiftWipe')).toBe(1);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(panel.asks).toBe(1); // no extra ask: the native status told us
  });

  it('a full disk is not the line: no toast, the note stays', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    status.value = { state: 'unavailable', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0, reason: 'Not enough free space on this box to rewind.' };
    await tick(2_000);
    expect(h.result.current.kind).toBe('buffer');
    expect(toastSpy).not.toHaveBeenCalled();
    expect(count('timeshiftWipe')).toBe(0);
  });
});

describe('panel catch-up', () => {
  it('uses the timeshift address and keeps nothing on the box', async () => {
    const h = mount({ active: true, directUrl: url(8), stream: ARCHIVE });
    await flush();
    expect(h.result.current.kind).toBe('catchup');
    expect(count('timeshiftStart')).toBe(0);
    expect(panel.asks).toBe(0); // no buffer, no extra stream: the panel is not asked about the line
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
