/**
 * A film's sound: the box's hardware decoder or passthrough first, FFmpeg as
 * the fallback (`audio_hw_first`, a missing row is on; the viewer's "Decode
 * audio on this box" turns it off). Live TV keeps FFmpeg first. A heavy track
 * FFmpeg would decode gives way to a same-language one the box plays itself;
 * a failed hardware sound is tried once more on FFmpeg before Plex is told;
 * a bitstream to the TV or receiver lets go of the boost and tells the volume
 * controls. The Kotlin half can't run here; its shape is pinned.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import order from '../../android/app/src/main/java/com/snowmedia/player/AudioOrder.kt?raw';
import { nativeLoadExtras, PLAYER_FLAG_DEFAULTS, loadDecodeAudioOnBox, saveDecodeAudioOnBox } from '@/lib/playerFlags';
import { writeCachedFlag } from '@/lib/featureFlagCache';
import { audioPassthrough, setAudioPassthrough } from '@/lib/audioOutput';

const fn = (sig: string) => {
  const at = plugin.indexOf(sig);
  expect(at, sig).toBeGreaterThan(-1);
  return plugin.slice(at, plugin.indexOf('\n    }\n', at));
};

beforeEach(() => { localStorage.clear(); setAudioPassthrough(false); });

describe('what the WebView asks for', () => {
  it('hardware first unless switched off remotely or the viewer decodes on the box', () => {
    expect(PLAYER_FLAG_DEFAULTS.audio_hw_first).toBe(true);
    expect(loadDecodeAudioOnBox()).toBe(false);
    expect(nativeLoadExtras(false)).toMatchObject({ audioHwFirst: true });
    saveDecodeAudioOnBox(true);
    expect(nativeLoadExtras(false)).toMatchObject({ audioHwFirst: false });
    saveDecodeAudioOnBox(false);
    writeCachedFlag('audio_hw_first', false);
    expect(nativeLoadExtras(false)).toMatchObject({ audioHwFirst: false });
  });

  it('the passthrough store the volume controls read', () => {
    expect(audioPassthrough()).toBe(false);
    setAudioPassthrough(true);
    expect(audioPassthrough()).toBe(true);
  });
});

describe('SnowPlayerPlugin.kt — audio order (pinned)', () => {
  it('the order is built into the player and a change rebuilds it (never a disabled renderer, which would leave a track unmapped)', () => {
    expect(fn('private fun buildPlayer(')).toContain('if (s.audioMode == AudioOrder.HARDWARE_FIRST) DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON');
    expect(plugin).toContain('val wantAudio = AudioOrder.mode(isMain = screenId == MAIN, live = live, hwFirst = audioHwFirst, fellBack = s.audioSwFallback)');
    expect(plugin).toContain('s.audioMode != wantAudio');
    expect(plugin).not.toMatch(/setRendererDisabled/);
    expect(order).toContain('if (isMain && !live && hwFirst && !fellBack) HARDWARE_FIRST else FFMPEG_FIRST');
  });

  it('a failed hardware sound: FFmpeg first at the same place, once, before AUDIO_DECODE', () => {
    const err = fn('override fun onPlayerError(');
    const fallback = err.indexOf('restartWithSoftwareAudio(s, screenId, codeName)');
    expect(fallback).toBeGreaterThan(-1);
    expect(fallback).toBeLessThan(err.indexOf('.put("code", "AUDIO_DECODE")'));
    const restart = fn('private fun restartWithSoftwareAudio(');
    expect(restart).toContain('s.wantAudioMode = AudioOrder.FFMPEG_FIRST');
    expect(restart).toContain('p.setMediaItem(buildMediaItem(url, s.currentSubtitles), pos.coerceAtLeast(0L))');
  });

  it('a heavy FFmpeg track gives way to a same-language hardware one, once per load, never over a pick', () => {
    expect(plugin).toContain('if (screenId == MAIN && !s.isLive && !s.audioChoiceDone && !tracks.isEmpty) chooseLighterAudio(s, p, tracks)');
    const choose = fn('private fun chooseLighterAudio(');
    expect(choose).toContain('p.getRenderer(r) is MediaCodecAudioRenderer');
    expect(choose).toContain('TrackSelectionOverride(tg, pick.track)');
    expect(fn('private fun selectTrack(')).toContain('if (type == C.TRACK_TYPE_AUDIO) s.userPickedAudio = true');
  });

  it('a bitstream output: the boost lets go, the WebView is told, and the stats say so', () => {
    expect(plugin).toContain('setPassthrough(s, screenId, !Util.isEncodingLinearPcm(audioTrackConfig.encoding))');
    expect(fn('private fun applyBoost(')).toContain('s.volume > 1f && !s.audioPassthrough');
    expect(fn('private fun setPassthrough(')).toContain('notifyListeners("audioOutput"');
    const stats = fn('private fun statsOf(');
    for (const k of ['audioOrder', 'audioPassthrough', 'audioUnderruns', 'audioUnderrunMs']) expect(stats).toContain(`o.put("${k}"`);
  });
});
