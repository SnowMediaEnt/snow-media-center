/**
 * The main player draws on a SurfaceView: its own display layer, the
 * decoder's frame timing and HDR passed through, where the TextureView went
 * through the app's GPU composition every frame (uneven 4K pacing, SDR only).
 * Remote switch `video_surface_view` (a missing row is on) falls back to the
 * TextureView; tiles always keep it. `async_codec` (on) turns on MediaCodec's
 * asynchronous queueing on API 28+; `tunneled_vod` (OFF unless a row says
 * on) is for an A/B test. The Kotlin half can't run here; its shape is pinned.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import fit from '../../android/app/src/main/java/com/snowmedia/player/VideoFit.kt?raw';
import { nativeLoadExtras, PLAYER_FLAG_DEFAULTS } from '@/lib/playerFlags';
import { clearCachedFlag, writeCachedFlag } from '@/lib/featureFlagCache';

const fn = (sig: string) => {
  const at = plugin.indexOf(sig);
  expect(at, sig).toBeGreaterThan(-1);
  return plugin.slice(at, plugin.indexOf('\n    }\n', at));
};

beforeEach(() => { localStorage.clear(); });

describe('what the WebView asks for with each load', () => {
  it('SurfaceView and async queueing on unless switched off; tunneling only for a film, only when switched on', () => {
    expect(PLAYER_FLAG_DEFAULTS).toMatchObject({ video_surface_view: true, async_codec: true, tunneled_vod: false });
    expect(nativeLoadExtras(true)).toEqual({ surfaceView: true, asyncCodec: true, audioHwFirst: true });
    expect(nativeLoadExtras(false)).not.toHaveProperty('tunneled');
    writeCachedFlag('tunneled_vod', true);
    expect(nativeLoadExtras(false)).toMatchObject({ tunneled: true });
    expect(nativeLoadExtras(true)).not.toHaveProperty('tunneled');
    writeCachedFlag('video_surface_view', false);
    writeCachedFlag('async_codec', false);
    expect(nativeLoadExtras(true)).toMatchObject({ surfaceView: false, asyncCodec: false });
    clearCachedFlag('video_surface_view');
    expect(nativeLoadExtras(true)).toMatchObject({ surfaceView: true });
  });
});

describe('SnowPlayerPlugin.kt — the main player on a SurfaceView (pinned)', () => {
  it('the main player gets a SurfaceView when asked; tiles a TextureView', () => {
    expect(fit).toContain('fun useSurfaceView(isMain: Boolean, requested: Boolean): Boolean = isMain && requested');
    expect(plugin).toContain('val wantSv = VideoFit.useSurfaceView(screenId == MAIN, surfaceView)');
    const ensure = fn('private fun ensureSurface(');
    expect(ensure).toContain('if (s.wantSurfaceView) SurfaceView(act) else TextureView(act)');
    // Shutter and subtitles above the picture, the box under the WebView.
    expect(ensure.indexOf('fl.addView(tv,')).toBeLessThan(ensure.indexOf('fl.addView(shutter,'));
    expect(ensure).toContain('parent.addView(fl, 0,');
    // Default z-order: never on top of the window or as a media overlay.
    expect(plugin).not.toMatch(/\.setZOrderOnTop\(|\.setZOrderMediaOverlay\(/);
    expect(plugin).not.toMatch(/LAYER_TYPE_HARDWARE/);
  });

  it('Media3 handles the surface (setVideoSurfaceView), no raw Surface is handed over', () => {
    const build = fn('private fun buildPlayer(');
    expect(build).toContain('is SurfaceView -> p.setVideoSurfaceView(v)');
    expect(build).toContain('is TextureView -> p.setVideoTextureView(v)');
    expect(plugin).not.toMatch(/setVideoSurface\(/);
  });

  it('the main SurfaceView stays VISIBLE and attached through a stop; the shutter covers it', () => {
    const stop = fn('private fun stopSlot(');
    expect(stop).toContain('s.shutterView?.visibility = View.VISIBLE');
    expect(stop).toContain('if (!s.usesSurfaceView) s.container?.visibility = View.GONE');
    // The z-order guard (remove / re-add) never touches the main box.
    expect(fn('fun setRect(call: PluginCall)')).toContain('if (screenId != MAIN && parent != null && wv != null)');
  });

  it('zoom keeps the SurfaceView the box\'s size and lets the decoder crop', () => {
    const f = fn('private fun applyFormat(');
    expect(f).toContain('VideoFit.surfaceViewSize(');
    expect(f).toContain('C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING');
    expect(fit).toContain('fun cropsInDecoder(format: String): Boolean = format == "zoom"');
  });

  it('a switch flipped rebuilds what no longer fits: the views, or the player alone', () => {
    const load = fn('fun load(call: PluginCall)');
    expect(load).toContain('if (s.container != null && s.usesSurfaceView != wantSv)');
    expect(load).toContain('if (s.player != null && (s.wantAsyncCodec != wantAsync || s.audioMode != wantAudio)) {');
  });

  it('async queueing on API 28+ when asked; tunneling for a film on the SurfaceView without the boost', () => {
    expect(fn('private fun buildPlayer(')).toContain('s.asyncCodec = s.wantAsyncCodec && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P');
    expect(plugin).toContain('if (s.asyncCodec) renderersFactory.forceEnableMediaCodecAsynchronousQueueing()');
    expect(plugin).toContain('s.tunneled = !live && tunneled && s.usesSurfaceView && s.volume <= 1f');
  });

  it('a film is paused when the app leaves the screen (no 4K decoding into nothing)', () => {
    const onStop = plugin.slice(plugin.indexOf('override fun handleOnStop()'), plugin.indexOf('override fun handleOnDestroy()'));
    expect(onStop).toContain('s.player?.playWhenReady = false');
    expect(onStop).toContain('releaseHold(s)');
  });

  it('no HDR is turned into SDR: no tone mapping anywhere', () => {
    expect(plugin).not.toMatch(/ToneMap|toneMap|setColorTransfer|COLOR_TRANSFER_SDR\s*\)/);
  });

  it('stats: the surface, pacing figures and a software decoder, numbers only', () => {
    const stats = fn('private fun statsOf(');
    for (const k of ['surface', 'tunneled', 'skippedFrames', 'maxConsecutiveDropped', 'droppedToKeyframe', 'avgFrameOffsetMs', 'videoDecoderSoftware']) {
      expect(stats).toContain(`o.put("${k}"`);
    }
    expect(fn('private fun isSoftwareDecoder(')).toMatch(/c2\.android\..*OMX\.google\./s);
    const describe = fn('private fun describeVideo(');
    expect(describe).toContain('f.codecs');
    expect(describe).toContain('C.COLOR_TRANSFER_ST2084 -> sb.append(" · PQ")');
  });
});
