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

### Rung 2 (fixer-2): root causes found and fixed (waiting on the owner's box test)
Extra info from the owner during this rung: Live TV VOD plays fine with MPV picked, but VOD is the
WebView's HTML5 player, not MPV. It only shows the box and network are fine.

**Root cause, black screen + "buffering" + skip every ~0.5 s: a self-sustaining reload loop.**
`MpvEngine` restarted the stream on every `MPV_EVENT_END_FILE` for a live channel. But mpv also sends
END_FILE for the file being *replaced* by `loadfile … replace`, which is what every channel change (and the
restart itself) does. So the first zap (or preview box moving to another channel) made END_FILE → restart
500 ms later (`RESTART_DELAY_MS`) → `loadfile replace` → END_FILE → restart… for good. After 20 it raised
RECONNECT_EXHAUSTED, the WebView re-loaded, and the loop began again. A live TS rarely gets a keyframe
decoded in 0.5 s, so: black screen, "buffering", a skip about every half second. The restart also captured
the old URL, so a zap during the 500 ms could reload the previous channel.

**Second black-screen cause: the video output was never put back.** `surfaceDestroyed` set `vo=null`;
`surfaceCreated` only re-attached the surface and never set `vo` back. The SurfaceView's surface goes
every time the player box is hidden (`stopSlot` makes the container GONE: leaving Live TV, the app going
to the background, every Exo↔MPV switch). After the first of those, every stream played as sound over black
for the rest of the process. mpv-android and Findroid both set `vo` again in `surfaceCreated`.
Also, `loadfile` could run before the surface existed. `vo=mediacodec_embed` asserts on a missing `wid`.

**Why stalls read 0.0:** stalls were counted only from `paused-for-cache` *after* `firstFrameMs`, and each
restart reset `firstFrameMs` to null. The reload loop never showed as a stall. `firstFrameMs` also came from
`PLAYBACK_RESTART`, which fires with sound alone, so it wasn't a picture signal.

**Why memory read 0 MB (both engines):** `Debug.getPss()` returns **KB**; `cachedPssMb()` divided by
1024*1024. Any process under 1 TB read as 0. The web side saved that 0 and averaged it in.

**Why first picture was ~4.3 s:** FFmpeg's stream probe reads up to 5 s of a live TS (IPTV TS carries
teletext/data/spare-audio PIDs that never describe themselves). Also found: `stream-lavf-o-append` is a
command-line-only form. Through the client API it is an unknown option, so the reconnect options were
never applied (the failure was silent because setOptionString's return code was ignored).

**What changed (build 47 candidate):**
- `MpvEngine.kt` (rewritten event handling):
  - Restart only when mpv really goes idle with a stream wanted (`idle-active`, re-read live on the main
    thread). A replace never passes through idle; END_FILE no longer restarts.
  - The restart is cancellable and reads the current URL when it runs.
  - Surface lifecycle as mpv-android/Findroid: `attachSurface` → `vo` → `force-window=yes` on create;
    `vo=null` → `force-window=no` → `detachSurface` on destroy, with a guard for a stale holder.
  - A stream is loaded only while a surface exists (`startPending`).
  - Options are set before `MPVLib.init()` (reference order), and a rejected option is logged by NAME only.
  - Picture = `PLAYBACK_RESTART` plus a frame at the video output (`video-out-params/w`), or a radio stream
    with no video track.
  - `hwdec-current` is shown as the decoder (MediaCodec vs software).
  - The engine's own kbps min/avg/max are now filled in. The bogus `request_log_messages` command and the
    no-op log observer were removed.
- `MpvPlaybackClock.kt` (new, pure): time to first picture per load, restarts, and stalls. A stall is a
  cache pause after the picture, or a restart after the picture until the picture is back. A stall still
  running is counted in stallSec. `endedByItself` / `isPicture` rules. Tested in `MpvPlaybackClockTest.kt`.
- `MpvOptions.kt`: `stream-lavf-o` (plain key) instead of `-append`; `demuxer-lavf-analyzeduration=1`;
  `VIDEO_OUTPUT` constant. Kept `vo=mediacodec_embed` + `hwdec=mediacodec`: MediaCodec decodes straight
  onto the surface, the same MediaCodec→Surface path ExoPlayer proves on this box, with no GL on top.
- `SecondEngine.kt`: `videoView()`. `SnowPlayerPlugin.kt`:
  - `applyFormat` sizes mpv's SurfaceView like the TextureView. mediacodec_embed stretches to the surface,
    so fit/zoom/wide now work and 4:3 isn't stretched.
  - The MPV load path applies the pending rect (shared `applyPendingRect`, same code as Exo's) and hides the
    unused TextureView.
  - An engine switch keeps the preview-box rect.
  - PSS is now KB / 1024.
  - ExoPlayer's own path is unchanged.
- `engineCompare.ts`: a pssMb ≤ 0 is "unknown", never averaged. Storage key bumped to v2, so build 46's
  untrustworthy samples (loop, 0 MB) are left behind.

**Known, not fixable from Kotlin (needs a decision before MPV ever ships to customers):** the libmpv
0.5.1 JNI (`libplayer.so`) calls `mpv_request_log_messages(g_mpv, "v")` in `create()`. Its event thread
prints *every* mpv log message to logcat as `V/mpv: [prefix:level] text` before any Java code sees it
(checked by disassembly; 1.0.0 is the same). mpv's "v" level includes the stream URL, which carries the line
credentials: "Opening …" and FFmpeg's http "Opening '…' for reading". `msg-level` can't lower a client's log
buffer, and there is no command for it. Options: (a) our own tiny JNI shim that calls
`mpv_request_log_messages(ctx, "no")` after create (needs NDK in the build), or (b) hand mpv a loopback URL
(`http://127.0.0.1:<port>/<random id>`) served by an in-app proxy, so mpv never sees the credentials.
It's owner-test-build only today, so it's logcat on the owner's box, but it breaks the "never log a URL" rule.

**Owner test (MPV picked, Live TV):**
1. Play a channel, zap up/down 5 times, go back to the list and in again, switch Exo→MPV→Exo→MPV in
   Playback settings and play again. Working = a picture every time within about 1–2 s, no black screen,
   no "buffering" flicker or half-second skips, and 4:3 channels not stretched.
2. Stats panel with MPV: decoder says "MediaCodec (mpv)", Restarts stays 0 on a good channel, Process memory
   is a real number (a few hundred MB). Same memory figure shows for ExoPlayer.
3. Compare table (starts empty, new storage): after a few 1+ minute watches on each engine, MPV first picture
   should be close to Exo's. Memory should be non-zero for both, and stalls should count if a channel buffers.
If it's still black: the stats panel's decoder line, and whether sound plays, are the two things to report.
