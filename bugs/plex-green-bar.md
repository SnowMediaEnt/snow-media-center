# Green bar at the bottom of the screen in Plex (1.7.9 builds)

## What's broken
Owner's photo (LG TV, 1.7.9 build 42): during Plex's "Getting ready… Loading ahead so it plays smoothly"
pre-buffer screen, a solid bright-green band fills the bottom ~10% of the screen, full width. The top-right
chip reads "Back to normal · 1.0 Mb/s". Appears "sometimes", new with the recent Plex builds.

## How the owner reproduces it
Start a Plex title (likely 4K / the pre-buffer hold); the band shows during "Getting ready…".
(To confirm: 4K only? does it vanish once playback starts?)

## Leads
- Solid green = an undrawn/zeroed video frame region (YUV zeros) from the native player's TextureView
  showing through a part of the WebView that isn't covered (the Getting ready overlay may not reach the
  bottom edge), or a first frame drawn while paused during the hold with a wrong crop/transform
  (e.g. 1920x804 or 3840x1600 content, decoder buffers padded to a taller height; applyFormat letterbox math).
- Before the Plex rounds, the shutter view stayed black until the first frame; the pre-buffer hold now
  renders the first frame while paused (and 4K waits longer), so the frame is visible much longer.

## Tried
(nothing yet)
