/**
 * A black screen with the channel's sound playing (owner, 2026-10-11: a Vibez
 * channel on an X96, backed out of and gone into again). Three ways it is
 * now dealt with:
 * - a blank cover whose load never comes is lifted again: by this hook at
 *   once when it knows its load is off, by the plugin after 1.5 s anyway;
 * - sound with no picture: the plugin attaches the surface again, builds a
 *   new player, tries the other kind of decoder, then says NO_PICTURE, which
 *   shows the error card at once (no automatic reloads on top);
 * - the page's renderer dying: every player stops, and the death is kept
 *   for analytics.
 * The Kotlin half can't run here (its rules are NoPictureRescueTest's); its
 * wiring is pinned the way the other player tests pin it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the imports; so must this be.
const { calls, listeners, gate } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  // While `hold` is on, a blank setRect waits until released: the run that
  // sent it is then caught between its blank and its load.
  gate: { hold: false, waiting: [] as Array<() => void> },
}));

vi.mock('@/capacitor/SnowPlayer', () => {
  const rec = (fn: string) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); };
  return {
    SnowPlayer: {
      setRect: async (opts?: Record<string, unknown>) => {
        calls.push({ fn: 'setRect', opts });
        if (opts?.blank && gate.hold) await new Promise<void>((r) => gate.waiting.push(r));
      },
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

import { useNativePlayer } from './useNativePlayer';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import rescue from '../../android/app/src/main/java/com/snowmedia/player/NoPictureRescue.kt?raw';
import activity from '../../android/app/src/main/java/com/snowmedia/MainActivity.kt?raw';
import gone from '../../android/app/src/main/java/com/snowmedia/RendererGone.kt?raw';
import strings from '../../android/app/src/main/res/values/strings.xml?raw';

const A = 'http://vibez.example/live/u/p/1.ts';
const B = 'http://vibez.example/live/u/p/2.ts';
const C = 'http://vibez.example/live/u/p/3.ts';

type Props = { url: string | null };
const mount = (url: string | null) =>
  renderHook((p: Props) => useNativePlayer({ active: true, url: p.url, volume: 1 }), { initialProps: { url } });
const loads = () => calls.filter((c) => c.fn === 'load');
const unblanks = () => calls.filter((c) => c.fn === 'setRect' && c.opts?.unblank === true);
const release = () => act(async () => { gate.hold = false; gate.waiting.splice(0).forEach((r) => r()); });
const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); });
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  gate.hold = false;
  gate.waiting.length = 0;
});

describe('useNativePlayer — a blank cover with no load behind it', () => {
  it('overtaken between its blank and its load by a change that loads nothing: the cover is lifted, nothing loads', async () => {
    const h = mount(A);
    await waitFor(() => expect(loads()).toHaveLength(1));
    gate.hold = true;
    h.rerender({ url: B });
    await waitFor(() => expect(calls.filter((c) => c.fn === 'setRect' && c.opts?.blank)).toHaveLength(2));
    // The address goes away while the player stays on: A plays on under the cover.
    h.rerender({ url: null });
    await tick();
    expect(unblanks()).toHaveLength(1);
    expect(unblanks()[0].opts).toMatchObject({ unblank: true });
    expect(unblanks()[0].opts?.blank).toBeFalsy();
    await release();
    await tick();
    expect(loads()).toHaveLength(1);
  });

  it('overtaken by another stream: no lift (that one blanks and loads itself)', async () => {
    const h = mount(A);
    await waitFor(() => expect(loads()).toHaveLength(1));
    gate.hold = true;
    h.rerender({ url: B });
    await waitFor(() => expect(gate.waiting).toHaveLength(1));
    h.rerender({ url: C });
    await tick();
    await release();
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ url: C });
    expect(unblanks()).toHaveLength(0);
  });

  it('a run whose load went out never lifts anything', async () => {
    const h = mount(A);
    await waitFor(() => expect(loads()).toHaveLength(1));
    h.rerender({ url: null });
    await tick();
    expect(unblanks()).toHaveLength(0);
  });
});

describe('useNativePlayer — NO_PICTURE', () => {
  it('shows the error card at once: the plugin has already tried everything', async () => {
    const h = mount(A);
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length ?? 0).toBeGreaterThan(0));
    fire('playerError', { code: 'NO_PICTURE', message: 'The picture didn\'t start. OK to retry.' });
    expect(h.result.current.error).toMatchObject({ code: 'NO_PICTURE', message: 'The picture didn\'t start. OK to retry.' });
  });

  it('an ordinary error still retries by itself first (no card yet)', async () => {
    const h = mount(A);
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length ?? 0).toBeGreaterThan(0));
    fire('playerError', { code: 'ERROR_CODE_IO_UNSPECIFIED', message: 'x' });
    expect(h.result.current.error).toBeNull();
  });
});

const fn = (src: string, sig: string) => {
  const at = src.indexOf(sig);
  expect(at, sig).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('\n    }\n', at));
};

describe('SnowPlayerPlugin.kt — black picture (pinned)', () => {
  it('a blank setRect arms the guard; unblank lifts at once; a load counts itself before the main thread', () => {
    const rect = fn(plugin, 'fun setRect(call: PluginCall)');
    expect(rect).toContain('if (blank) guardBlank(s)');
    expect(rect).toContain('if (unblank) liftUnusedBlank(s)');
    const load = fn(plugin, 'fun load(call: PluginCall)');
    expect(load.indexOf('s.loadsAsked++')).toBeGreaterThan(-1);
    expect(load.indexOf('s.loadsAsked++')).toBeLessThan(load.indexOf('activity?.runOnUiThread'));
    expect(fn(plugin, 'private fun blankVerdict(')).toContain('NoPictureRescue.blankGuard(s.blankUrl, s.currentUrl, s.blankLoads, s.loadsAsked, s.firstFrameSeen, playback)');
    // A load or a stop drops the guard (cancelTimers).
    expect(fn(plugin, 'private fun cancelTimers(')).toContain('s.blankGuard = null');
  });

  it('the cover still opens in one place only, and stays shut once every step has failed (the last channel\'s frame is under it)', () => {
    expect(fn(plugin, 'private fun openShutterIfReady(')).toContain('VideoFit.shutterOpen(s.firstFrameSeen, s.holding)');
    expect(fn(plugin, 'private fun liftBlank(')).toContain('openShutterIfReady(s)');
    expect(fn(plugin, 'private fun giveUpOnPicture(')).not.toContain('openShutterIfReady(s)');
  });

  it('the steps are armed with every first-picture wait, and the watchdog leaves sound-without-picture to them', () => {
    const wd = fn(plugin, 'private fun scheduleWatchdog(');
    expect(wd.indexOf('armNoPicture(s, screenId)')).toBeGreaterThan(wd.indexOf('if (!s.isLive && isPlexStream(Uri.parse(url))) return'));
    expect(wd.indexOf('s.noPictureSound')).toBeLessThan(wd.indexOf('reconnect(s, screenId, "no picture in 8 s")'));
    // None for mpv or a Plex film.
    expect(plugin).toContain('NoPictureRescue.applies(exo = true, plexFilm = !live && isPlexStream(Uri.parse(url)))');
  });

  it('each step records its reason and leaves a log line; the last one tells the WebView', () => {
    const step = fn(plugin, 'private fun takeNoPictureStep(');
    expect(step).toContain('s.lastRestartReason = reason');
    expect(step).toContain('Log.i(TAG, "$reason $what")');
    const give = fn(plugin, 'private fun giveUpOnPicture(');
    expect(give).toContain('.put("code", NoPictureRescue.ERROR_CODE)');
    expect(give).toContain('localized(R.string.player_err_no_picture)');
    expect(give.indexOf('s.lastError = NoPictureRescue.ERROR_CODE')).toBeLessThan(give.indexOf('notifyListeners('));
    expect(rescue).toContain('const val ERROR_CODE = "NO_PICTURE"');
    expect(strings).toContain('<string name="player_err_no_picture">');
  });

  it('the surface step hands the view back through Media3 (no raw Surface); the rebuild goes through buildPlayer', () => {
    const re = fn(plugin, 'private fun reattachSurface(');
    expect(re).toContain('p.clearVideoSurface()');
    expect(re).toContain('is SurfaceView -> p.setVideoSurfaceView(v)');
    expect(re).toContain('is TextureView -> p.setVideoTextureView(v)');
    const rb = fn(plugin, 'private fun rebuildForPicture(');
    expect(rb.indexOf('releasePlayer(s)')).toBeLessThan(rb.indexOf('buildPlayer(s, screenId)'));
    expect(rb).toContain('p.trackSelectionParameters =');
  });

  it('the other decoder order only for the title it was picked for; every other player keeps Media3\'s own', () => {
    expect(fn(plugin, 'private fun buildPlayer(')).toContain('if (s.videoOrder != NoPictureRescue.ORDER_DEFAULT) renderersFactory.setMediaCodecSelector(VideoDecoderOrder(s.videoOrder))');
    expect(fn(plugin, 'fun load(call: PluginCall)')).toContain('if (s.videoOrder != NoPictureRescue.ORDER_DEFAULT && s.videoOrderTitle != title) {');
    // Sound decoders are never reordered.
    expect(plugin).toContain('return if (MimeTypes.isVideo(mimeType)) NoPictureRescue.reorder(all, order) { it.softwareOnly } else all');
  });
});

describe('MainActivity.kt — the page\'s renderer gone (pinned)', () => {
  it('every player stops and the death is kept before the WebView goes and the activity is made again', () => {
    const at = activity.indexOf('override fun onRenderProcessGone(');
    const body = activity.slice(at, activity.indexOf('return true', at));
    const release = body.indexOf('releaseForDeadPage()');
    expect(release).toBeGreaterThan(-1);
    expect(release).toBeLessThan(body.indexOf('RendererGone.save('));
    expect(body.indexOf('RendererGone.save(')).toBeLessThan(body.indexOf('webView.destroy()'));
    expect(body).toContain('postDelayed({ recreate() }, 350)');
    // Nothing more is sent to the dead page.
    expect(activity).toContain('val webView = if (blocked || pageGone) null else bridge?.webView');
    const dead = fn(plugin, 'fun releaseForDeadPage(');
    expect(dead).toContain('releasePlayer(s)');
    expect(dead).not.toContain('notifyListeners');
  });

  it('the record is device facts only', () => {
    const save = gone.slice(gone.indexOf('fun save('), gone.indexOf('fun take('));
    const keys = [...save.matchAll(/\.put(?:Long|Boolean|Int|String)\("(\w+)"/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(['at', 'availMemMb', 'count', 'didCrash', 'lowMemory', 'model', 'playerActive', 'priority', 'sdk', 'totalMemMb', 'webView']);
  });
});
