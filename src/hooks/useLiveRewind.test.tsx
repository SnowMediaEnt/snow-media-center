/**
 * Rewind live TV (TRACKER 25): when the on-box buffer starts, and every way it
 * is wiped (leaving the player, switching rewind off, unmount), the buffer
 * coming back after Home, panel catch-up channels using the timeshift address
 * instead (no buffer), and the one gate left: never on mpv. The buffer uses no
 * stream of its own next to the picture (it is fed by the player's connection,
 * see TimeshiftSession.kt), so neither the plan's streams, the panel's count
 * nor recordings decide anything, and the panel is never asked. Stream
 * addresses carry the line's password: none of this may print one. (Sign-out
 * wipes in playerSignOut, tested there.)
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LIVE_STATUS = { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 };
const { calls, status, panel, toastSpy } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  status: { value: { state: 'capturing', mode: 'live', availableSec: 120, behindSec: 0, usedBytes: 1 } as Record<string, unknown> },
  // `asks` counts every read of the panel's account (catch-up's clock offset only).
  panel: { asks: 0 },
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
    return {
      server_info: { time_now: '2026-09-28 12:00:00', timestamp_now: Date.UTC(2026, 8, 28, 12, 0, 0) / 1000 },
      user_info: { max_connections: 1, active_cons: 1 },
    };
  },
}));
vi.mock('@/hooks/use-toast', () => ({ toast: toastSpy }));

import { rewindOffMessage, timeshiftShownKey, useLiveRewind } from './useLiveRewind';
import { REWIND_SETTINGS_KEY, saveRewindSettings } from '@/lib/liveRewind';

// Slow under a loaded full run (fake timers and many hook renders); the default 5 s flakes.
vi.setConfig({ testTimeout: 20_000 });

const LINE = { host: 'http://panel.example', username: 'viewer', password: 'S3cretPass', output: 'ts' as const };
const url = (id: number) => `${LINE.host}/live/${LINE.username}/${LINE.password}/${id}.ts`;
const CHANNEL = { stream_id: 7 };
const ARCHIVE = { stream_id: 8, tv_archive: 1, tv_archive_duration: 3 };

type P = {
  active: boolean; directUrl: string | null; stream: typeof CHANNEL | typeof ARCHIVE | null;
  engine?: 'exo' | 'mpv';
};
const mount = (p: P) => renderHook((q: P) => useLiveRewind({ ...q, line: LINE, watching: true }), { initialProps: p });
const count = (fn: string) => calls.filter((c) => c.fn === fn).length;
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const flush = () => tick(50);

let logSpies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  status.value = { ...LIVE_STATUS };
  panel.asks = 0;
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
    // A new channel: a new buffer starts at once (the native side closes the
    // old one as the new key starts: no wipe from here, no gap to wait).
    h.rerender({ active: true, directUrl: url(9), stream: { stream_id: 9 } });
    await flush();
    expect(count('timeshiftStart')).toBe(2);
    expect(calls.filter((c) => c.fn === 'timeshiftStart')[1].opts).toMatchObject({ key: 'http://panel.example|9' });
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

describe('no stream gate (the buffer uses no stream of its own)', () => {
  it('starts at once, without asking the panel', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    expect(h.result.current.kind).toBe('buffer');
    expect(h.result.current.offReason).toBeNull();
    expect(count('timeshiftStart')).toBe(1);
    await tick(10 * 60_000);
    expect(panel.asks).toBe(0);
    expect(count('timeshiftWipe')).toBe(0);
  });

  it('a capture that stops shows its reason; nothing is wiped and nothing is said to another device', async () => {
    const h = mount({ active: true, directUrl: url(7), stream: CHANNEL });
    await flush();
    status.value = { state: 'unavailable', mode: 'live', availableSec: 0, behindSec: 0, usedBytes: 0, reason: 'The channel stopped sending, so rewind is paused.' };
    await tick(2_000);
    expect(h.result.current.kind).toBe('buffer');
    expect(h.result.current.info?.note).toMatch(/stopped sending/);
    expect(count('timeshiftWipe')).toBe(0);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(panel.asks).toBe(0);
  });

  it('a catch-up channel still uses the archive', async () => {
    const h = mount({ active: true, directUrl: url(8), stream: ARCHIVE });
    await flush();
    expect(h.result.current.kind).toBe('catchup');
    expect(count('timeshiftStart')).toBe(0);
  });
});

describe('while the buffer runs', () => {
  it('the 1 s status tick re-renders only when what is shown changes', async () => {
    let renders = 0;
    renderHook((q: P) => { renders += 1; return useLiveRewind({ ...q, line: LINE, watching: true }); },
      { initialProps: { active: true, directUrl: url(7), stream: CHANNEL } as P });
    await flush();
    await tick(2_000);
    expect(count('timeshiftStatus')).toBeGreaterThan(0);
    const before = renders;
    const asked = count('timeshiftStatus');
    await tick(10_000);
    expect(count('timeshiftStatus') - asked).toBeGreaterThanOrEqual(9);
    expect(renders).toBe(before);
    status.value = { ...LIVE_STATUS, availableSec: 121 };
    await tick(1_000);
    expect(renders).toBeGreaterThan(before);
  });

  it('timeshiftShownKey: whole seconds with the bar up, only the thresholds with it hidden', () => {
    const st = { state: 'capturing' as const, mode: 'buffer' as const, availableSec: 120.2, behindSec: 30.4, usedBytes: 1 };
    expect(timeshiftShownKey(st, true)).toBe(timeshiftShownKey({ ...st, availableSec: 120.9, usedBytes: 9 }, true));
    expect(timeshiftShownKey(st, true)).not.toBe(timeshiftShownKey({ ...st, availableSec: 121 }, true));
    expect(timeshiftShownKey(st, false)).toBe(timeshiftShownKey({ ...st, availableSec: 300, behindSec: 50 }, false));
    expect(timeshiftShownKey(st, false)).not.toBe(timeshiftShownKey({ ...st, mode: 'live' }, false));
    expect(timeshiftShownKey(st, false)).not.toBe(timeshiftShownKey({ ...st, behindSec: 119.5 }, false));
    expect(timeshiftShownKey(st, false)).not.toBe(timeshiftShownKey({ ...st, state: 'unavailable', reason: 'The provider stopped sending' }, false));
  });

  it('a full disk: no toast, nothing wiped, the note stays', async () => {
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
    expect(rewindOffMessage('engine')).toMatch(/ExoPlayer/);
  });
});
