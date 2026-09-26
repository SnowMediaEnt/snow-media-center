# Plex 4K has trouble (1.7.9)

## What's broken
After the 1.7.9 buffering fix, 1080p plays well but 4K titles "have trouble" (owner, first report).
Details still needed from the device: see below.

## How the owner reproduces it
Play a 4K title in Plex: it buffers immediately at the start, then automatic quality converts it down to
1080p ("Lowered to 1080p…"). The official Plex app plays the same 4K title direct (earlier photo from the
same box: HEVC direct play, avg 84 Mb/s, peaks 305 Mb/s from the server, ~18 s buffer ahead).
Stats-panel photo not yet provided. Owner also saw a message about "50 Mbps for 4K" (likely the title
page's speed note "4K needs ~50 Mb/s, you have ~X") and felt it was wrong. Keep versionName 1.7.9 for this fix.

## Context from the Plex buffering fix (closed at rung 3)
- 1.7.9 player: continuous top-up; main slot byte budget ~144 MB on normal boxes (4K at 60-80 Mb/s = only
  ~15-19 s ahead) and 128 MiB + 20 s floor on 2 GB boxes; pre-buffer hold targets 25 s (can't be reached for
  4K, so it ends on the "buffer full" rule or the 10 s/30 s caps).
- Auto quality won't move the original to a conversion on stalls alone when the internet check is >= 2x the
  file's bitrate. For 4K (60-80 Mb/s) that needs a 120-160 Mb/s quick check; below that it can still drop
  to a server conversion from 4K, which is slow to start on a shared server.
- Audio is decoded in software (FFmpeg) where the Plex app passes it through; video drawn via TextureView.

## Tried
- Rung 2 (below). Not yet tested on the device.

## Rung 2 (fixer-2) — what changed and why
Checked against the code (Media3 1.5.0 sources for DefaultLoadControl / ExoPlayerImplInternal):

**Why 4K stalls at the start and 1080p doesn't — the start-up hold.** A start from 0:00 is held until 25 s
are buffered or 10 s after load(). A 1080p file (~20 Mb/s) over the owner's line (Plex app: ~84 Mb/s
average) reaches 25 s in a few seconds, so the 10 s limit never matters. A 4K remux carries 3-4x the bytes:
at ~1.2x its own rate, after ~2 s of header/index reads, 10 s of filling gives under 10 s of video (so the
"full" rule, which needs ≥10 s, doesn't end it either). It started with that, the first slow spell of the
server (the Plex app saw 15.8 Mb/s minimum) emptied it, and after the stall it played on at only 5 s
(bufferForPlaybackAfterRebufferMs), which the next dip emptied again. The byte budget (~144 MB on normal
boxes = 15-19 s of 60-80 Mb/s) is about the Plex app's own ~18 s, so it isn't the start stall on its own,
but it leaves no margin.

**Why automatic quality then left 4K.** The title has a 4K and a 1080p file (the speed note only shows on
such titles). (1) `lineClearForFile` never protected a file-to-file drop: with a 1080p file below, three
stalls after the 30 s grace always went to "1080p". Its protection against conversions needed the
Cloudflare quick check (256 KB) to read ≥2x the file (120-160 Mb/s), which it rarely does. (2) The early
"slow file" drop accepted one window of the stall plus the title page's speed read as proof; that read
(3 s / 16 MB from byte 0, averaged over TCP's ramp-up to a far server) under-reads a fast line, e.g. the
"4K needs ~50 Mb/s, you have ~X" the owner saw. START_GRACE_MS (30 s from the first 'playing') does keep
the start itself from counting; that part is unchanged.

**Checked, not the cause:** software audio (FFmpeg TrueHD/DTS/EAC3 7.1) can't make the player report
buffering: its renderer is "ready" whenever samples are there; slow decoding shows as audio underruns and
dropped frames, not STATE_BUFFERING. TextureView at 4K likewise costs frames, not buffering. Both show
in the stats panel (audio decoder, dropped frames). Relay/route: a 4K start on the relay starts at the
relay preset, so an original 4K start is a direct route; unchanged.

Changes (1080p, conversions and Live TV behave exactly as in 1.7.9):
- `PreBufferRule.kt`: a 4K film's hold (uhd) — after the same 10 s of filling it starts once it has 20 s
  (UHD_START_MS), or when the byte budget is spent (the "full" rule), or after 30 s of filling at most
  (45 s in all for a resume). 25 s target unchanged. The indicator gets maxWaitMs 30 s for 4K.
- `UhdBuffer.kt` (new, pure): 4K = picture ≥1800 tall or ≥3200 wide; 4K byte budget = half the app's heap
  (largeHeap is on), 256 MiB at most, never below the library's own; 10 s restart after a stall.
- `SnowPlayerPlugin.kt`: `SteadyLoadControl` replaces the main slot's DefaultLoadControl.Builder (normal
  boxes, same 120/120/2.5/5 s and library budget) and FlooredLoadControl (2 GB boxes, same 128 MiB + 20 s
  floor). For a film (load() calls `beginStream(film = !live)` before prepare) whose selected picture is
  4K (onTracksSelected): the budget from UhdBuffer on normal boxes (27-34 s of 60-80 Mb/s on a 512 MiB
  heap; 2 GB boxes keep 128 MiB + 20 s floor), and after a stall it plays on at 10 s instead of 5 s (or
  when the buffer can't take more). The stats panel's load profile adds "· 4K: 256 MB, 10 s restart".
- Auto quality (`plexAutoQuality.ts`, `PlexSection.tsx`): for a 4K file played as it is, the line counts
  as clear when the player's own best 3 s window from the server this title (kept per title; it fills
  its start flat out) or the quick check is ≥2x the file. Then stalls alone never leave 4K — neither for a
  conversion nor for the 1080p file — and a slow spell in a stall is not "slow file" proof. A 4K stall
  also needs two of the player's own windows; a speed read can no longer stand in for one. A line never
  seen at 2x still drops as before.
- Speed check (`plexVersions.ts`): the rate is now the better of 1.7.9's and the second half of the read
  (past the ramp-up), so a fast far line no longer reads low. The note now reads "This 4K file averages
  ~48 Mb/s, more in busy scenes; this TV measured ~X Mb/s from the Plex server" (no "needs" figure that
  reads like a TV requirement). Still used to start 1080p on a 4K poster when clearly too slow.

