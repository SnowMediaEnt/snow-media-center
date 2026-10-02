# Plex deep audit (verified) — fix plan

## Fix plan
Repo: /home/user/snow-media-center.

PRINCIPLE
- One download path that matches the Plex app by default and never caps itself.
- One measurement: bytes as they arrive at the player.
- One quality rule set driven by that measurement.
- One conversion lifecycle.
- Nothing converts at the start except the relay.

BEFORE ANYTHING ELSE
Nothing in the 1.8.0 native path (one DefaultHttpDataSource connection, no throttle or rate cap) explains the gap with the Plex app. The hard customer number is 5.7 Mb/s in one mid-stall window; "1.4" was a WebView probe. Do not publish 1.8.1 build 59 with the current RangeFetch scheduler and start probe. If steps 1-4 cannot be device-tested first, ship with the RangeFetch flag OFF (identical to 1.8.0 and the Plex app) and step 5 done.

A. NATIVE DOWNLOAD PATH (ship-blocking)
Files: android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt, SnowPlayerPlugin.kt, and android/app/src/test/.../RangeFetchDataSourceTest.kt.

1. Arrival metering
- RangeFetchDataSource takes the slot's netBytes AtomicLong (or a callback) and adds n in fetch() after each input.read().
- ByteMeter (SnowPlayerPlugin.kt:2609-2616) skips `source is RangeFetchDataSource`.
- Keep bytesTransferred() in read() for Media3's DefaultBandwidthMeter.

2. Rewrite the scheduler as a work-conserving window
- When a piece finishes, its worker takes the next unfetched piece at once, while unread plus in-flight bytes stay under a budget: about 16 MiB on 2 GB boxes, 32 MiB elsewhere. Subtract it from the 128 MiB low-RAM targetBufferBytes so total memory is unchanged.
- 4 connections on every box. Pieces start at 2 MiB and grow to 8 MiB while reads stay sequential. Fixed buffer pool.
- Notify the reader only on head progress or piece completion. Bounded executor.
- DELETE the `chunks.size < connections` gating, the per-piece `ByteArray(length)`, and the lowRam 3 x 1 MiB branch (SnowPlayerPlugin.kt:903-912).

3. Ramp-up per open
- Each open starts with one 512 KiB piece, and fans out only after at least 1 MiB has been read sequentially from that open. MKV header/Cues/resume/seek/−10 s opens then cost one request each, as in plain Media3.
- On close, a piece with 256 KiB or less left may finish so its connection stays pooled.

4. Robustness
- Per-piece retry from start+filled, 2-3 tries with backoff.
- A piece with no progress for 5-8 s while other connections are idle is re-requested from where it stopped.
- A 4xx/5xx or refused connection on a non-first piece drops to fewer connections (down to 1) for the load.
- A short 206 is EOF only when the end is unknown or reached; check the Content-Range start.
- 416 gets an ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE cause. A 200 at an offset skips forward.
- One manual redirect resolution per open (cross-protocol allowed). Disconnect on every error path.
- getStats reports the live connection count.
- JUnit: slow head with fast others (no idle connections), a failed piece retried, extra-range 503 → fewer connections, short 206, an open that reads under 1 MiB makes exactly 1 request, arrival counting. Plus one run through a delay/loss proxy (netem 150-300 ms, 0.5% loss) comparing against the single connection.

B. JS GATING AND START (ship-blocking)

5. Delete the start conversion (src/components/livetv/PlexSection.tsx)
- DELETE the 3257-3299 block, START_PROBE_* (117-127), startProbeTriedRef (2430), the plex_start_lower event and the startLower* i18n keys.
- Rewrite PlexSection.autoQuality.test.tsx 1012-1054 as "a remote start plays the file".
- Keep the relay start (3236-3245).
- This also removes the copy-library dead end and the auto/viewer timing split.

6. Gate the parallel reader
- PlexSection.tsx 3566: rangeFetch only for a /library/parts/ URL whose host is not private (RFC1918/ULA), never on the relay, and only when useFeatureFlag('plex_range_fetch') (the existing feature_flags table) is on.
- Default the flag on only after the owner-box checklist below passes. It is the kill switch.

7. Speed measurement (src/lib/plexVersions.ts, PlexDetail.tsx, PlexSection.tsx)
- Cache and in-flight keyed by (server, connections). No in-flight sharing across different counts.
- PlexDetail's 4K check and the raise probe use the playback connection count; the raise probe reads 4-6 MB and takes the tail rate.
- Mid-playback `fresh` reads are not reused for start or version decisions.
- Remove cached reads from stallEvidence (freshRead), so only the player's own windows count.

C. RULES AND CONVERSIONS (same release if possible)

8. One down rule (src/lib/plexAutoQuality.ts, PlexSection.tsx 3872-4027)
- Judge delivered bytes over the stall, or windows of 9-15 s or more. Below 0.8x need → best rung that rate carries at 1.3x, files first.
- No bytes arriving is a pause, never a drop.
- Proven line = a sustained 15-30 s arrival rate of at least 2x need.
- A stall count alone may only move to a lighter file. Undo-raise respects a proven line.
- need = min(preset cap, source bitrate). Single stall list.
- DELETE the separate slow-file timer/onSlowFile, AutoQuality.stallCount, StallContext.internetKbps and its write at 3901.

9. Conversion lifecycle (PlexSection.tsx 3655-3807 and 4131-4236, plex.ts, plexAutoQuality.ts)
- A stream-request generation ref is checked after every await in playRatingKey, changeQuality, startConversion, the recoveries, autoRevert and the audio fallbacks.
- One failure state machine per title: fresh session once → original file (unless audio forced it) → lighter conversion → message.
- Disarm the slow-load timer during a recovery.
- Stop the old session through native HTTP and await it (2 s cap) before the decision. On a refusal, move on at once; never keep playing a stopped session.
- One named identity for decision and start: DELETE slowStartFlipRef, the identify flip in startFreshConvert, and plexTranscodeIdentified.
- Record generalDecisionText/transcodeDecisionText and the HTTP status in plex_convert_refused and the stats.
- Audio-forced conversions never revert to the file. A getPlexPart failure at start retries once, then shows an error instead of converting.

D. DIAGNOSTICS AND CONNECTION

10. src/lib/bufferDiagnostics.ts, BufferingDiagnostics.tsx
- DELETE the native WebView file reads: scheduleNativeSample, NATIVE_SAMPLE_*, and the feedSamples host probe on Plex.
- 'was' comes from the player's arrival rates. Keep the labelled Cloudflare quick check. Don't reset lastProbeAt on reloads.

