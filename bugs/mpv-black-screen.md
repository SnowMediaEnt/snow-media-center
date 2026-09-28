# MPV: black screen, "buffering", skips every half second

Tracker #19 · hard bug (playback, device-specific) · starts at fixer-2

## What the owner saw (build 46, MPV test build, Live TV)
- With MPV picked, a Live TV channel plays as a **black screen** (no picture).
- It says "buffer…" and **skips / stutters about every half second**.
- ExoPlayer on the same box and channels: fine, picture up in ~0.5 s.
- Compare table (photo): ExoPlayer first picture 538 ms, CPU 91.1%, memory 0 MB;
  MPV first picture 4259 ms, CPU 64.5%, memory 0 MB. Stalls 0.0 for both.

## Also wrong
- **Memory shows 0 MB for both engines**: the pssMb reading isn't being collected or saved.
- **Stalls 0.0 on MPV** although the owner saw constant buffering, so MPV stalls aren't being counted.
- MPV's lower CPU may simply be because it isn't drawing any picture. The table can't be trusted until MPV shows video.

## Where to look
- `android/app/src/mpv/java/com/snowmedia/player/mpv/MpvEngine.kt`: surface attach (`wid` / attachSurface),
  vo / gpu-context / hwdec options, cache and demuxer settings for live TS/HLS, and the first-frame and stall signals.
- `android/app/src/main/java/com/snowmedia/player/MpvOptions.kt`, `SecondEngine.kt`, and the engine hand-off in `SnowPlayerPlugin.kt`.
  Check whether MPV gets the same Surface the TextureView/VideoFit path uses, and whether ExoPlayer is still attached or holding it.
- The stats code path (engineCompare.ts, getStats in SnowPlayerPlugin.kt): the pss and stall numbers.

## Attempts
(none yet)
