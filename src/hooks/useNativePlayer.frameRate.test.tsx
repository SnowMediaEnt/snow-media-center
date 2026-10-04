/**
 * Frame-rate matching: a film or episode on the native player asks the TV
 * for a display mode fitting its frame rate (23.976 fps at 23.976 Hz instead
 * of 3:2 pulldown on 60 Hz), when the viewer's "Match frame rate" setting and
 * the remote `match_frame_rate` switch are both on (a missing row is on).
 * Live TV never does. The Kotlin half can't run here, so its shape is
 * pinned the way the other player tests pin it.
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
      seekTo: rec('seekTo'),
      stop: rec('stop'),
      setVolume: async () => {},
      getPosition: async () => ({ position: 0, duration: 5400, playing: true }),
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
import { lastSeekAt, markSeek } from '@/lib/playerSeek';
import { MATCH_FRAME_RATE_KEY, saveMatchFrameRate } from '@/lib/playerFlags';
import { writeCachedFlag, clearCachedFlag } from '@/lib/featureFlagCache';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import matcher from '../../android/app/src/main/java/com/snowmedia/player/FrameRateMatch.kt?raw';
import manifest from '../../android/app/src/main/AndroidManifest.xml?raw';
import mainActivity from '../../android/app/src/main/java/com/snowmedia/MainActivity.kt?raw';

const FILM = 'https://srv.plex.direct:32400/library/parts/42/1700000000/file.mkv';
const CHANNEL = 'http://iptv.example/live/1.ts';

type Props = { url: string | null; live?: boolean; frameRate?: number };
const mount = (p: Props) => renderHook((q: Props) => useNativePlayer({ active: true, url: q.url, volume: 1, live: q.live, frameRate: q.frameRate }), { initialProps: p });
const loads = () => calls.filter((c) => c.fn === 'load');
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
/** A function's body in the Kotlin source, up to the next top-level member. */
const fn = (name: string) => {
  const at = plugin.indexOf(`fun ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const next = plugin.indexOf('\n    private fun ', at + 10);
  return plugin.slice(at, next > 0 ? next : undefined);
};

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  localStorage.removeItem(MATCH_FRAME_RATE_KEY);
  clearCachedFlag('match_frame_rate');
  markSeek(0);
});

describe('frame-rate matching — what goes with load()', () => {
  it('a film asks for it, with the frame rate Plex knows', async () => {
    mount({ url: FILM, live: false, frameRate: 23.976 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).toMatchObject({ url: FILM, matchFrameRate: true, frameRate: 23.976 });
  });

  it('a film with no known rate still asks (the player finds it); no frameRate is sent', async () => {
    mount({ url: FILM, live: false });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts?.matchFrameRate).toBe(true);
    expect(loads()[0].opts).not.toHaveProperty('frameRate');
  });

  it('Live TV never does', async () => {
    mount({ url: CHANNEL, frameRate: 25 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).not.toHaveProperty('matchFrameRate');
    expect(loads()[0].opts).not.toHaveProperty('frameRate');
  });

  it('the viewer turned it off: not asked for', async () => {
    saveMatchFrameRate(false);
    mount({ url: FILM, live: false, frameRate: 24 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).not.toHaveProperty('matchFrameRate');
  });

  it('the remote switch is off: not asked for; a missing row is on', async () => {
    writeCachedFlag('match_frame_rate', false);
    const a = mount({ url: FILM, live: false });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).not.toHaveProperty('matchFrameRate');
    a.unmount();
    calls.length = 0;
    clearCachedFlag('match_frame_rate');
    mount({ url: FILM, live: false });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts?.matchFrameRate).toBe(true);
  });

  it('a display mode switch counts as a jump for automatic quality (its blank is no stall)', async () => {
    mount({ url: FILM, live: false });
    await waitFor(() => expect(listeners.get('displayMode')?.length).toBe(1));
    markSeek(0);
    fire('displayMode', { screenId: 'main', fps: 23.976, refreshHz: 23.976 });
    expect(lastSeekAt()).toBeGreaterThan(0);
    markSeek(0);
    fire('displayMode', { screenId: 'ms1', fps: 25, refreshHz: 50 });
    expect(lastSeekAt()).toBe(0);
  });
});

describe('frame-rate matching — the native side (pinned)', () => {
  it('asks the window for the mode (what Fire OS honours) and only for a film on the main player', () => {
    const apply = fn('applyFrameRate');
    expect(fn('setPreferredMode')).toContain('lp.preferredDisplayModeId = modeId');
    expect(apply).toContain('if (!setPreferredMode(act, pick.id)) return');
    expect(apply).toContain('FrameRateMatch.decide(shown, requestedMode, modeBefore, modes, useFps, restoring)');
    expect(apply).toMatch(/screenId != MAIN \|\| !s\.matchFrameRate \|\| s\.isLive/);
    // Never a change of size (that would be a configuration change).
    expect(apply).toContain('pick.width != shown.width || pick.height != shown.height');
    // A trailer is left alone.
    expect(apply).toContain('MIN_MATCH_DURATION_MS');
    expect(plugin).toMatch(/MIN_MATCH_DURATION_MS = 5 \* 60_000L/);
    // load(): only a non-live main load may match.
    expect(plugin).toContain('s.matchFrameRate = matchFrameRate && !live && screenId == MAIN');
  });

  it('the rate: the WebView\'s first, then the stream\'s, then an estimate; logged once with numbers only', () => {
    const m = fn('matchFrameRate');
    // Plex's approximate label gives way to the stream's own rate within 1 %.
    expect(m).toContain('s.hintFps > 0f && own > 0f && Math.abs(own - s.hintFps) <= s.hintFps * 0.01f -> applyFrameRate(s, screenId, own, "format")');
    expect(m.indexOf('s.hintFps > 0f -> applyFrameRate(s, screenId, s.hintFps, "plex")')).toBeLessThan(m.indexOf('own > 0f -> applyFrameRate'));
    expect(m.indexOf('own > 0f -> applyFrameRate')).toBeLessThan(m.indexOf('FpsEstimator('));
    expect(plugin).toContain('Log.i(TAG, "fps=${FrameRateMatch.label(fps)} src=$source")');
    expect(plugin).toContain('"estimate")');
    // No log line in the matching code names an address.
    const logs = (fn('applyFrameRate') + fn('restoreDisplayMode')).match(/Log\.[iw]\([^\n]*/g) ?? [];
    for (const l of logs) expect(l).not.toMatch(/url|Url|uri|token/i);
  });

  it('the film waits in its start-up hold until the TV is in the new mode (4 s at most)', () => {
    const begin = fn('beginModeSwitch');
    expect(begin).toContain('s.modeWaitUntilMs = switchWaitUntilMs');
    expect(plugin).toContain('&& !(s.modeWaitUntilMs != 0L && now < s.modeWaitUntilMs)');
    expect(fn('watchDisplayMode')).toContain('registerDisplayListener');
    expect(plugin).toMatch(/MODE_WAIT_MS = 4000L/);
  });

  it('Media3 asks for no mode of its own while SMC manages it', () => {
    expect(plugin).toContain('if (s.matchFrameRate) C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF else C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS');
  });

  it('the screen goes back: on stop (a moment later, so a quality change keeps it), a live load, the slot released, the app leaving', () => {
    expect(fn('stopSlot')).toContain('mainHandler.postDelayed(restoreModeRunnable, MODE_RESTORE_DELAY_MS)');
    expect(plugin).toContain('if (!s.matchFrameRate) restoreDisplayMode()');
    expect(fn('releaseSlot')).toContain('restoreDisplayMode()');
    const onStop = plugin.slice(plugin.indexOf('override fun handleOnStop()'), plugin.indexOf('override fun handleOnDestroy()'));
    expect(onStop).toContain('restoreDisplayMode()');
    expect(fn('restoreDisplayMode')).toContain('lp.preferredDisplayModeId = 0');
  });

  it('the HDMI blank is no stall: not counted, the first-picture watchdog starts over, a lost sound output resumes the film', () => {
    expect(plugin).toMatch(/if \(inModeSwitch\(s\)\) \{\s*\/\/[^\n]*\n\s*s\.stallStartedAtMs = s\.modeSwitchUntilMs\s*s\.stallUncounted = true/);
    expect(plugin).toContain('if (s.stallUncounted) s.stalls++');
    expect(fn('beginModeSwitch')).toContain('if (s.watchdogRunnable != null) scheduleWatchdog(s, screenId)');
    expect(plugin).toContain('if (isAudioTrack && inModeSwitch(s)');
  });

  it('the picker: same resolution, exact first, 3:2 pulldown only as a last resort', () => {
    expect(matcher).toContain('it.width == current.width && it.height == current.height');
    expect(matcher).toContain('if (isExact(current.refreshRate, fps)) return null');
    expect(matcher).toContain('if (fits(current.refreshRate, fps) && !anyExact) return null');
  });

  it('the activity rides out a display mode change instead of being recreated', () => {
    expect(manifest).toContain('android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"');
    expect(mainActivity).toContain('Log.i("SMC-Activity", "SMC-Activity created")');
  });

  it('the stats report the screen\'s refresh rate', () => {
    expect(plugin).toContain('o.put("displayHz", displayHz() ?: JSONObject.NULL)');
  });

  it('review fixes: the last title\'s mode never sticks, a mid-play switch holds, HDMI re-sync, ignored requests, pending switches', () => {
    const apply = fn('applyFrameRate');
    // F1: unknown rate, VFR (an estimate of none) and trailers go through decide (Restore).
    expect(apply).toContain('val useFps = if (fps != null && fps > 0f && !short) fps else null');
    expect(apply).toContain('is FrameRateMatch.Decision.Restore -> {');
    expect(fn('timeFrame')).toContain('val fps = FrameRateMatch.estimate(e.pts, e.count)\n');
    // F2: a switch while playing re-enters the hold and resumes there.
    const begin = fn('beginModeSwitch');
    expect(begin).toMatch(/s\.holding = true\s*s\.modeWaitUntilMs = switchWaitUntilMs\s*p\.playWhenReady = false\s*schedulePreBuffer\(s, screenId, midFile = true\)/);
    // F3: the display has the mode; HDMI gets 1.5 s more.
    const watch = fn('watchDisplayMode');
    expect(watch).toContain('if (s.modeWaitUntilMs != 0L) s.modeWaitUntilMs = t');
    expect(watch).toContain('s.modeSwitchUntilMs = maxOf(s.modeSwitchUntilMs, t)');
    expect(plugin).toMatch(/MODE_RESYNC_MS = 1500L/);
    // F4: already on screen: attribute only; an ignored request stops later waits.
    expect(apply).toContain('if (pick.id != shown.id) beginModeSwitch(s, screenId, pick, useFps, request = true)');
    expect(begin).toContain('if (!modeRequestsIgnored) {');
    expect(begin).toContain('modeRequestsIgnored = true');
    // F6: a load during a pending switch keeps the grace and waits.
    expect(fn('load')).toContain('if (s.matchFrameRate && switchPending()) {');
    expect(fn('stopSlot')).toContain('if (!(slots[MAIN] === s && switchPending())) s.modeSwitchUntilMs = 0L');
    // F7: restore 4 s after a stop; a restore in flight is pinned.
    expect(plugin).toMatch(/MODE_RESTORE_DELAY_MS = 4000L/);
    expect(apply).toContain('is FrameRateMatch.Decision.Pin -> {');
    expect(fn('restoreDisplayMode')).toContain('restoringFrom = asked');
  });
});