11. plex.ts, PlayerStatsPanel.tsx, PlexSection.tsx
- Route line and plex_play get host:port and IPv4/IPv6.
- Real versionName and Build.MODEL in X-Plex-Version/Device.
- A per-playback X-Plex-Session-Identifier on the file URL.
- An end-of-title analytics event with getStats.
- Show a running recording on the card.
- Native tells JS isLowRamBox once.

12. src/lib/plex.ts, src/hooks/usePlexAuth.ts, src/lib/plex.route.test.ts
- 'lan' only for RFC1918 with publicAddressMatches not false. Parse publicAddressMatches and httpsRequired.
- Require machineIdentifier === clientIdentifier.
- The relay escape saves a found direct base even mid-title.
- Rediscovery probes the saved server first. Narrow the 172 filter to 172.17/16.

E. BACKGROUND LOAD AND CLEANUP

13. AutoUpdatePrompt.tsx and utils/updateCache.ts: no APK download while a player is open (chunked and pausable, or start only after idle on Home).

14. plexProgress.ts and its listeners (PlexSection 781-797, PlexLibraryRows 351-361, PlexDetail 170-179), plus plexUpNext.ts
- Emit the progress event only on final saves or Continue Watching changes.
- No server call from that path. Memoize failed Up Next lookups.

15. SnowPlayerPlugin.kt getStats: PSS read on a background thread.

16. DELETE dead code
- plex.ts: isDirectAudioCodec and SUPPORTED_DIRECT_AUDIO_CODECS; loadPlexQuality/savePlexQuality.
- PlexSection.tsx 2392 (mount load) and 3418 (save).
- Skip getPlexPart at 3210 when versions already carry the bitrate; otherwise add excludeElements.

F. LATER, SEPARATE
- SurfaceView for the main ExoPlayer slot, plus optional 24p display-mode switching. Test Live TV separately.
- 15-30 s back buffer on boxes that are not low on RAM.
- Wi-Fi lock A/B: HIGH_PERF on API 29-33.
- Conversion offset/copyts, subtitle and profile parameters, only after P2's PMS log shows a resumed conversion starting twice.

LIVE TV
Untouched: httpFactory/normal source, tile load control, isLive paths and channel timeouts do not change.

OWNER-BOX REGRESSION CHECKLIST (with the flag on, then off)
- 1080p and 4K remote direct play: from 0:00, resume, ±seek, −10 s, Skip Intro, Up Next autoplay
- Continue Watching and resume point after closing
- Manual quality down and back to Original
- Playback stats average close to the Plex app's figure for the same title
- Live TV zap and rewind

## Confirmed findings

### [high] RangeFetch counts bytes when the player reads them, not when they arrive. This skews every speed rule and the stats, and conflicts with the build-56 rules.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt:187-199,302-364; /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:332-365,872,906-912,2609-2616; /home/user/snow-media-center/src/lib/bufferDiagnostics.ts:684-708; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:232-246,291-314,404-408; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3889-3909,4014-4018,4043-4045
Root cause: ByteMeter is the RangeFetch factory's TransferListener, and bytesTransferred(n) is called only inside read(), when the extractor takes the bytes. Pieces are handed over strictly in order and the worker threads never count anything. While the head piece is slow, data arriving on the other connections stays invisible. When the head completes, the reader swallows the finished pieces at memory speed and the whole backlog lands in one 3 s tick. A window where only non-head pieces received data reads 0.
Evidence: Line 912: `.setTransferListener(meter)` on the RangeFetchDataSource.Factory. RangeFetchDataSource.kt:195-198 is the only bytesTransferred call. fetch() at 333-342 only does `c.filled += n` and notifyAll.

Rules that take the MAX 3 s window:
- starvedKbps 'best' (plexAutoQuality.ts:244)
- stallEvidence (313)
- getPlayerSpeedKbps → notePeak → serverKbps → lineClearFor's '2x proven' (PlexSection.tsx:3892-3904, plexAutoQuality.ts:404-408)

The raise path uses the median (steadyKbps, PlexSection.tsx:4044), which reads low. A 0 window sets paused=true (plexAutoQuality.ts:305), so the slow-file drop is skipped and the card says the server stopped answering while data is flowing. On 1.8.0 (DefaultHttpDataSource) bytes are counted straight off the socket, so this is new with rung 4 and lands exactly on the build-56 starving and proven-line rules written for these customers. The reviewers' 2.3-4x inflation figures are model estimates; the mechanism is certain.
Fix: Count bytes as they arrive. Pass the slot's netBytes AtomicLong (or a callback) into RangeFetchDataSource and add n in fetch() after each input.read(). Make ByteMeter ignore `source is RangeFetchDataSource`, but keep bytesTransferred() so Media3's own DefaultBandwidthMeter still works. In JS, judge delivery on bytes over the whole stall, or on windows of 9-15 s or more, not on the single best 3 s window (see the drop-rules finding).
Conflicts with: Build-56 starving rule (starvedKbps), proven-line rule (lineClearFor/peakKbps), slow-file stallEvidence, raise steadyKbps; Playback stats Now/Min/Max.

### [high] The RangeFetch scheduler caps its own throughput: head-of-line gating, small pieces, 3 x 1 MiB on 2 GB boxes, and idle connections that fall back to TCP slow start.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt:174-180,230-246,249-289,302-380; /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:781-790,903-912; /home/user/snow-media-center/android/app/src/test/java/com/snowmedia/player/RangeFetchDataSourceTest.kt:38
Root cause: scheduleAhead() adds a piece only while chunks.size < connections, and `chunks` counts the piece being read plus finished pieces that have not been read yet. It is called only from open() and advance(), and advance() runs only once the head piece has been fully consumed. A slow or stalled head therefore idles every other connection until it finishes, or until the 30 s read timeout. Each piece is a separate request on a pooled connection that has usually been idle longer than the server's retransmission timeout, so each 1-2 MiB piece restarts TCP slow start (Linux tcp_slow_start_after_idle=1).
Evidence: - Line 232: `while (chunks.size < connections && ...)`. The only callers are 179 and 245, and advance runs only from 259/266.
- Lines 904-911: `rangeConnections = if (lowRam) 3 else 4` and `chunkBytes = if (lowRam) MIB else 2*MIB`.
- isLowRamBox is `totalMem <= 2_200_000_000L` (786), which covers most Fire TV and Google TV boxes. The customer's stats show the 2 GB profile.
- The only validation ran on 127.0.0.1 with no RTT and no loss.

