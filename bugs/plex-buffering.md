# Plex buffering at 1080p / 4K

## What's broken
Plex titles in SMC start, then stall about 10-15 s in and every ~15 s after ("unwatchable"), at 1080p and 4K.
The official Plex app on the same TV, same network, same server ("Snow Media P2"), same file plays the
original with no buffering. Live TV movies/series in SMC play fine (they use the WebView's own player).
With a VPN on, SMC doesn't load Plex at all; the Plex app still plays.

## How the owner reproduces it
1. SMC → Plex → any 1080p or 4K movie (e.g. "Scary Movie" 2026, HEVC 21.6 Mb/s + EAC3 7.1, mkv) → Play.
2. Watch the first minute: the buffering card appears within ~15 s and keeps coming back.

## Device evidence
- SMC card: Now 0.5 Mb/s · Needs 23.7 Mb/s · Internet 317.8 Mb/s · Route: Direct to server · https ·
  "Still preparing… slow to respond" at start. (With VPN: Now 1.3, Internet 12.6.)
- Plex app stats, same file: Direct Playing as mkv from Snow Media P2 · buffer 17.9 s ahead ·
  bandwidth avg 84 Mb/s (min 15.8, max 305.8) · HEVC via OMX.amlogic.hevc decoder · EAC3 8ch passthrough · 0 dropped frames.
- Server custom access URL is http://193.34.77.53:32440 (SMC's route is https, so it's on plex.direct, not that).
- Conclusion: the server and the line are fine; the difference is how SMC's native player downloads.

## Tried, and why it failed (device results)
- Earlier builds: buffering diagnostics card, automatic quality drops, 25 s / 10 s pre-buffer hold, bigger
  buffers by RAM class, Media3 Wi-Fi lock. Result: still stalls every ~15 s; quality drops but still stalls.
  The card's "server can't send fast enough" verdict was wrong (the Plex app gets 84 Mb/s from it).

## Build 39 (rung 2) — device result: better, not fixed
Still stalls right at the start (around 0:02 and 0:16), recovers to 30+ s buffered, then plays smoothly
for the rest. The mid-film stalls every ~15 s are gone. Early start-up is what's left.
Second test (build 39): played about a minute, then stopped with the card saying "Waiting for the Plex server
to answer" (no data arriving at all), and did not recover on its own.
CONFIRMED on the device (several movies): starting fresh from 0:00 plays excellently; RESUME from a saved
spot buffers every time. The remaining bug is the resume / mid-file start path.
New in build 39 that could matter: 30 s read timeout (a dead connection is noticed after 30 s, not 8 s);
direct-play URLs now carry X-Plex-Client-Identifier/Product/Platform (the server sees an identified client
but SMC sends no /:/timeline for the shared account); continuous top-up load control.

### What build 39 changed
- Native player (SnowPlayerPlugin.kt): no 8 s first-frame restarts for Plex; 30 s read / 15 s connect timeouts
  for Plex URLs; continuous top-up instead of fill-then-idle bursts; a failed film reconnects at the current
  position (not from scratch); start position given to load(); Wi-Fi lock held for the whole film; a dead
  server shows an error in minutes, not half an hour.
- Connection (plex.ts, usePlexAuth.ts): the server's own plex.direct address beats custom/http addresses;
  6 s probes; saved address re-tested on each Plex open; relay only as a last resort; stream URLs now
  identify SMC to the server (X-Plex-Client-Identifier, Product, Platform…).
- Auto quality kept conservative (no earlier drops); card only blames the server/internet with evidence.
- New "Playback stats" panel to compare with the Plex app's stats screen.

## If it still buffers: ask the owner for
- A photo of SMC's Playback stats panel during a stall (buffer ahead, bandwidth now/avg/min/max,
  restarts + last reason, audio decoder) next to the Plex app's stats for the same title.
- The card's Route line (it now names plex.direct vs custom address).
- Remaining suspects not yet changed: audio decoded in software by FFmpeg (Plex app passes EAC3 through),
  TextureView rendering, Android's HttpURLConnection vs the Plex app's HTTP stack.

## Rung 3 (fixer-3) — what changed and why
Device facts used: fresh starts from 0:00 play perfectly on build 39; a RESUME buffers every time. Photo during
a resume stall: "Lowered to 1080p · 12 Mbps for your speed" toast, then the conversion sat at 0 bytes behind
"Getting ready…" ("Waiting for the Plex server to answer"), internet check 184 Mb/s. Conversions (the automatic
drop and quality changes) never start on build 39.

