/**
 * The stats panel's source: SnowPlayer.getStats. On the web (and in these
 * tests) the fallback answers "nothing playing" with every field present.
 * The Kotlin half can't run here, so its shape is pinned the way the other
 * player tests pin it: the same field names as PlayerStats, nulls sent as
 * JSON nulls, read on the player's thread, and never a URL.
 */
import { describe, expect, it } from 'vitest';
import { SnowPlayer, emptyPlayerStats, type PlayerStats } from './SnowPlayer';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';

const KEYS: Array<keyof PlayerStats> = [
  'state', 'playing', 'positionSec', 'durationSec', 'bufferedAheadSec',
  'nowKbps', 'avgKbps', 'minKbps', 'maxKbps',
  'videoDecoder', 'videoFormat', 'renderedFrames', 'droppedFrames',
  'audioDecoder', 'audioFormat',
  'restarts', 'lastRestartReason', 'lastError', 'loadProfile',
  'javaHeapMb', 'nativeHeapMb',
];

const body = (from: string) => plugin.slice(plugin.indexOf(from), plugin.indexOf('\n    }\n', plugin.indexOf(from)));

describe('SnowPlayer.getStats — web / no native player', () => {
  it('answers idle, zeros and nulls, with every field of PlayerStats', async () => {
    const st = await SnowPlayer.getStats();
    expect(Object.keys(st).sort()).toEqual([...KEYS].sort());
    expect(st).toEqual({
      state: 'idle', playing: false, positionSec: 0, durationSec: 0, bufferedAheadSec: 0,
      nowKbps: null, avgKbps: null, minKbps: null, maxKbps: null,
      videoDecoder: null, videoFormat: null, renderedFrames: null, droppedFrames: null,
      audioDecoder: null, audioFormat: null,
      restarts: 0, lastRestartReason: null, lastError: null, loadProfile: null,
      javaHeapMb: null, nativeHeapMb: null,
    });
  });

  it('takes a screenId like every other call, and hands out a fresh object each time', async () => {
    const a = await SnowPlayer.getStats({ screenId: 'tile-1' });
    const b = await SnowPlayer.getStats();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    a.restarts = 9;
    expect(emptyPlayerStats().restarts).toBe(0);
  });
});