Plain Media3, like the Plex app, keeps one long-lived connection that never goes idle while the buffer fills. On a clean, long-RTT line, 3 x 1 MiB with slow start on every piece can be slower than that single connection, for example a 60-80 Mb/s 4K remux on a 2 GB box. The model throughput numbers are estimates; the gating is certain.
Fix: Rewrite the scheduler as a work-conserving sliding window:
- When a piece finishes, its worker starts the next unfetched piece at once, as long as unread plus in-flight bytes stay under a byte budget: about 16 MiB on 2 GB boxes and 32 MiB elsewhere. Take that budget out of SteadyLoadControl's targetBufferBytes so total memory is unchanged.
- Use the same 4 connections on every box.
- Start pieces at 2 MiB and let them grow to 8 MiB while reading stays sequential.
- If a piece makes no progress for 5-8 s while other connections are idle, re-request its remaining bytes on a fresh connection.
- DELETE the lowRam 3 x 1 MiB branch.
Conflicts with: The owner's 'no speed limits' goal; on clean lines it can do worse than the single connection it replaced.

### [high] The rung-4 start probe is a band-aid. Titles the Plex app direct-plays, and even a viewer's explicit 4K pick, can start as a server conversion based on a 2.5 s WebView read or a cached 1-connection figure.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:117-127,2430,3257-3299,4034-4062; /home/user/snow-media-center/src/lib/plexStallVerdict.ts:70-75; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:185-193
Root cause: On every 'direct' route with a known bitrate, playRatingKey compares a single number to the file's average bitrate with no margin (`have < fileKbps`). If it is lower, the title starts as a conversion at fitPreset(have) (0.75x, floor 720p · 3 Mbps). The number is either a 12 MB / 2.5 s read from byte 0 over 3 WebView connections, or whatever sits in the shared 5-minute cache. The block knows nothing about whether the viewer picked the version. Conversions are the path that fails for these customers on P2.
Evidence: - 3267-3289: `if (partKey && fileKbps && conn.route === 'direct') { let have = cachedPlexSpeed(conn.base); ... if (have != null && have > 0 && have < fileKbps) { ... startConversionRef.current(conn, srcKey, preset, ...) }`.
- An explicit 4K pick (PlexDetail startVersion with picked=true) still reaches this block: with a 40 Mb/s cached read and a 60 Mb/s remux it starts a 1080p · 20 Mbps transcode, often from the 4K file (transcodeSource).
- First play per server waits up to 3 s (START_PROBE_WAIT_MS).
- startProbeTriedRef is set before the probe runs and never cleared, so later starts in the same Plex visit run on cached figures only.
- Getting back to the original needs 1.3x the file's bitrate (raiseTarget) from a 1-connection raise probe. Possible, but unlikely on exactly the lines that start low.
Fix: DELETE the start-time conversion:
- PlexSection.tsx 3257-3299, START_PROBE_* (117-127) and startProbeTriedRef (2430)
- the plex_start_lower event and the startLower toast strings
- PlexSection.autoQuality.test.tsx 1012-1054: rewrite as 'a remote start plays the file'

Keep the relay start at 480p (3236-3245). Every other start plays the original, as the Plex app does. The fixed starving rule handles a line that is really too slow, on the player's own evidence. Choosing between FILES (4K vs 1080p) stays with PlexDetail, using the fixed measurement.
Conflicts with: Build-56 principle that only delivered evidence moves quality; PlexDetail's 'the viewer can always pick 4K'; the starving rule (a third, earlier and noisier gate).

