/**
 * bugs/plex-green-bar.md: a solid green band over the bottom letterbox bar of
 * a 1920x804 film (12.9% of the screen in the owner's photo = 138 of 1080
 * rows), during "Getting ready…" and on through playback.
 *
 * The picture view was a full-screen TextureView (opaque by default) and
 * "fit" shrank the picture inside it with a matrix. The bars were then parts
 * of that opaque view that nothing painted: the black box under it counts as
 * covered, so they kept whatever was last drawn there (a frame drawn before
 * the fit, or a decoder's zero rows: YUV 0 is bright green). The start-up hold
 * also opened the shutter on the first frame while still paused.
 *
 * Now the picture view is sized to the picture (VideoFit), centred in the
 * black box, and the shutter stays shut until the hold has ended. The pure
 * math is in VideoFitTest.kt; this pins the plugin's wiring.
 */
import { describe, expect, it } from 'vitest';
import plugin from '../../android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt?raw';
import fit from '../../android/app/src/main/java/com/snowmedia/player/VideoFit.kt?raw';

const body = (from: string) => {
  const at = plugin.indexOf(from);
  expect(at, from).toBeGreaterThan(-1);
  return plugin.slice(at, plugin.indexOf('\n    }\n', at));
};

describe('SnowPlayerPlugin.kt — letterbox bars are the box, not unpainted picture view', () => {
  it('applyFormat sizes the picture view to the picture and never shrinks it with a matrix', () => {
    const f = body('private fun applyFormat(');
    expect(f).toContain('VideoFit.viewSize(s.format, box.width, box.height, s.videoW, s.videoH, s.pixelRatio)');
    expect(f).not.toMatch(/setScale|setTransform\(m\)/);
    // Any matrix left from before goes: the view itself has the shape.
    expect(f).toContain('tv.setTransform(null)');
    expect(f).toMatch(/lp\.gravity = Gravity\.CENTER/);
    expect(plugin).not.toContain('import android.graphics.Matrix');
  });

  it('measures against the black box, and fits again whenever the box changes size', () => {
    expect(body('private fun applyFormat(')).toContain('val box = s.container ?: return');
    const surface = body('private fun ensureSurface(');
    expect(surface).toMatch(/fl\.addOnLayoutChangeListener \{[^}]*if \(r - l != or - ol \|\| b - t != ob - ot\) v\.post \{ applyFormat\(s\) \}/);
  });

  it('the shutter opens only through openShutterIfReady, never while the hold is filling', () => {
    expect(plugin.split('shutterView?.visibility = View.INVISIBLE').length - 1).toBe(1);
    const open = body('private fun openShutterIfReady(');
    expect(open).toContain('VideoFit.shutterOpen(s.firstFrameSeen, s.holding)');
    expect(open).toContain('shutterView?.visibility = View.INVISIBLE');
    const first = body('override fun onRenderedFirstFrame()');
    expect(first.indexOf('s.firstFrameSeen = true')).toBeLessThan(first.indexOf('openShutterIfReady(s)'));
    // The hold ending (play, pause, or the buffer is ready) shows the frame.
    expect(body('private fun releaseHold(')).toMatch(/s\.holding = false\s*openShutterIfReady\(s\)/);
    const pre = body('private fun schedulePreBuffer(');
    expect(pre).toMatch(/s\.holding = false\s*p\.playWhenReady = true\s*openShutterIfReady\(s\)/);
  });

  it('VideoFit: the rule the plugin uses', () => {
    expect(fit).toMatch(/fun shutterOpen\(firstFrameSeen: Boolean, holding: Boolean\): Boolean = firstFrameSeen && !holding/);
    expect(fit).toMatch(/fun viewSize\(format: String, boxW: Int, boxH: Int, videoW: Int, videoH: Int, pixelRatio: Float\): IntArray\?/);
  });
});