describe('SnowPlayerPlugin.kt — getStats', () => {
  const stats = body('private fun statsOf(');

  it('sends exactly the PlayerStats fields', () => {
    const sent = [...stats.matchAll(/o\.put\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect([...new Set(sent)].sort()).toEqual([...KEYS].sort());
  });

  it('nulls go over as JSON nulls (a plain null would drop the key)', () => {
    expect(plugin).toContain('import org.json.JSONObject');
    expect(stats).toContain('JSONObject.NULL');
    expect(stats).not.toMatch(/, null\)/);
  });

  it('is a plugin method that reads the player on its own thread, and never makes a slot', () => {
    const m = body('fun getStats(call: PluginCall)');
    expect(plugin).toMatch(/@PluginMethod\s*fun getStats\(call: PluginCall\)/);
    expect(m).toContain('act.runOnUiThread { call.resolve(statsOf(slots[screenId])) }');
    expect(m).toContain('call.resolve(statsOf(null))');
    expect(m).not.toContain('slotFor(');
  });

  it('never sends a URL', () => {
    expect(stats).not.toMatch(/currentUrl|statsUrl|\.uri|getUri|Uri\./);
  });

  it('speeds come from the bandwidth tick, counting only windows with data, reset on each load', () => {
    const tick = body('private fun scheduleBandwidthTick(');
    expect(tick).toMatch(/if \(kbps > 0L\) \{\s*if \(s\.kbpsMin < 0L \|\| kbps < s\.kbpsMin\) s\.kbpsMin = kbps\s*if \(kbps > s\.kbpsMax\) s\.kbpsMax = kbps\s*s\.kbpsSum \+= kbps\s*s\.kbpsSamples\+\+/);
    const reset = body('private fun resetStats(');
    for (const f of ['s.kbpsMin = -1L', 's.kbpsMax = -1L', 's.kbpsSum = 0L', 's.kbpsSamples = 0', 's.videoCounters = null']) expect(reset).toContain(f);
    expect(body('fun load(call: PluginCall)')).toContain('resetStats(s, url)');
    // Restarts belong to the title: another URL or a stop clears them.
    expect(reset).toMatch(/if \(url != s\.statsUrl\) \{\s*s\.statsUrl = url\s*s\.restarts = 0/);
    expect(body('private fun stopSlot(')).toContain('clearStats(s)');
  });

  it('a stop clears every figure of the stream it ends, decoders and formats included', () => {
    const clear = body('private fun clearStats(');
    for (const f of [
      's.lastKbps = -1L', 's.kbpsMin = -1L', 's.kbpsMax = -1L', 's.kbpsSum = 0L', 's.kbpsSamples = 0',
      's.framesRendered = 0L', 's.framesDropped = 0L', 's.videoCounters = null', 's.framesSeen = false',
      's.statsUrl = null', 's.restarts = 0', 's.lastRestartReason = null', 's.lastError = null',
      's.videoDecoderName = null', 's.audioDecoderName = null',
      's.videoFormatOf = null', 's.videoFormatText = null', 's.audioFormatOf = null', 's.audioFormatText = null',
    ]) expect(clear).toContain(f);
    // Every per-stream field of the slot is in there (loadProfile is the player's, not the stream's).
    const slot = plugin.slice(plugin.indexOf('var kbpsMin: Long'), plugin.indexOf('var audioFormatText: String?'));
    const fields = [...slot.matchAll(/var ([A-Za-z]+):/g)].map((m) => m[1]).filter((f) => f !== 'loadProfile');
    for (const f of [...fields, 'audioFormatText', 'lastKbps']) expect(clear).toContain(`s.${f} = `);
    // Only a stop does this; a new load keeps a decoder the player carries over.
    expect(plugin.match(/clearStats\(s\)/g)).toHaveLength(1);
  });

  it('a stream that has been replaced or stopped never reports into the next one', () => {
    const al = plugin.slice(plugin.indexOf('p.addAnalyticsListener(object : AnalyticsListener {'), plugin.indexOf('s.player = p'));
    expect(al).toContain('{ if (isCurrentItem(eventTime)) s.videoDecoderName = decoderName }');
    expect(al).toContain('{ if (isCurrentItem(eventTime)) s.audioDecoderName = decoderName }');
    expect(al).toContain('if (isCurrentItem(eventTime)) s.videoDecoderName = null');
    expect(al).toContain('if (isCurrentItem(eventTime)) s.audioDecoderName = null');
    expect(al).toMatch(/override fun onVideoEnabled\([^)]*\) \{\s*if \(!isCurrentItem\(eventTime\)\) return\s*s\.videoCounters = decoderCounters/);
    // The item a callback was raised for against the player's current one,
    // by playlist-entry uid; nothing loaded (after a stop) is never current.
    const cur = body('private fun isCurrentItem(');
    expect(cur).toContain('val its = t.timeline');
    expect(cur).toContain('val now = t.currentTimeline');
    expect(cur).toContain('if (its.isEmpty || now.isEmpty) return false');
    expect(cur).toMatch(/val uid = its\.getWindow\(t\.windowIndex, itemWindow\)\.uid\s*return uid == now\.getWindow\(t\.currentWindowIndex, itemWindow\)\.uid/);
    expect(plugin).toContain('private val itemWindow = Timeline.Window()');
  });

  it('restarts are counted with their reason', () => {
    const rc = body('private fun reconnect(');
    expect(rc).toMatch(/s\.reconnectAttempts\+\+\s*s\.restarts\+\+\s*s\.lastRestartReason = reason/);
    expect(plugin).toContain('reconnect(s, screenId, "no picture in 8 s")');
    expect(plugin).toContain('reconnect(s, screenId, "live stream ended")');
    expect(plugin).toMatch(/ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT,\s*PlaybackException\.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED,\s*-> "server stopped responding"\s*else -> "stream error " \+ error\.errorCodeName\.removePrefix\("ERROR_CODE_"\)/);
    // The error behind a restart or a stop, before anything is sent.
    expect(plugin).toMatch(/override fun onPlayerError\(error: PlaybackException\) \{\s*val code = error\.errorCode\s*(\/\/[^\n]*\s*)*s\.lastError = error\.errorCodeName\s*val isAudioTrack/);
  });

  it('decoders and frames come from an AnalyticsListener; FFmpeg and passthrough are named', () => {
    const al = plugin.slice(plugin.indexOf('p.addAnalyticsListener(object : AnalyticsListener {'), plugin.indexOf('s.player = p'));
    expect(al).toContain('override fun onVideoDecoderInitialized(');
    expect(al).toContain('override fun onAudioDecoderInitialized(');
    expect(al).toContain('override fun onVideoDecoderReleased(');
    expect(al).toContain('override fun onAudioDecoderReleased(');
    // Only the session this load started is added to its totals.
    expect(al).toMatch(/override fun onVideoDisabled\([^)]*\) \{\s*if \(s\.videoCounters !== decoderCounters\) return\s*decoderCounters\.ensureUpdated\(\)/);
    const label = body('private fun decoderLabel(');
    expect(label).toContain('"FFmpeg (software)"');
    expect(label).toContain('"Passthrough"');
    expect(body('private fun isBitstreamAudio(')).toMatch(/AUDIO_E_AC3[\s\S]*AUDIO_TRUEHD[\s\S]*AUDIO_DTS/);
    expect(stats).toContain('c?.ensureUpdated()');
  });

  it('every player has a load profile to report', () => {
    expect(plugin).toContain('s.loadProfile = "steady · 50 s / 128 MB, 20 s floor"');
    expect(plugin).toContain('s.loadProfile = "steady · 120 s / 144 MB"');
    expect(plugin).toContain('s.loadProfile = if (lowRam) "tile · 15 s / 6 MB" else "tile · 15 s / 10 MB"');
  });
});
