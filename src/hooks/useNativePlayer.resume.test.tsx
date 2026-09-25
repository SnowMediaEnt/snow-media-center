/**
 * "My Plex loads quick but then buffers." The native player now gets a film's
 * start position with load() (it used to open the file at 0 and seek once
 * load() had answered), and a reload of the stream being watched — a retry
 * after an error, or the app coming back from the background — picks the
 * film up where the viewer is instead of at the position it first started
 * from (the very beginning of a film that was not resumed). Live TV loads
 * exactly as before. The Kotlin half can't run here, so its shape is pinned
 * the way the other player tests pin it.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the imports; so must this be.
const { calls, listeners, player } = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; opts?: Record<string, unknown> }>,
  listeners: new Map<string, Array<(d: Record<string, unknown>) => void>>(),
  // What the fake player reports; stop() clears it like the real one.
  player: { position: 0 },
}));

vi.mock('@/capacitor/SnowPlayer', () => {
  const rec = (fn: string) => async (opts?: Record<string, unknown>) => { calls.push({ fn, opts }); };
  return {
    SnowPlayer: {
      setRect: rec('setRect'),
      load: rec('load'),
      seekTo: rec('seekTo'),
      stop: async () => { calls.push({ fn: 'stop' }); player.position = 0; },
      setVolume: async () => {},
      getPosition: async () => { calls.push({ fn: 'getPosition' }); return { position: player.position, duration: 5400, playing: true }; },
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
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';

const FILM = 'https://srv.plex.direct:32400/library/parts/42/1700000000/file.mkv';
const CHANNEL = 'http://iptv.example/live/1.ts';

type Props = { url: string | null; live?: boolean; startPosition?: number };
function mount(initial: Props) {
  return renderHook(
    (p: Props) => useNativePlayer({ active: true, url: p.url, volume: 1, live: p.live, startPosition: p.startPosition }),
    { initialProps: initial },
  );
}
const loads = () => calls.filter((c) => c.fn === 'load');
const asked = () => calls.filter((c) => c.fn === 'getPosition');
const fire = (ev: string, data: Record<string, unknown>) => act(() => { (listeners.get(ev) ?? []).forEach((cb) => cb(data)); });
let hidden = false;
const setHidden = (h: boolean) => act(() => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); });

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
  player.position = 0;
  hidden = false;
  markSeek(0);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => {
  delete (document as unknown as { hidden?: boolean }).hidden;
});

describe('useNativePlayer — where a film starts and resumes', () => {
  it('a resumed film: the start position goes with load(), no seek after it', async () => {
    mount({ url: FILM, live: false, startPosition: 1800 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).toMatchObject({ url: FILM, live: false, isLive: false, startPosition: 1800 });
    // Let the rest of the pipeline run: still no seek.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls.some((c) => c.fn === 'seekTo')).toBe(false);
    // Still a jump for automatic quality, as the old post-load seek was.
    expect(lastSeekAt()).toBeGreaterThan(0);
  });

  it('no start position (Live TV, a film from the top): load() carries none', async () => {
    mount({ url: CHANNEL });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).toEqual({ url: CHANNEL, live: true, isLive: true, subtitles: undefined });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls.some((c) => c.fn === 'seekTo')).toBe(false);
    expect(asked()).toHaveLength(0);
    expect(lastSeekAt()).toBe(0);
  });

  it('an error retry picks the film up where it is, not at its first start', async () => {
    mount({ url: FILM, live: false, startPosition: 60 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length).toBe(1));
    player.position = 1234.5; // watched on from 1:00 to 20:34
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: 'The stream keeps dropping.' });
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    expect(loads()[1].opts).toMatchObject({ url: FILM, startPosition: 1234.5 });
  });

  it('a film played from the beginning no longer restarts at 0 after an error', async () => {
    mount({ url: FILM, live: false });
    await waitFor(() => expect(loads()).toHaveLength(1));
    expect(loads()[0].opts).not.toHaveProperty('startPosition');
    await waitFor(() => expect(listeners.get('playerError')?.length).toBe(1));
    player.position = 900;
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: 'x' });
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    expect(loads()[1].opts).toMatchObject({ startPosition: 900 });
  });

  it('Retry on the error panel also resumes at the current position', async () => {
    const h = mount({ url: FILM, live: false, startPosition: 60 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    player.position = 3000;
    act(() => { h.result.current.retry(); });
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ startPosition: 3000 });
  });

  it('back from the background: the film resumes where it was when the app left', async () => {
    mount({ url: FILM, live: false, startPosition: 60 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    player.position = 2500;
    await setHidden(true);
    // Its place is read before the stop that clears it.
    const iAsk = calls.findIndex((c) => c.fn === 'getPosition');
    const iStop = calls.findIndex((c) => c.fn === 'stop');
    expect(iAsk).toBeGreaterThan(-1);
    expect(iAsk).toBeLessThan(iStop);
    await setHidden(false);
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ url: FILM, startPosition: 2500 });
  });

  it('Live TV: a retry or a return reloads at the live edge, and never asks for a position', async () => {
    mount({ url: CHANNEL });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length).toBe(1));
    player.position = 500;
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: 'x' });
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    await setHidden(true);
    await setHidden(false);
    await waitFor(() => expect(loads()).toHaveLength(3));
    for (const l of loads()) expect(l.opts).toEqual({ url: CHANNEL, live: true, isLive: true, subtitles: undefined });
    expect(asked()).toHaveLength(0);
  });

  it('a film whose server is gone: one fresh start after RECONNECT_EXHAUSTED, then the error', async () => {
    const h = mount({ url: FILM, live: false, startPosition: 60 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length).toBe(1));
    player.position = 700;
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: 'The server stopped responding. Try again.' });
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    expect(loads()[1].opts).toMatchObject({ startPosition: 700 });
    expect(h.result.current.error).toBeNull();
    // The fresh start fails the same way: now the viewer is told.
    fire('playerError', { code: 'RECONNECT_EXHAUSTED', message: 'The server stopped responding. Try again.' });
    await waitFor(() => expect(h.result.current.error).toEqual({ code: 'RECONNECT_EXHAUSTED', message: 'The server stopped responding. Try again.' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(loads()).toHaveLength(2);
  });

  it('a server that refused the film: the plugin\'s words reach the panel as they are', async () => {
    const h = mount({ url: FILM, live: false });
    await waitFor(() => expect(loads()).toHaveLength(1));
    await waitFor(() => expect(listeners.get('playerError')?.length).toBe(1));
    const refused = { code: 'RECONNECT_EXHAUSTED', message: 'The Plex server refused this file (HTTP 404).' };
    fire('playerError', refused);
    await waitFor(() => expect(loads()).toHaveLength(2), { timeout: 3000 });
    expect(h.result.current.error).toBeNull();
    fire('playerError', refused);
    await waitFor(() => expect(h.result.current.error).toEqual(refused));
  });

  it('a new title starts at its own start position, not at the last one\'s place', async () => {
    const h = mount({ url: FILM, live: false, startPosition: 60 });
    await waitFor(() => expect(loads()).toHaveLength(1));
    player.position = 4000;
    await setHidden(true);
    // A different title while away: the saved place belonged to the old one.
    h.rerender({ url: `${FILM}?v=2`, live: false, startPosition: 30 });
    await waitFor(() => expect(loads()).toHaveLength(2));
    expect(loads()[1].opts).toMatchObject({ startPosition: 30 });
  });
});

describe('SnowPlayerPlugin.kt — a stream that starts fine keeps playing', () => {
  const body = (from: string) => plugin.slice(plugin.indexOf(from), plugin.indexOf('\n    }\n', plugin.indexOf(from)));

  it('main slot tops its buffer up continuously (low mark = high mark), size before time', () => {
    // 2 GB boxes: 50 s within 128 MB, over a 20 s floor.
    const low = plugin.slice(plugin.indexOf('} else if (lowRam) {'), plugin.indexOf('} else {', plugin.indexOf('} else if (lowRam) {')));
    expect(low).toMatch(/FlooredLoadControl\(\s*minBufferMs = 50000,\s*maxBufferMs = 50000,\s*bufferForPlaybackMs = 2500,\s*bufferForPlaybackAfterRebufferMs = 5000,\s*targetBufferBytes = 128 \* 1024 \* 1024,\s*floorMs = 20000,/);
    expect(plugin).toContain('.setBufferDurationsMs(120000, 120000, 2500, 5000)');
    // The old fill-then-wait profiles are gone.
    expect(plugin).not.toContain('setBufferDurationsMs(20000, 60000');
    expect(plugin).not.toContain('setBufferDurationsMs(60000, 120000');
    // Multi-Screen tiles are unchanged, and the only profile that puts time first.
    expect(plugin).toContain('.setBufferDurationsMs(4000, 15000, 1000, 2000)');
    expect(plugin.match(/setPrioritizeTimeOverSizeThresholds\(true\)/g)).toHaveLength(1);
  });

  it('Plex files and conversions get the patient source with a user agent; Live TV keeps 8 s and no agent', () => {
    expect(plugin).toMatch(/fun isPlexStream\(uri: Uri\)[\s\S]*"\/library\/parts\/"[\s\S]*"\/transcode\/universal\/"/);
    const plex = plugin.slice(plugin.indexOf('val plexFactory'), plugin.indexOf('val dataSourceFactory'));
    expect(plex).toContain('.setReadTimeoutMs(30000)');
    expect(plex).toContain('.setConnectTimeoutMs(15000)');
    expect(plex).toMatch(/\.setUserAgent\(\s*"SnowMediaCenter\/\$\{BuildConfig\.VERSION_NAME\} \(Linux; Android \$\{Build\.VERSION\.RELEASE\}\) " \+\s*"ExoPlayerLib\/\$\{MediaLibraryInfo\.VERSION\}"/);
    const http = plugin.slice(plugin.indexOf('val httpFactory'), plugin.indexOf('val plexFactory'));
    expect(http).toContain('.setReadTimeoutMs(8000)');
    expect(http).not.toContain('setUserAgent');
    expect(plugin.match(/setUserAgent\(/g)).toHaveLength(1);
    expect(plugin).toContain('PlexAwareFactory(httpFactory, plexFactory)');
  });

  it('the first-frame watchdog skips Plex films only; channels and Backups films keep it', () => {
    const wd = body('private fun scheduleWatchdog(');
    expect(wd).toContain('if (!s.isLive && isPlexStream(Uri.parse(url))) return');
    expect(wd).not.toContain('if (!s.isLive) return');
    expect(wd).toContain('reconnect(s, screenId, "no picture in 8 s")');
    // A film's reconnect re-arms it, as it always did (a Plex one returns at once).
    expect(body('private fun reconnect(')).toMatch(/resumeVod\(s, screenId, p, url\)\s*scheduleWatchdog\(s, screenId\)/);
    // load() still arms it for everything.
    expect(body('fun load(call: PluginCall)')).toContain('scheduleWatchdog(s, screenId)');
  });

  it('the 20 s floor overrides the shouldContinueLoading Media3 1.5.0 calls, and always asks the parent', () => {
    const cls = plugin.slice(plugin.indexOf('private class FlooredLoadControl('), plugin.indexOf('/** Counts the bytes'));
    expect(cls).toContain(') : DefaultLoadControl(');
    expect(cls).toContain('/* prioritizeTimeOverSizeThresholds= */ false');
    expect(cls).toMatch(/override fun shouldContinueLoading\(parameters: LoadControl\.Parameters\): Boolean \{\s*val bySize = super\.shouldContinueLoading\(parameters\)\s*return bySize \|\| parameters\.bufferedDurationUs < floorUs/);
    expect(cls).toContain('private val floorUs = floorMs * 1000L');
  });

  it('a film gives up after MAX_VOD_RECONNECTS: a failed server as RECONNECT_EXHAUSTED, anything else by its own name', () => {
    // 3: about 16 minutes of a dead server before the panel (5 took ~24).
    expect(plugin).toContain('private const val MAX_VOD_RECONNECTS = 3');
    expect(plugin).toContain('DefaultLoadErrorHandlingPolicy(6)');
    const err = plugin.slice(plugin.indexOf('override fun onPlayerError('), plugin.indexOf('override fun onTracksChanged('));
    expect(err).toContain('val vodSpent = !s.isLive && s.reconnectAttempts >= MAX_VOD_RECONNECTS');
    expect(err).toContain('if (s.currentUrl != null && !vodSpent && s.reconnectAttempts < MAX_RECONNECTS) {');
    expect(err).toMatch(/vodSpent && error\.errorCodeName\.startsWith\("ERROR_CODE_IO_"\)\) \{\s*notifyListeners\(\s*"playerError",\s*JSObject\(\)\.put\("screenId", screenId\)\s*\.put\("code", "RECONNECT_EXHAUSTED"\)\s*\.put\("message", exhaustedMessage\(error, url\)\)/);
    // The audio-decode path still comes first; the last word is still the error's own name.
    expect(err.indexOf('"AUDIO_DECODE"')).toBeLessThan(err.indexOf('vodSpent'));
    expect(err).toMatch(/\.put\("code", error\.errorCodeName\)[^\n]*\n\s*\}\s*$/);
    // Live channels keep their 20.
    expect(body('private fun reconnect(')).toContain('if (s.reconnectAttempts >= MAX_RECONNECTS) {');
  });

  it('a film that gives up says how its server failed, and never with a URL', () => {
    const msg = body('private fun exhaustedMessage(');
    // Stopped answering: worth another try.
    expect(msg).toMatch(/ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,\s*PlaybackException\.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,\s*PlaybackException\.ERROR_CODE_IO_UNSPECIFIED,\s*-> "The server stopped responding\. Try again\."/);
    // Turned down: the HTTP status when there is one.
    expect(msg).toMatch(/ERROR_CODE_IO_BAD_HTTP_STATUS -> \{\s*val status = httpStatusOf\(error\)\s*if \(status != null\) "\$server refused this file \(HTTP \$status\)\." else "\$server refused this file\."/);
    expect(msg).toMatch(/ERROR_CODE_IO_FILE_NOT_FOUND,\s*PlaybackException\.ERROR_CODE_IO_NO_PERMISSION,\s*-> "\$server refused this file\."/);
    expect(msg).toContain('val server = if (isPlexStream(Uri.parse(url))) "The Plex server" else "The server"');
    // Anything else in the player's words, unless they carry an address.
    expect(msg).toContain('else -> error.message?.takeIf { it.isNotBlank() && !it.contains("://") } ?: "Playback error"');
    expect(msg).not.toMatch(/\$url|\+ url|dataSpec|\.uri/);
    const status = body('private fun httpStatusOf(');
    expect(status).toContain('if (t is HttpDataSource.InvalidResponseCodeException) return t.responseCode.takeIf { it > 0 }');
    expect(status).not.toContain('responseMessage');
    expect(plugin).toContain('import androidx.media3.datasource.HttpDataSource');
  });

  it('lastError is set before any playerError goes out', () => {
    const err = plugin.slice(plugin.indexOf('override fun onPlayerError('), plugin.indexOf('override fun onTracksChanged('));
    const set = err.indexOf('s.lastError = error.errorCodeName');
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(err.indexOf('notifyListeners('));
    expect(set).toBeLessThan(err.indexOf('reconnect(s, screenId, reason)'));
    expect(err.match(/s\.lastError = /g)).toHaveLength(1);
  });

  it('load() starts at the start position and remembers it for a reconnect', () => {
    const load = body('fun load(call: PluginCall)');
    expect(load).toContain('call.getDouble("startPosition")');
    expect(load).toContain('s.lastPositionMs = startMs');
    expect(load).toContain('if (startMs > 0) p.setMediaItem(item, startMs) else p.setMediaItem(item)');
    expect(load.indexOf('p.setMediaItem(item, startMs)')).toBeLessThan(load.indexOf('p.prepare()'));
  });

  it('a film reconnects in place, keeping the viewer\'s play or pause and re-running a start-up hold', () => {
    const rc = body('private fun reconnect(');
    // Live keeps what it did.
    expect(rc).toMatch(/if \(s\.isLive\) \{\s*p\.setMediaItem\(buildMediaItem\(url, s\.currentSubtitles\)\)\s*p\.prepare\(\)\s*p\.playWhenReady = true\s*scheduleWatchdog\(s, screenId\)/);
    expect(rc).toContain('resumeVod(s, screenId, p, url)');
    const vod = body('private fun resumeVod(');
    expect(vod).toContain('val resumeAt = if (pos > 0) pos else s.lastPositionMs');
    expect(vod).toContain('p.playbackState == Player.STATE_IDLE && p.currentMediaItem != null');
    expect(vod).toContain('p.prepare()');
    expect(vod).not.toContain('playWhenReady = true');
    expect(vod).not.toContain('scheduleWatchdog');
    expect(vod).toMatch(/if \(hold\) \{\s*p\.playWhenReady = false\s*schedulePreBuffer\(s, screenId\)/);
  });

  it('a film or episode on the main player holds its own Wi-Fi lock; Live TV never does', () => {
    const lock = body('private fun holdWifi(');
    expect(lock).toContain('WifiManager.WIFI_MODE_FULL_LOW_LATENCY');
    expect(lock).toContain('WifiManager.WIFI_MODE_FULL_HIGH_PERF');
    expect(lock).toContain('setReferenceCounted(false)');
    expect(lock).toContain('catch (e: Throwable)');
    // Films only; a channel or preview box (live, main slot) lets go of one a film left.
    const load = body('fun load(call: PluginCall)');
    expect(load).toMatch(/if \(screenId == MAIN\) \{\s*if \(live\) releaseWifi\(\) else holdWifi\(\)\s*\}/);
    expect(load).not.toContain('if (screenId == MAIN) holdWifi()');
    expect(plugin.match(/holdWifi\(\)/g)).toHaveLength(2); // the definition and load()
    expect(body('private fun stopSlot(')).toContain('if (slots[MAIN] === s) releaseWifi()');
    expect(body('override fun handleOnDestroy()')).toContain('releaseWifi()');
  });

  it('a film stopped on an error the plugin won\'t retry lets the lock go; a reconnect keeps it', () => {
    const idle = body('private fun releaseWifiIfStopped(');
    expect(idle).toContain('if (slots[MAIN] !== s || s.isLive || s.player?.isLoading == true) return');
    expect(idle).toContain('releaseWifi()');
    const err = plugin.slice(plugin.indexOf('override fun onPlayerError('), plugin.indexOf('override fun onTracksChanged('));
    // Audio decode (the player has stopped; PlexSection loads a conversion).
    expect(err).toMatch(/if \(isAudioTrack \|\| isAudioDecoder\) \{\s*releaseWifiIfStopped\(s\)\s*notifyListeners\(/);
    // After the reconnect branch, before RECONNECT_EXHAUSTED and the error's own name.
    const reconnectAt = err.indexOf('reconnect(s, screenId, reason)');
    const releaseAt = err.lastIndexOf('releaseWifiIfStopped(s)');
    expect(releaseAt).toBeGreaterThan(reconnectAt);
    expect(releaseAt).toBeLessThan(err.indexOf('"RECONNECT_EXHAUSTED"'));
    expect(err.slice(0, reconnectAt).match(/releaseWifiIfStopped/g)).toHaveLength(1);
    // The plugin's own give-up (a channel's 20, or a Backups film's watchdog).
    expect(body('private fun reconnect(')).toMatch(/if \(s\.reconnectAttempts >= MAX_RECONNECTS\) \{\s*releaseWifiIfStopped\(s\)\s*notifyListeners\(/);
  });
});