Tests: `android/app/src/test/.../PreBufferRuleUhdTest.kt` (JUnit; run off-device with kotlinc: the 1.7.9
rule starts that 4K case at 10 s with 9.6 s; the new one at 19 s with 20.4 s; 1080p cases unchanged);
`plexAutoQuality.4k.test.ts`; 4K block in `PlexSection.autoQuality.test.tsx` (3 of 4 fail on 1.7.9: kept
4K with a proven line, slow spell no proof, one window + low read no proof; the 4th pins that an unproven
line still drops to the 1080p file); probe ramp-up and wording in `plexVersions.test.ts` /
`PlexDetail.versions.test.tsx`; Kotlin pins updated in `useNativePlayer.resume.test.tsx`. Kotlin
type-checked against Media3 1.5.0 stubs (new: onTracksSelected, calculateTargetBufferBytes,
ExoTrackSelection, TrackGroupArray).

If it still fails, ask the owner for:
- the Playback stats panel photographed during "Getting ready…" and ~20 s into a 4K start, and during a
  stall: load profile line (does it say "· 4K: … MB" and which base profile, i.e. 2 GB class or not), buffer
  ahead, bandwidth now/avg/min/max, video + audio decoder and format, dropped frames, Java heap;
- how long "Getting ready…" lasted, and whether the stall came right after it or later;
- the 4K title's note on its page (the measured figure) and the Plex app's stats for the same title.
Remaining suspects if the buffer is full and it still stalls: decoder/TextureView (dropped frames),
HttpURLConnection throughput vs the Plex app's stack (compare max bandwidth).
