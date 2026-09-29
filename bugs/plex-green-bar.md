# Green bar at the bottom of the screen in Plex (1.7.9 builds)

## What's broken
Owner's photo (LG TV, 1.7.9 build 42): during Plex's "Getting ready… Loading ahead so it plays smoothly"
pre-buffer screen, a solid bright-green band fills the bottom ~10% of the screen, full width. The top-right
chip reads "Back to normal · 1.0 Mb/s". Appears "sometimes", new with the recent Plex builds.

## How the owner reproduces it
Start a Plex title (likely 4K / the pre-buffer hold); the band shows during "Getting ready…".
Confirmed: it happened on a 1080p title (4K not tried yet), and the band STAYS after playback starts.

## Leads
- Solid green = an undrawn/zeroed video frame region (YUV zeros) from the native player's TextureView
  showing through a part of the WebView that isn't covered (the Getting ready overlay may not reach the
  bottom edge), or a first frame drawn while paused during the hold with a wrong crop/transform
  (e.g. 1920x804 or 3840x1600 content, decoder buffers padded to a taller height; applyFormat letterbox math).
- Before the Plex rounds, the shutter view stayed black until the first frame; the pre-buffer hold now
  renders the first frame while paused (and 4K waits longer), so the frame is visible much longer.

## Tried
(nothing yet)

## Rung 2 (fixer-2)
Owner update: seen on a 1080p title (files are often 1920x804 / 1920x800), and the band STAYS after playback starts.

**What the photo says.** Measured on the photo: the band is 12.9% of the screen height, full width, touching the
bottom edge. A 1920x804 picture letterboxed on a 1080 screen has bars of 138/1080 = 12.8%. So the band is exactly
the bottom letterbox bar. The rest of the screen is black (the "navy" is how the LG panel's black comes out on
camera: the bg-black/80 chip is no darker than its surroundings). Nothing in the WebView paints green there
(checked PreBufferIndicator, BufferingDiagnostics, the overlays, the Home ticker, the CSS). Build 38 → HEAD changed
none of the native picture code (ensureSurface, applyFormat, the shutter), so the stack itself was the weak spot.

**Root cause (most likely; can't be confirmed without the device).** The picture view was a full-screen TextureView,
and "fit" letterboxed by shrinking the picture inside it with a matrix (applyFormat → setTransform). So the bars were
parts of the picture view that nothing painted. A TextureView is opaque by default, so the black box under it counts as
covered and its black isn't drawn there on this box (the old GL renderer drops draws under a full-screen opaque op).
The bars keep whatever was last drawn in them. Here that was the bottom of a frame drawn before the fit matrix, or a
decoder's zero rows: YUV 0,0,0 is bright green. It stays there for the whole film because nothing ever repaints the
bars. On top of that, the pre-buffer hold draws the first frame while paused and opened the shutter on it, so this
showed under "Getting ready…".

**Fix.**
- New `android/.../player/VideoFit.kt` (pure logic): `viewSize(format, box, video, pixelRatio)` gives the picture
  view's own size (fit/wide inside the box, zoom covering it, fill = the box). `shutterOpen(firstFrameSeen, holding)`
  is the shutter rule.
- `SnowPlayerPlugin.applyFormat` now sizes the TextureView to the picture, centred in the black container. The
  matrix is reset to identity and no transform is used. The letterbox bars are now the container's own black
  background, outside the picture view. The container's layout listener re-fits whenever the box changes size
  (fullscreen, tile, first layout). Before, a stale size stayed until the next video size change.
- The shutter opens only in `openShutterIfReady`: the first frame has been drawn AND the start-up hold is over. It is
  called from onRenderedFirstFrame, releaseHold (the viewer plays or pauses) and the hold's own "done" path. So
  "Getting ready…" stays on black until the film actually starts.
- Buffering untouched (same hold, same rules). Live TV and multi-screen tiles have no hold, so their shutter opens
  on the first frame as before. Their letterboxing looks the same (now done by sizing, not by a matrix).

**Tests.** `src/hooks/useNativePlayer.greenBar.test.ts` (failed before: no VideoFit, applyFormat used setScale/
setTransform, the shutter opened during the hold). `android/app/src/test/.../VideoFitTest.kt`: 10 JUnit tests, OK when
run with kotlinc + junit here. `useNativePlayer.blank.test.tsx` was updated: the single shutter-open is now in
openShutterIfReady, reached from the first frame.

**If it's still there on the device.** Ask the owner: does the band show on the Plex app's own player with the
same file? Does it change with Screen format (Fill / Zoom)? The Stats panel's video line (decoder + size) for that
title. Box model and Android version. If Fill also shows green, the decoder itself writes green rows, and a
TextureView.setOpaque(false) / SurfaceView experiment is the next step.