What the code showed (verified, not assumed):
1. **The resume start is held too briefly.** The start-up hold ended 10 s after load(), counted from load().
   A mid-file start spends much of that before any video at the resume point exists: header read, jump to the
   MKV index (Cues) at the end of the file, back to the first cluster, then a third open at the resume point
   (Media3 1.5 MatroskaExtractor/ProgressiveMediaPeriod, read in source), where a remote (cloud-backed) server
   starts cold. So a resumed film started with ~2-3 s in hand and stalled at 0:02 and 0:16 (the owner's report);
   a start from 0:00 has the file's beginning hot and fills 25 s in a second or two.
2. **Automatic quality treated those start-up stalls as a slow connection.** Its "first load and seeks don't
   count" rule measured 5 s from markSeek(), which useNativePlayer calls *before* load(); the hold alone lasts up
   to 10 s, so every resume stall counted. Three stalls (or the "slow file" proof taken from the server's slow
   first seconds) → drop to a conversion. That is the "full stop after a minute": the original was fine, the
   conversion it was moved to never started.
3. **Conversions never start on build 39.** Of what the player itself sends for a conversion, build 39 changed
   only the User-Agent (SMC's own agent was put on /transcode/universal/ playlist + segment requests too; up to
   build 38 they went out with Android's default agent and started). Session ids are unique per URL and the
   stop request targets the left session only (existing tests pin that); start.m3u8 is unchanged from build 38.

Changes (fresh-start path untouched: same URLs, same hold, same load control):
- `PreBufferRule.kt` (new, pure Kotlin) + `SnowPlayerPlugin.schedulePreBuffer(midFile)`: a start part-way into a
  file (load with startPosition, or a reconnect via resumeVod) counts its 10 s from the first video at the resume
  point (buffer > 0 or READY), with a 30 s cap in all. Target 25 s and "stopped loading with ≥10 s" unchanged.
  A start from 0:00 keeps exactly the build-39 rule.
- `SnowPlayerPlugin.kt`: a third HTTP source for /transcode/universal/ — same 15 s/30 s timeouts, **no custom
  User-Agent** (build-38 behaviour). The file played as it is keeps SMC's agent and identification.
- Automatic quality (`plexAutoQuality.ts`, `playerSeek.ts`, `useNativePlayer.ts`, `PlexSection.tsx`):
  - `useNativePlayer` marks when a film *begins to play* after a load (start, resume, quality change, reload) or a
    seek (`markPlaybackStart`); stalls — and the early "slow file" proof — within 30 s of that never count
    (`START_GRACE_MS`, `inJumpGrace`). Live TV never marks.
  - With the internet check ≥ 2× the file's bitrate (not on the Plex Relay), stalls alone never leave the file for
    a conversion (`INTERNET_CLEAR_FACTOR`, `lineClearForFile`); only proof about the server (onSlowFile) can. A
    lighter file as it is is still allowed. The card says "Auto quality: keeps the original — your internet is
    fast enough for it" instead of promising a drop.

Tests: off-device Kotlin check of PreBufferRule (resume: 8 s of set-up then 1.5 s of video per second — build 39
started at 10 s with 3 s buffered; now starts at 18.5 s with ~16 s; dead server ends at the 30 s cap; 0:00 starts
unchanged). Vitest: `plexAutoQuality.resume.test.ts` (new), resume block in `PlexSection.autoQuality.test.tsx`
(fails on build-39 PlexSection, passes now), playback-start marking + Kotlin pins in
`useNativePlayer.resume.test.tsx`.

Not changed, still suspects if resume keeps stalling: direct-play identification params (kept — fresh starts are
perfect with them); the WebView's ranged probes of the same file (bufferDiagnostics: 64 KB at 6 s/40 s, 128 KB per
stall round) — they read byte 0 while a resume streams mid-file; server-side stop by client id.

If it still fails, ask the owner for: the Playback stats panel photographed *during the "Getting ready…" hold of a
resume* and 20 s after it starts (buffer ahead, bandwidth now/min/max, restarts + last reason); whether the Plex
app shows a spinner for several seconds when resuming the same film; and for a manual quality change, the stats
panel's Session line and whether "The Plex server couldn't convert this in time" appears after ~30 s.
