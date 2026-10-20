/**
 * A live channel off the air (its own address answers 404 / 410, or 5xx, and
 * it never played): the plugin gives up after its spread-out tries, about 8 s
 * (DeadStreamRule.kt), and this hook shows the error at once, without the
 * extra fresh start. It used to be 20 reconnects, a fresh start and 20 more:
 * minutes of "Buffering… try a VPN" before the error (and before a failover
 * to the viewer's other service). Everything else is unchanged. The Kotlin
 * half's rules are DeadStreamRuleTest's; its wiring is pinned here the way
 * the other player tests pin it.
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

import { isOffAirAnswer, useNativePlayer } from './useNativePlayer';
import { isChannelFailure } from '@/lib/channelStatus';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import rule from '../../android/app/src/main/java/com/snowmedia/player/DeadStreamRule.kt?raw';
import strings from '../../android/app/src/main/res/values/strings.xml?raw';

const CH = 'http://panel.example/live/u/p/1.ts';
const OFF_AIR = "This channel isn't on the air right now.";

const mount = (live = true) =>
  renderHook(() => useNativePlayer({ active: true, url: CH, volume: 1, live }));
const loads = () => calls.filter((c) => c.fn === 'load');
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
const ready = async () => {
  await waitFor(() => expect(loads()).toHaveLength(1));
  await waitFor(() => expect(listeners.get('playerError')?.length ?? 0).toBeGreaterThan(0));
};

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  vi.useRealTimers();
});

describe('a live channel off the air', () => {
  it.each([404, 410, 500, 502, 503, 504])('RECONNECT_EXHAUSTED with HTTP %i: the error at once, no fresh start', async (status) => {
    const h = mount();
    await ready();
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: status });
    expect(h.result.current.error).toEqual({ code: 'RECONNECT_EXHAUSTED', message: OFF_AIR, httpStatus: status, forUrl: CH });
    // It counts as the channel failing (reported, and the failover runs).
    expect(isChannelFailure(h.result.current.error)).toBe(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    expect(loads()).toHaveLength(1);
  });
});

describe('unchanged', () => {
  const freshStart = async (data: Record<string, unknown>, live = true) => {
    const h = mount(live);
    await ready();
    fire('playerError', data);
    expect(h.result.current.error).toBeNull();
    // The one fresh start, about a second later.
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    // Gives up for good the second time.
    fire('playerError', data);
    expect(h.result.current.error).toMatchObject({ code: 'RECONNECT_EXHAUSTED' });
  };

  it('a channel that kept dropping (the plugin\'s 20 reconnects, no status): one fresh start first', async () => {
    await freshStart({ code: 'RECONNECT_EXHAUSTED', message: 'The stream keeps dropping. Try again.' });
  });

  it('401 / 403 (the line\'s connection limit, a block): one fresh start first', async () => {
    await freshStart({ code: 'RECONNECT_EXHAUSTED', message: 'x', httpStatus: 403 });
  });

  it('a film the server turned down with 404: one fresh start first', async () => {
    await freshStart({ code: 'RECONNECT_EXHAUSTED', message: 'The server refused this file (HTTP 404).', httpStatus: 404 }, false);
  });

  it('isOffAirAnswer: only a live give-up with a "not there" or server-error status', () => {
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', 404, true)).toBe(true);
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', 503, true)).toBe(true);
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', 404, false)).toBe(false);
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', 403, true)).toBe(false);
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', 401, true)).toBe(false);
    expect(isOffAirAnswer('RECONNECT_EXHAUSTED', null, true)).toBe(false);
    expect(isOffAirAnswer('ERROR_CODE_IO_BAD_HTTP_STATUS', 404, true)).toBe(false);
    expect(isOffAirAnswer(undefined, 404, true)).toBe(false);
  });
});

describe('the plugin side (pinned)', () => {
  it('gives up after 404 / 410 twice or 5xx four times in a row, for the address, never before 8 s, on a live channel that has not played', () => {
    expect(rule).toMatch(/const val GONE_TRIES = 2/);
    expect(rule).toMatch(/const val SERVER_TRIES = 4/);
    expect(rule).toMatch(/const val FLOOR_MS = 8000L/);
    expect(rule).toMatch(/if \(!address\) null else when \(httpStatus\) \{\s*404, 410 -> Kind\.GONE\s*500, 502, 503, 504 -> Kind\.SERVER/);
    expect(rule).toMatch(/live && !played && kind != null && streak >= tries\(kind\) && sinceLoadMs >= FLOOR_MS/);
  });

  it('says RECONNECT_EXHAUSTED with the status and its own words, and skips the player\'s quiet retries of that answer', () => {
    expect(plugin).toMatch(/DeadStreamRule\.givesUp\([^)]*\)\) \{\s*giveUpOffAir\(s, screenId, httpStatus\)\s*return/);
    // Counted tries are spread out (1 s, 2 s, 4 s…), not the usual 500 ms.
    expect(plugin).toMatch(/reconnect\(s, screenId, httpRestartReason\(error, httpStatus\), DeadStreamRule\.retryDelayMs\(s\.deadStreak, sinceLoad\)\)/);
    expect(plugin).toMatch(/localized\(R\.string\.player_err_channel_off_air\)\)\s*\.put\("httpStatus", httpStatus \?: JSONObject\.NULL\)/);
    // Only the stream's own address (a playlist, or a raw stream with no format): an HLS segment keeps its retries.
    expect(plugin).toMatch(/val address = data\.dataType == C\.DATA_TYPE_MANIFEST \|\|\s*\(data\.dataType == C\.DATA_TYPE_MEDIA && data\.trackFormat == null\)/);
    expect(plugin).toMatch(/DeadStreamRule\.skipLoaderRetry\(s\.isLive, s\.playedThisLoad, e\.responseCode, address\)/);
    expect(plugin).toMatch(/DeadStreamRule\.kindOf\(httpStatus, s\.lastHttpAddress\)/);
    // Played since load() (a picture, or playing at all: a radio channel) keeps the patient reconnects;
    // playback getting going ends a run; a load starts everything over.
    expect(plugin).toMatch(/if \(isPlaying\) \{ s\.playedThisLoad = true; s\.deadKind = null; s\.deadStreak = 0 \}/);
    expect(plugin).toMatch(/if \(state == Player\.STATE_READY\) \{ s\.deadKind = null; s\.deadStreak = 0 \}/);
    expect(plugin).toMatch(/s\.firstFrameSeen = true\s*s\.playedThisLoad = true/);
    expect(plugin.match(/s\.playedThisLoad = false\s*\n\s*s\.deadKind = null\s*\n\s*s\.deadStreak = 0\s*\n\s*s\.lastHttpAddress = false/g)).toHaveLength(2);
    expect(plugin).toMatch(/@Volatile var isLive: Boolean = true/);
    expect(strings).toContain(`<string name="player_err_channel_off_air">This channel isn\\'t on the air right now.</string>`);
  });
});