### [high (narrow trigger, but the title never plays)] A start conversion for a version that lives in another library never starts. There is no stream, and Retry repeats the same dead end.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:2360-2361,3205,3289,4131-4151,4716-4724; /home/user/snow-media-center/src/lib/plex.ts:758-763
Root cause: playRatingKey passes srcKey (the copy's own ratingKey) to startConversion. After the awaited decision, startConversion checks `playingKeyRef.current !== key`, but playingKeyRef holds the TITLE's ratingKey, so it returns 'started' without ever setting a stream URL.
Evidence: - 3205: `const srcKey = ver?.ratingKey ?? ratingKey`
- 3289: `startConversionRef.current(conn, srcKey, ...)`
- 4139: `if (playingKeyRef.current !== key) return 'started'`
- 2361: `playingKeyRef.current = playing?.ratingKey`

The viewer gets the 'Starting at ...' toast, then nothing. The 8 s slow-load panel appears, because useTranscode is still false. Retry (4716-4724) calls playRatingKey with the same version, and the cached speed is good for 5 minutes. The trigger: PlexDetail fell back to (or the viewer picked) a copy in another library, and the cached speed was below that file's bitrate. The other callers (changeQuality, startFreshConvert, autoRevert) pass the title key and work. sourceTranscodeUrl already resolves the source item.
Fix: Removed together with the start conversion (finding 3). In startConversion, replace the rating-key comparison with a stream-request generation token (see the conversion-lifecycle finding), so a key mismatch can never silently drop a start again.
Conflicts with: PlexDetail's version fallback; the slow-load/Retry path.

### [medium (high while the start probe exists)] One speed cache and one in-flight read per server are shared by 1-connection, 3-connection and mid-playback reads; whichever ran last decides starts, the 4K/1080p choice, and even counts as stall 'proof'.
Files: /home/user/snow-media-center/src/lib/plexVersions.ts:148-149,192-195,229-293; /home/user/snow-media-center/src/components/livetv/PlexDetail.tsx:336-339,361-373; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3268,3863-3868,4057; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:291-314
Root cause: The cache and the in-flight map are keyed by server only, not by method. `fresh` reads are cached too. The in-flight lookup happens before the connection count is even read. freshRead() feeds that cache to stallEvidence as if it were a fresh read of this title.
Evidence: - Line 233: `known = fresh ? null : cachedPlexSpeed(base)`.
- Lines 237-239: the in-flight lookup comes before `connections` is read, so a 3-connection request can join a 1-connection read.
- Line 288: `cache.set(key, ...)` with no method attached.

Writers:
- PlexDetail.tsx:369 (1 connection, 16 MB from byte 0)
- the raise probe at PlexSection.tsx:4057 (1 connection, fresh, measured while the player itself is downloading)
- the start probe (3 connections)

Readers:
- the start decision
- PlexDetail startVersion (4K→1080p). ceilingVersionIdRef then caps auto quality at that file for the whole film.
- freshRead()

In stallEvidence, for a non-4K file, a read stands in when fewer than 2 in-stall windows exist (312-313). `kbps = max(data, read)` holds even with zero windows. So a stale 1-connection title-page read can trigger the slow-file drop 6 s into a stall, and a high cached read can hide real in-stall evidence.
Fix: - Key the cache and the in-flight map by (server, connections) and never share a read across different counts.
- PlexDetail's 4K check and the raise probe use the playback connection count (rangeConnections, as reported in getStats); the raise probe reads 4-6 MB and takes the tail rate.
- Do not reuse mid-playback `fresh` reads for start or version decisions.
- Remove cached reads from stallEvidence once arrival metering exists (the player's own windows are the evidence).
Conflicts with: The start probe's premise; PlexDetail's 4K rule; the slow-file and starving evidence.

### [medium] Every open fans out to several connections at once, including the MKV header, index (Cues), resume, seek and −10 s opens that read a few KB and then jump elsewhere.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt:174-180,202-213,384-385; /home/user/snow-media-center/src/hooks/useNativePlayer.ts:521; /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:2546-2547
Root cause: open() schedules connections-1 extra pieces (6 MiB, or 2 MiB on 2 GB boxes) right after the first response. close() disconnects every piece still in flight, and Android's HttpURLConnection does not return a disconnected socket to the pool.
Evidence: In Media3 1.5, MatroskaExtractor reads the header, seeks to Cues, then back to the first Cluster. For a resume, ProgressiveMediaPeriod.seekToUs cancels that load and opens again at the resume point. That is 4 opens, each with up to 3 extra TLS handshakes and range reads on the server. On a start from 0, bytes [512K, 6.5M) are requested, cancelled and requested again.

The back buffer is 0 (DEFAULT_BACK_BUFFER_DURATION_MS), so every −10 s rewind is another open and another fan-out. Plain DefaultHttpDataSource makes the same opens with one request each.
Fix: Ramp up per open: one 512 KiB piece, and add parallel pieces only after the reader has consumed at least 1 MiB sequentially from that open. On close(), let a piece with 256 KiB or less left finish so its keep-alive connection can be reused. Optional: keep a 15-30 s back buffer (retainBackBufferFromKeyframe) on boxes that are not low on RAM.
Conflicts with: PreBufferRule's resume hold: extra requests compete before video exists at the resume point.

### [medium] One failed or reset piece fails the whole open. There is no per-piece retry and no fallback to fewer connections, and finished pieces are thrown away.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt:113-115,202-213,262-263,319-327,350-355
Root cause: Any status other than 206, or any IOException, on a piece becomes c.error. The reader throws it when that piece reaches the head, Media3 retries the load, and open() → close() discards every piece, finished ones included. Nothing re-requests a piece or lowers the connection count.
Evidence: fetch() sets c.error at 319-327 and 350-355, and readChunks throws it at 262-263. The only fallback in the source is the '200 on the first response' plain-stream path at 148-166. A proxy or server that refuses extra simultaneous ranges would make every open crawl, 512 KiB at a time, through Media3's retries. That scenario is speculative for PMS itself.
Fix: Retry a failed or short piece 2-3 times on a fresh connection, starting from start+filled, with a short backoff, before reporting the error. If a piece other than the first gets a 4xx/5xx or a refused connection, drop to fewer connections (down to 1) for the rest of the load and fetch that piece again. Reuse already-finished pieces when a reopen lands inside them.
Conflicts with: 

### [low] RangeFetch correctness and efficiency gaps compared with DefaultHttpDataSource.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/RangeFetchDataSource.kt:80-81,127-132,134-147,148-155,167-173,233,264-270,333-342,366-380,387-389
Root cause: Five gaps:
(a) In fetch() 335-336, a stream that ends early is marked eof even when the end of the file is known. readChunks checks eof (264) before the 'range ended early' error, so a capped or short 206 would end the film mid-way.
(b) A 416 is thrown with a null cause (146). Media3 only treats ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE as fatal, so it is retried for about 15 s.
(c) A 200 at position > 0 throws (150-155), where Media3 skips forward.
(d) instanceFollowRedirects only follows same-protocol redirects (371), and every piece goes back to the original URL. If responseCode throws in open() (127-132), the connection is never disconnected.
(e) Every piece allocates a new zeroed 1-2 MiB array (81, 233; ART large-object churn). notifyAll runs after every socket read (341), and the thread pool is an unbounded cached pool (387).
Evidence: Read in code. The connection leak exists only in open(); in fetch() the finally block disconnects a connection it has assigned. None of these is triggered by a normal PMS on plex.direct today, but each turns an edge case into a stop or a long retry loop.
Fix: Treat the stream ending as EOF only when the end is unknown or c.start+filled == end; otherwise refetch the remainder or raise 'range ended early'. Check that the Content-Range start equals c.start. Give the 416 a DataSourceException(ERROR_CODE_IO_READ_POSITION_OUT_OF_RANGE) cause. Skip forward on a 200. Resolve a 3xx once per open (cross-protocol allowed) and reuse the final URL for every piece. Disconnect on every error path. Use a fixed pool of piece buffers. Notify the reader only when the head piece progresses or a piece completes. Use a bounded executor.
Conflicts with: 

### [medium] Three overlapping drop mechanisms fire on the same stalls, the undo-raise skips the proven-line guard, and 'need' uses a preset's cap even when the stream is smaller.
Files: /home/user/snow-media-center/src/lib/plexAutoQuality.ts:345-368,484-552,560-589; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3872-3877,3962-4027
Root cause: A stall feeds three separate drop paths with different evidence and thresholds:
(a) StallCounter: 3 stalls in 5 minutes with no delivery evidence, sized by the steady median.
(b) Slow-file: from 6 s into a stall it decides on ev.kbps, but sizes the drop with dropSpeed() instead of the evidence it fired on.
(c) Starving: 2 stalls in 2 minutes with the best window under 0.8x need.
On top of that, undo-raise drops after a single stall and runs before the lineClearForFile guard. Two separate stall lists track the same events.
Evidence: - plexAutoQuality.ts:541-547 (undo-raise) runs before 550 (lineClearForFile).
- PlexSection.tsx:4018-4020: onSlowFile is sized by dropSpeed(at), a max over steady, in-stall and cached reads.
- needNow at 3877 returns the preset cap: a 12 Mb/s file the viewer set to 1080p · 20 Mbps is judged against 20 Mb/s.
- The count rule is the only one that fires when delivery is adequate but the server pauses, and it moves direct play to a conversion. Once finding 1 disarms (b) and (c), it becomes the rule that actually fires.
Fix: One down rule, driven by arrival-time rates. When the rate delivered over a stall outside the start/seek grace, or across two stalls within 2 minutes, is below 0.8x need, step to the best rung that rate carries with 1.3x headroom, lighter FILES first. Stalls with no bytes arriving are pauses and never drop.
- Proven line: a sustained 15-30 s arrival rate of at least 2x need.
- A stall count alone may only move to a lighter file, never to a conversion.
- Undo-raise respects a proven line.
- need = min(preset cap, source bitrate).
- Keep a single stall list.
- DELETE the separate onSlowFile/slow-file timer, AutoQuality.stallCount, StallContext.internetKbps and its write at PlexSection.tsx:3901.
Conflicts with: lineClearFor/proven line, starving rule, raise backoff.

### [medium] Conversion lifecycle problems: no request generation, two recoveries fire for one dead session, the old session's stop is not awaited, and the 'plain' retry still sends a named decision.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3655-3678,3729-3807,4131-4163,4198-4236; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:800-837; /home/user/snow-media-center/src/lib/plex.ts:32-47,67-104,881-915,943-960
Root cause: Five async paths start or replace the stream: the viewer's pick, automatic moves, the refusal chain, the PLEX_TRANSCODE_HTTP recovery and the slow-load flip/revert. None carries a generation token. The 30 s slow-load timer ignores native.error, and the autoRevert effect does not check whether an HTTP recovery is running, so both start a session for the same failure. stopPlexTranscode is a fire-and-forget WebView no-cors fetch, while the decision goes out at once over CapacitorHttp. The decision always carries plexHeaders (Platform/Product/Device), but an identify:false start.m3u8 carries none.
Evidence: - 4212-4214: 'No cleanup cancels this'.
- fire() at 3668-3677 never looks at native.error.
- 3755-3765: the flip calls startConversionRef regardless of the HTTP recovery.
- 4133-4138: stop, then `await plexTranscodeDecision` with no wait on the stop.
- plexAutoQuality.ts:833: the no-cors fetch is not awaited.
- plex.ts:947: plexReqRaw always sends plexHeaders; 904-907: identify===false leaves the names off the URL only.
- If the viewer picks Original while a fresh-session decision is pending, the late decision still sets the conversion URL and useTranscode=true while qualityKey says 'original'.
Fix: - Add one stream-request generation ref. Every request increments it, and every path checks it after each await.
- One failure state machine per title for: refused at decision, PLEX_TRANSCODE_HTTP, and accepted but never fed. Order: fresh session once → the original file (unless audio forced the conversion) → a lighter conversion → message.
- Disarm the slow-load timer while a recovery runs.
- Stop the old session through the native HTTP stack and await it (2 s cap) before the decision. On a refusal, move on at once and never keep playing a stopped session.
- One named identity for both decision and start: DELETE the named⇄plain flip (slowStartFlipRef, the identify flip in startFreshConvert, plexTranscodeIdentified).
- Keep generalDecisionText/transcodeDecisionText in plex_convert_refused and in the stats.
Conflicts with: The slow-load auto-revert vs the PLEX_TRANSCODE_HTTP recovery; the viewer's pick vs a pending recovery; the build-38 'plain' hypothesis vs the named decision.

### [medium] The start conversion counts as automatic quality's own or as the viewer's pick depending on await timing, and the two recover in opposite ways.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3237,3284,3823-3833,3944-3961,4166-4196; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:613-633
Root cause: The autoQ effect reads startAutoKeyRef once per [ratingKey, playSeq]. playRatingKey sets it to the preset only after its awaits (getPlexPart, the probe). So the start conversion is 'auto' only when both the speed and the part key were already known.
Evidence: - 3237 sets null before any await; 3284 sets the preset after `await Promise.race`.
- As 'auto': onSlowStart never returns to the original, because fromKbps is the file's own bitrate and only lighter files qualify.
- As a viewer pick: autoRevert flips and then goes to the file.
- directAnyway on PLEX_TRANSCODE_HTTP is true only on the auto path (4176).
- A refusal at the start does not call aq.convertFailed (3290-3296).
Fix: Goes away when the start conversion is deleted (finding 3). If any start-time conversion is ever kept, set st.autoKey and autoFromKbps at the moment it is issued and record refusals with convertFailed.
Conflicts with: 

### [medium] A hosted server's public IPv4 listed as 'local' becomes route 'lan': no parallel reader, no start probe, location=lan, a 'Home network' label, and never re-tested.
Files: /home/user/snow-media-center/src/lib/plex.ts:199-222,304-312,381-385,403-415; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:2448,3267,3566; /home/user/snow-media-center/src/lib/plex.route.test.ts:297-306,420-434
Root cause: plexConnRoute returns 'lan' for any IPv4 connection plex.tv marks local, without checking that the address is private. The dedupe keeps the LAN tier when the same URI is also listed as remote. publicAddressMatches is never parsed. The IPv6 branch already treats a global address marked local as 'direct', so the two address families contradict each other.
Evidence: - Line 310: `if (!v6 && !c.ipv6) return 'lan'`.
- Lines 412-413: the lower rank wins in the dedupe.
- The tests pin a public 203.0.113.5 listed remote+local as route 'lan'.
- PlexSection.tsx:3566 `rangeFetch: ... && conn?.route !== 'lan'`; 3267 requires 'direct'.
- If the public IP is listed only as local, it gets the 2.5 s LAN budget and its plain-http twin (rank 20) beats remote https (rank 100).
- The photographed P2 box showed 'Direct to server', so this was not that customer's cause. It applies to any server with host networking or a public IP on its interface.
Fix: - Classify local IPv4 as 'lan' only when it is RFC1918 and the resource's publicAddressMatches is not false (parse it in fetchPlexServers). Give public addresses the remote 6 s budget.
- Decide the reader by destination: parallel only for non-private IPs, never on the relay.
- Update the two pinned tests.
- Query plex_play analytics for route='lan' on customer boxes to see who is affected.
Conflicts with: 

### [medium] The '1.4 Mb/s' in the customer's photo (the card's 'was', and the bug note's '1.4-5.7 Mb/s from the server') is a 64-128 KB WebView read of the file limited by TCP slow start, not what the server delivers.
Files: /home/user/snow-media-center/src/lib/bufferDiagnostics.ts:139-147,349-356,470-531,559-629,650-661; /home/user/snow-media-center/src/components/livetv/BufferingDiagnostics.tsx:151-153; /home/user/snow-media-center/src/hooks/useNativePlayer.ts:337; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:323-328
Root cause: On native, state.samples are fed only by runRangeProbe:
- a 64 KB read at 6 s, 40 s, then every 90 s
- a 128 KB read in each stall round
The first stall round fires about 1.5 s into every load, because useNativePlayer calls diagBuffering(true) on load. Each read starts from byte 0 on a new Chromium TLS connection and is timed after the headers, so the rate is about 524 kbit / (2 x RTT).
Evidence: - BufferingDiagnostics.tsx:151-153: 'was' is snap.streamEarlyKbps, which earlyKbps() computes from state.samples.
- recordStreamThroughput is only called from VideoPlayer.tsx (HTML5).
- The only player-measured number in the photo is 'Now 5.7 Mb/s', one 3 s window mid-stall on one connection.
- These probe numbers also feed classify() (hostThin/streamNeverFast → 'server') and stallBudgetKbps when no player rate exists.
- beginStream resets lastProbeAt on every reload.
Fix: For native Plex, stop the WebView reads of the file: DELETE scheduleNativeSample and the ranged host probe's sample feed. Derive 'was'/early from the player's own arrival rates (best window in the first 30 s). Keep only the Cloudflare quick check, labelled as such. Do not reset lastProbeAt on reloads of the same title. Re-read the customer evidence: the hard figure is 5.7 Mb/s on one connection.
Conflicts with: The player's own rate reports; it led rung 4 to assume one connection carried 1.4 Mb/s.

### [medium (once per release per box)] The silent APK auto-update download (about 40 MB) keeps running after the viewer opens Plex.
Files: /home/user/snow-media-center/src/components/AutoUpdatePrompt.tsx:44-60,108-131,138-143; /home/user/snow-media-center/src/pages/Index.tsx:1656; /home/user/snow-media-center/src/utils/updateCache.ts:130-180; /home/user/snow-media-center/src/utils/downloadApk.ts:230
Root cause: The check is gated on Home, but once prepareSmcUpdate starts a native Filesystem.downloadFile, leaving Home only holds the prompt (pausedRef/heldRef). Nothing pauses or cancels the transfer.
Evidence: - 141-143: only a NEW check is skipped while streaming or paused.
- 124: `await prepareSmcUpdate(data)` has no abort path.
- downloadFile has no cancel handle.
- Happens on every box's first launch after each release, when the viewer goes from Home into a film within the download window, right on the 10-45 s start-up hold.
Fix: Start the silent download only after the box has been idle on Home with no player open, or on the next launch. Better: download in 4-8 MB Range chunks that wait while isPlexPlaybackActive() or the Player is open, and resume from the cached partial file.
Conflicts with: 

### [medium (smoothness/4K/HDR parity, not buffering)] Video is drawn through a TextureView under the WebView, not a SurfaceView: frames are paced by the UI thread, 4K is flattened into the app's 1080p window, there is no HDR, and no frame-rate matching. The Plex app uses SurfaceView.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:726-767,1049
Root cause: ensureSurface puts a TextureView under the transparent WebView and buildPlayer calls p.setVideoTextureView. TextureView frames go through the app's UI thread and RenderThread, and are drawn into the app window's buffer.
Evidence: `val tv = TextureView(act)` (735), `parent.addView(fl, 0, ...)` (764), `p.setVideoTextureView(s.textureView)` (1049). grep finds no setFrameRate, preferredDisplayModeId or SurfaceView for ExoPlayer (only mpv uses a SurfaceView). This costs dropped and skipped frames and picture quality, not STATE_BUFFERING.
Fix: A separate project, after the buffering work: use a SurfaceView (setVideoSurfaceView) for the main fullscreen ExoPlayer slot behind the transparent WebView, as mpv already does in this app, with the shutter and subtitle views above it. Optionally add display-mode switching for 24p. Test Live TV with it separately.
Conflicts with: 

### [medium (impact depends on P2 settings)] Every provider-linked box shares one Plex viewer account and token, and SMC throws away the server's refusal text, so per-user limits on P2 would hit all SMC conversions together, invisibly.
Files: /home/user/snow-media-center/supabase/functions/plex-provider-token/index.ts:23-28,569; /home/user/snow-media-center/src/lib/plex.ts:943-960
Root cause: plex-provider-token returns the same PLEX_PROVIDER_TOKEN to every box. PIN-linked customer boxes use the provider's account too. plexTranscodeDecision keeps only generalDecisionCode/transcodeDecisionCode.
Evidence: - Line 569: `return jsonResponse({ ok: true, token })`.
- The comment at 23-28 says to set it to one viewer account's token.
- Conversions are server transcode sessions counted against that one user. Direct play sends no /decision or /:/timeline on shared accounts.
- Whether P2 has per-user stream limits, transcoder caps or kill scripts cannot be seen from code. That would fit the 'server answers SMC's conversion with HTTP errors' reports, but it is unverified.
Fix: In code: record the decision text (generalDecisionText/transcodeDecisionText) and the HTTP status in plex_convert_refused and Playback stats. Owner: check P2's settings (see askCustomerFor). Long term: stream as each customer's own seat (Hub plex_members), or raise the limits for the viewer account.
Conflicts with: 

### [low] A saved relay route plays the first titles over the 2 Mbps relay, and a direct path found while a title starts is thrown away.
Files: /home/user/snow-media-center/src/hooks/usePlexAuth.ts:173,483-561; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3236-3245
Root cause: A relay record is only re-checked by the relay escape: first try 10 s after open, skipped while a title plays. If a title starts during the probe, line 517 returns before savePlexServer at 522.
Evidence: - 173: `retest = cached.route !== 'relay' && ...`
- 497: `if (isPlexPlaybackActive()) return false`
- 517 returns ahead of `await savePlexServer(upgraded)` at 522
- 556: `schedule(soon(RELAY_OPEN_DELAY_MS))`, 10 s
- Every relay play starts as a 480p · 2 Mbps conversion.
Fix: Always persist a found direct base with savePlexServer, even mid-title (no setConn, per Rule 1). When the saved route is relay, run pickBetterPlexConnection in parallel with the /identity check at connect (about 7 s cap).
Conflicts with: 

### [low] Connection discovery hygiene problems.
Files: /home/user/snow-media-center/src/lib/plex.ts:89-90,199-236,482-490,551-556; /home/user/snow-media-center/src/hooks/usePlexAuth.ts:129-175,252-279
Root cause: Five gaps in how servers and addresses are checked and chosen.
Evidence: - An empty or {} /identity answer is accepted, because both checks only reject a mismatching id when one is present (plex.ts:488, usePlexAuth.ts:140).
- httpsRequired, publicAddressMatches and presence are never parsed.
- isDeadIp drops all of 172.16.0.0/12 (229), which includes real home LANs.
- The cached /identity check has 5 s (553), less than the 6 s probe budget. Any failure rediscovers in plex.tv order (264-279) with no preference for the saved server.
- A saved https plex.direct IPv4 base is never re-checked against plex.tv's list (plexRouteImprovable false), and there is no network-change listener.
Fix: - Require machineIdentifier === clientIdentifier in both checks.
- Parse httpsRequired (skip http candidates when it is true) and publicAddressMatches.
- Narrow the 172 filter to 172.17/16.
- On rediscovery, probe the saved server first.
- At idle on Plex open, confirm the saved base is still listed with the same route.
Conflicts with: 

### [low] The server can't see or tell apart SMC streams, and SMC can't show which endpoint it uses. Direct play is not registered, the identity is the same on every box, and the timeline has no session id.
Files: /home/user/snow-media-center/src/lib/plex.ts:13-15,32-47,338-347,835-848,1775-1787; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3340,4787-4792; /home/user/snow-media-center/src/components/livetv/PlayerStatsPanel.tsx:152-154; /home/user/snow-media-center/src/main.tsx:20-37
Root cause: Five gaps:
- plexRouteLabel reduces the base to 'plex.direct' or 'IP' with no host or port, and plex_play logs only route and secure.
- X-Plex-Version is '1.0' and the device name is the same on every box.
- The direct-play URL carries no session id, and there is no /:/timeline on shared accounts.
- The own-account timeline has no session id and no buffering state.
- JS and native also use different low-memory definitions (deviceMemory/Fire TV vs totalMem ≤ 2.2 GB), so which probes run and which buffer profile applies disagree on the same box.
Evidence: Read in code. The bug note's open question, which address the Plex app uses, cannot be answered from SMC today. Not a throughput defect.
Fix: Diagnostics:
- Show host:port and IPv4/IPv6 in the stats Route line and add them to plex_play (the server's public address, not a secret).
- Send the real versionName and Build.MODEL in X-Plex-Version/Device, and keep Product/Platform stable.
- Add one per-playback X-Plex-Session-Identifier to the file URL.
- Send one end-of-title analytics event with getStats (arrival avg/min/max, stalls, stallSec, restarts, lastError/httpStatus, connections, route kind/port/IP family).
- Have native report isLowRamBox to JS once.
Conflicts with: 

### [low] Each 15 s progress save re-renders the hidden browse view. On own accounts it also requests On Deck from the server, and failed Up Next lookups are retried every 15 s.
Files: /home/user/snow-media-center/src/components/livetv/PlexProgressReporter.tsx:27,71-109; /home/user/snow-media-center/src/lib/plexProgress.ts:115-145; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:781-797; /home/user/snow-media-center/src/components/livetv/PlexLibraryRows.tsx:277-298,351-361; /home/user/snow-media-center/src/components/livetv/PlexDetail.tsx:170-179; /home/user/snow-media-center/src/lib/plexUpNext.ts:15-46
Root cause: save() emits PLEX_PROGRESS_EVENT on every beat. The listeners rebuild Continue Watching, which changes ownContinue and so re-runs upNextEpisodes. PlexLibraryRows refetches its On Deck row (a server request when serverResume). Only successful nextEpisode lookups are memoized.
Evidence: Read in code. watchNonce already refreshes these panels when the player closes, so the per-beat refresh is redundant. It costs CPU and UI-thread time (relevant with TextureView), but negligible bandwidth.
Fix: Emit PLEX_PROGRESS_EVENT only on final saves or when Continue Watching membership or order changes, or have the listeners ignore it while isPlexPlaybackActive(). Never call the server from the progress-event path. Memoize failed nextEpisode lookups for a few minutes.
Conflicts with: 

### [low] Playback stats calls Debug.getPss() on the UI thread every 5 s while the panel is open.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:1518-1523,1605,1623-1630
Root cause: getStats runs statsOf inside runOnUiThread, and statsOf calls cachedPssMb(), which re-reads Debug.getPss() every 5 s. The panel polls every 1 s.
Evidence: engineCompare.ts:49-53 already notes that this 'stalls a slow box'. With TextureView, frame delivery waits on that thread, exactly while support asks customers to open the panel.
Fix: Read PSS on a background executor every 10-30 s into pssCacheMb, and only return the cached value on the UI thread.
Conflicts with: 

### [low] An audio-forced conversion that is slow to start reverts to the file whose audio can't play, and a metadata failure at Play silently starts a full conversion.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:3600-3640,3786-3799,3308-3311
Root cause: The autoRevert effect calls sourceDirectUrl without checking forcedTranscodeRef. The audioWarning effect has no once-per-title guard, so the conversion comes back. The start block's catch converts at original quality with no decision and no stop.
Evidence: convertAlternative and convertRefused pass `files: !forcedTranscodeRef.current` (4181, 4267); the revert path does not. Lines 3308-3311 are `catch { setStreamUrl(sourceTranscodeUrl(conn, srcKey)); setUseTranscode(true); }`.
Fix: When forcedTranscodeRef is set, use the same path as convertRefused (no file). Retry getPlexPart once, or use the version list's partKey, and show an error rather than converting.
Conflicts with: 

### [low (verify on server first)] Conversion requests have no offset or subtitle control and limit audio with ad-hoc parameters instead of a client profile.
Files: /home/user/snow-media-center/src/lib/plex.ts:881-910,926-940
Root cause: start.m3u8 and /decision carry audioCodec=aac&maxAudioChannels=6, with no offset, copyts, subtitles or X-Plex-Client-Profile-Extra. The resume position goes only to the player.
Evidence: grep finds no 'offset=', 'subtitles=' or 'X-Plex-Client-Profile' in src. What PMS then does (a transcoder start at 0:00 followed by a seek; burning in the shared account's saved image subtitle) is inferred, not proven.
Fix: First look at P2's PMS log for one resumed conversion. If the transcoder starts twice, or video is transcoded because of subtitles, add offset/copyts (and handle the playlist's time base), a no-burn-in subtitle choice, and profile-extra limits. Verify each against P2's PMS version.
Conflicts with: 

### [low] Dead or leftover code, and redundant fetches.
Files: /home/user/snow-media-center/src/lib/plex.ts:850-857,982-1001; /home/user/snow-media-center/src/lib/plexAutoQuality.ts:381,670; /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:2392,3210,3418,3901
Root cause: Unused helpers, a saved quality that no longer decides anything, and a metadata refetch on every play.
Evidence: - isDirectAudioCodec and its codec list are never called, and their comment contradicts FFmpeg PREFER.
- StallContext.internetKbps is written but never read.
- stallCount() is unused.
- savePlexQuality runs on every change, but starts always reset to 'original'. The mount-time loadPlexQuality can resolve after a fast deep-link start and leave qualityKey at a preset while the file plays directly.
- getPlexPart re-fetches full metadata with no excludeElements on every Play, even when versions are already known.
Fix: DELETE isDirectAudioCodec and SUPPORTED_DIRECT_AUDIO_CODECS, internetKbps, stallCount, loadPlexQuality/savePlexQuality, the mount effect at 2392 and the call at 3418. Skip getPlexPart when the version list already has the bitrate; otherwise add excludeElements.
Conflicts with: 

### [low (impact unverified)] On Android 10+ the Wi-Fi lock uses LOW_LATENCY mode, while ExoPlayer and the Plex app use HIGH_PERF; the owner's API-28 Fire TV gets HIGH_PERF.
Files: /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt:807-823
Root cause: holdWifi picks WIFI_MODE_FULL_LOW_LATENCY when SDK ≥ Q. That mode overrides Media3's HIGH_PERF lock while the app is in front.
Evidence: Lines 812-813. This is a real difference between the owner's box and Google TV / Fire OS 8 customer boxes. Whether some chipsets' low-latency mode lowers throughput is not provable from code. On API 34+ HIGH_PERF is a no-op.
Fix: A/B test on one Android 10+ customer box: HIGH_PERF on API 29-33 (matching ExoPlayer and Plex) and LOW_LATENCY only on 34+. Keep whichever measures better.
Conflicts with: 

### [low] A DVR recording sharing the line is not shown on the Plex buffering card.
Files: /home/user/snow-media-center/src/components/livetv/PlexSection.tsx:4753-4755; /home/user/snow-media-center/android/app/src/main/java/com/snowmedia/dvr/RecordingService.kt:59
Root cause: RecordingService keeps capturing a channel during Plex by design, and neither the card nor auto quality knows about it.
Evidence: BufferingDiagnostics gets no recording state; recordGuardNote exists, but only for the update prompt.
Fix: Show 'a recording is using part of your internet' on the card and in the stats when one is active.
Conflicts with: 

## Rejected (do not do)
- Use FFmpeg in EXTENSION_RENDERER_MODE_ON instead of PREFER: PREFER has been set since v1.6.6 (caf8f146) on purpose, so Dolby/DTS/TrueHD play with sound, and the build fails if FfmpegLibrary is missing. Software audio cannot cause STATE_BUFFERING (the closed 4K note checked this). Changing it risks bringing back 'no sound', so it needs its own device test plan, not this throughput fix.
- The game socket stays connected during Plex: Confirmed that useGameSocket never disconnects, but an idle socket.io connection, even one reconnecting with backoff, costs negligible bandwidth. It is not Plex code and cannot explain buffering. It can be a separate cleanup.
- Rank addresses by measured throughput instead of the fixed order (E7): The code fact holds (plex.direct https IPv4 first, held until better-ranked candidates fail), but that is the same preference Plex clients and plexapi use, and nothing shows the Plex app uses another endpoint. Kept only as diagnostics: show host:port and IP family in the stats, and get the Plex app's endpoint from the server dashboard.
- A new session id on every conversion start causes PMS to answer 400 (E4 sub-claim): It rests only on outside reports (PocketFlex, PMS 1.43.2) that cannot be checked here. The fresh id per start is deliberate (plex.ts:888-892) so the server never hands back the old session. Stop ordering and the identity mismatch are kept; this part is not.
- RangeFetch fetch() leaves connections open on errors (part of A9c): Wrong for fetch(): once conn is assigned, its finally block disconnects it whenever finished is false (356-359). Only open() leaks, when responseCode throws (127-132); that part is kept in the correctness finding.
- Model-derived numbers (2.3-4x inflated best windows, 90-100% missed starving windows, 12-35 Mb/s ceilings, '3 MiB per RTT ≈ 126 Mb/s'): These come from off-device models and cannot be verified from code or devices. The mechanisms behind them (read-time metering, head-of-line gating, slow start after idle) are confirmed; the sizes are not.
- 'Stats bandwidth is suitable for comparing with the Plex app' (reviewer E, checked-fine list): True for single-connection loads, but not for RangeFetch. There Now/Min/Max are counted at read time and are bursty. Only the long-run average is comparable until arrival metering lands.
- A title started lower 'practically never' gets back to the original (C2 wording): Overstated. The raise needs 1.3x the file's bitrate, measured with a 1-connection probe at most every 2 minutes, which can succeed on a fast line. The real defect is the start conversion and the mismatched measurement method, which are kept.
- The shared provider account explains the IO_BAD_HTTP_STATUS conversion refusals: The shared token is confirmed, but whether P2 enforces per-user limits cannot be seen from code. It is kept as a server-settings question plus the code change that records the decision text.

## What to ask customers
From an affected customer (Smitty and the others):
1. SMC version under Settings → About: 1.8.0 (43) or 1.8.1 (59). 1.8.0 reports say nothing about rung 4.
2. Box model, Wi-Fi or Ethernet, and the type of internet (cable/fiber, 5G home internet or Starlink, which use carrier NAT or IPv6).
3. VPN: app name, exit city, and whether split tunnelling is on. Does the Plex app go through the VPN too?
4. In the Plex app, same box, same title: the playback-info screen (Direct Play or Transcode, quality, bandwidth avg/min/max, buffer ahead), and the server connection it uses if they can find it (address, port, secure or not).
5. In SMC, on the fixed build: photos of Help → Playback stats at about 30 s, about 2 min, and during a stall. Lines needed: Session, Server, Route (host:port), Buffer ahead, Bandwidth Now/Avg/Min/Max, Download connections, Load profile, Restarts / last error / HTTP status, Stalls, decoders, dropped frames. For a quality change that won't play: the HTTP status and the server's reason.
6. When it happens:
   - from 0:00 or only on resume/seek
   - 1080p vs 4K
   - which titles or libraries
   - time of day
   - with a recording running
   - a spinner (a stall) or jerky picture (dropped frames)
7. If possible, one A/B test on a test build: the parallel reader flag on vs off, and the VPN on vs off.

From the P2 server owner (no customer effort):
8. Plex Web Dashboard while the customer plays in the Plex app: player, Direct Play, bandwidth, LAN/WAN, Secure, address. Then the same while they play in SMC: does any SMC session appear?
9. Plex Media Server.log filtered by the customer's public IP: which host and port the Plex app's /library/parts requests use, whether they are TLS, and SMC's per-request times. Any 400/503 on /video/:/transcode/universal/start.
10. P2 settings: PMS version, Remote streams allowed per user, Limit remote stream bitrate, Internet upload speed, Maximum simultaneous video transcode, and any Tautulli or kill-stream scripts. Also whether the media sits on cloud storage, and whether plex.tv lists P2's public IP as a local connection.

From the Hub analytics:
11. plex_play route and secure per device (look for route='lan' on customer boxes), plus buffer_diag_verdict, plex_convert_refused, plex_convert_http, and (once added) the end-of-title stats event and the decision text.