# Plex buffers for some customers (official Plex app fine), with and without VPN

## What's broken
Several customers report SMC's Plex buffering while the official Plex app on the same box, same server
(mostly "Snow Media P2"), same title plays fine. Happens with the VPN on and off. The owner asked for the
highest rung (fixer-4).

**Important:** customers are still on the published 1.8.0 (versionCode 43). The build-56 fix below is in
1.8.1 (build 59), which is NOT published yet (owner tests on the Fire TV first). So the current reports do
not prove that fix failed; but it was never verified on a customer line either.

## Device evidence (one customer, photos)
- VPN OFF, buffering card: "Buffering · 3s · Now 5.7 Mb/s was 1.4 · Needs 12.0 Mb/s · Internet 42.5 Mb/s";
  "Your internet is fine (quick check 42.5 Mb/s). This video needs about 12.0 Mb/s. Auto quality: keeps the
  original — your internet is fast enough for it. Route: Direct to server · plex.direct · https".
  => the Cloudflare quick check is high but the Plex server delivers 1.4-5.7 Mb/s on this route; 1.8.0 keeps
  the 12 Mb/s original and stalls forever.
- VPN ON, Playback stats: Session "Converting to 720p · 4 Mbps", Server Snow Media P2, Route Direct ·
  plex.direct · https; Engine Buffering, 0.0 s ahead; Bandwidth Now 0.0, Needs 4.0; Player "Restarts 6 (last:
  stream error IO_BAD_HTTP_STATUS)", Load steady 50 s / 128 MB, 20 s floor (2 GB box); Video/Audio "—".
  => the server answers SMC's conversion with HTTP errors; SMC restarted the same session 6 times.
- The official Plex app works for her (mode unknown: we asked whether it shows Direct Play or Transcode and
  at what quality — no answer yet).

## History (closed fixes in this area — don't repeat)
- 1.7.9 rung 3 (bug "Plex buffering at 1080p/4K", owner's own box): pre-buffer hold rules (PreBufferRule.kt),
  continuous top-up load control, 30 s read / 15 s connect timeouts, Wi-Fi lock, plex.direct preferred over
  custom/http, relay last, stream URLs identify SMC on direct play, NO custom User-Agent on
  /transcode/universal/ (build 39's own agent broke conversions), START_GRACE_MS, INTERNET_CLEAR_FACTOR /
  lineClearForFile (quick check >= 2x file bitrate => stalls never leave the original).
- 1.8.0 rung 2 (4K): UHD hold and byte budget (UhdBuffer.kt, SteadyLoadControl), 4K line proof from the
  player's own best 3 s window, speed check reads the second half of the read.
- Build 56 / 1.8.1 (fixer-2, commit 188c200c, TRACKER row 39), NOT yet on any customer box:
  - quick check can no longer keep a stalling stream; a line is "proven" only by the player's own best 3 s
    window from the server (>= 2x the file); new "starving" rule: two stalls outside grace where the best
    delivered rate < 80% of need => drop to what that rate carries with headroom; step-up waits 10 min.
  - native: HTTP status of IO_BAD_HTTP_STATUS exposed (httpStatus, stats "HTTP nnn"); a conversion is tried
    twice then PLEX_TRANSCODE_HTTP; JS recovery: fresh session (new id, /decision first, identified like
    Plex's players on this retry path only) → file as-is if measured rate carries it, else lighter
    conversion → translated "server couldn't prepare this" message with HTTP code. Capped at 4 recoveries.
  - fixer-2's notes on what differs from Plex's own players: no identification (Platform/Product/Device/
    Client-Profile) on the FIRST start.m3u8 (Android default UA there on purpose since build 39), no
    /decision before the first start, no /transcode/universal/ping or /:/timeline keep-alive while paused,
    no `location` (lan/wan) parameter. Not changed for the first conversion.

## What's still unknown / suspects
- What the official Plex app actually does on these lines (Direct Play vs Transcode, quality). Plex clients
  measure bandwidth to the server and pick a remote quality; SMC chooses from a Cloudflare quick check.
- Whether SMC should measure throughput FROM THE PLEX SERVER before choosing (e.g. a short ranged read of
  the file itself) and start remote (wan) playback at a quality that rate carries, as Plex clients do.
- Why the server refuses SMC's conversions (HTTP code unknown on 1.8.0): transcoder limits for shared users,
  missing identification/decision, session handling, or VPN IP rules.

## Rung 4 (fixer-4) — what changed and why

### New facts from the owner, used here
- The official Plex app on the affected customer's box shows **Direct Play, 1080p** for the same title and
  plays fine. So the line and the server CAN deliver the original (~12 Mb/s) directly; SMC's player got
  1.4-5.7 Mb/s on the same plex.direct https route. The main target is therefore how SMC's player
  downloads the file, with quality steps only as a safety net.
- "Some people have trouble with the changing of quality — not playing": a manual pick of a lower quality
  (a conversion) does not play on 1.8.0.

### Root causes (as far as they can be established off-device)
1. **One TCP connection per file.** Media3's DefaultHttpDataSource opens the file once ("Range: bytes=N-")
   and reads it over a single connection. A single flow to a far server is capped by that path's round
   trip, loss and shaping; nothing in the box's receive window, the load control (128 MB / 20 s floor on
   2 GB boxes tops up continuously and was downloading flat out during the stalls) or the Wi-Fi lock
   explains 1.4-5.7 Mb/s on a 42.5 Mb/s line. SMC's own probes during play are tiny (64-256 KB). The Plex
   app gets more from the same server; parallel pieces are how a single slow flow is beaten.
2. **Conversions were asked for unlike Plex's own players.** No decision call before the first start, no
   platform in the request (the server picked the conversion profile from the player's User-Agent, which
   is exactly what build 39 showed to be brittle), the old session left running when a new one was asked
   for (stopped only 1.5 s AFTER the new one — a server that allows a shared user one conversion at a
   time, or is still tearing the old one down, turns the new one away), and no keep-alive while paused
   (the server ends a session it hears nothing from; the next segment then came back with an error status
   — which looked like a refused conversion).
3. The quality chosen at the start came from the Cloudflare quick check (nothing about the way to THIS
   server); build 56 fixed the mid-film rule but not the start.

### Changes
**Native (review carefully — no SDK here; type-checked with kotlinc 2.0 against Media3 1.5 stubs, and the
data source was run against a local HTTP server, 8 JUnit tests):**
- `RangeFetchDataSource.kt` (new): a Media3 DataSource that reads a Plex file as it is over several HTTP
  range requests at once (2 GB boxes 3 × 1 MiB in flight, others 4 × 2 MiB; a 512 KiB first piece so the
  first bytes come after one round trip), handed to the extractor in order as one stream. Keep-alive
  connections (the stream is closed, not disconnected, after each piece). Errors reported like the
  library's own source (InvalidResponseCodeException with the status, HttpDataSourceException otherwise),
  so the plugin's restart, RECONNECT_EXHAUSTED and "HTTP nnn" handling is unchanged. A 200 to a ranged
  request falls back to one stream from the start. Off-device benchmark with each connection capped at
  12 Mb/s: one connection 12.3 Mb/s (same as the plain source), four 49.3 Mb/s.
- `SnowPlayerPlugin.kt`: `load({ rangeFetch: true })` (films only) selects it for `/library/parts/` URLs
  (PlexAwareDataSource: conversion → transcode source; file + rangeFetch → range source; file → plex
  source; else normal). Same agent, timeouts and byte meter as the file source. `getStats` reports
  `fetchConnections` (Playback stats → Player → "Download: 4 connections").
- JUnit: `RangeFetchDataSourceTest.kt` (whole file in order over several connections, seek, bounded
  length, first bytes before the first piece completes, 416 at/past the end, 503, a server ignoring
  ranges, close mid-way, the plan).

**JS:**
- `PlexSection`: `rangeFetch` for a file played as it is when the route is not LAN (relay included).
- **Conversions, from the first request** (`plex.ts`, `PlexSection`):
  - `plexTranscodeUrl` names the client (X-Plex-Platform=Android, Product, Version, Device, Device-Name)
    on every start, plus `location=lan|wan`. The native User-Agent on `/transcode/universal/` is untouched
    (Android's own, as fixed at rung 3). Reasoning: build 39 changed only the agent and the server then had
    nothing but the agent to pick a conversion profile by; naming the platform in the request, as Plex for
    Android does, selects the Android profile outright. The plain unnamed start of builds 38-56
    (`identify: false`) is kept as the SECOND thing tried: a fresh session after an HTTP error, or a
    conversion the server accepted but never fed (30 s with nothing), flips named ⇄ plain once per title.
  - `startConversion`: the session playback leaves is stopped FIRST (`/stop`), then `/decision` for the
    new session (8 s), then the playlist with the same session id. Every conversion start goes through it
    (manual pick, automatic drop, fresh session, start-time choice).
  - Turned down at the decision: the next lighter conversion that has not failed on this title, else the
    file as it is (toast "The Plex server wouldn't convert this"), else (file can't play as it is) the
    message with the status and Retry. Never "Getting ready…" on a session that will not come.
  - Keep-alive: `/video/:/transcode/universal/ping` every 20 s while a conversion is paused.
  - `directAnyway` for the file now covers any automatic start conversion that never started (was relay only).
- **Start quality from the server, not Cloudflare** (`plexVersions.ts`, `PlexSection.playRatingKey`): on a
  direct (remote) route with the file's bitrate known and no measurement in the last 5 minutes, a read
  of the file over 3 connections (12 MB / 2.5 s; 4 MB on a low-memory box; the start waits 3 s at most)
  — what the parallel player will get. Below the file's own bitrate: start at the preset that fits
  (`fitPreset`, not under the floor) as automatic quality's own conversion ("Starting at 720p · 4 Mbps —
  the Plex server is delivering about X"); refused → the file as it is. Otherwise direct play, as always.
  `measurePlexSpeed` takes `connections`; `mergeMarks` adds the arrivals up.
- Build 56's starving/step-down checked: with the customer's numbers the drop to 720p · 4 Mbps comes on
  the second stall past the 30 s start grace (new wall-clock test). Fresh-session recovery kept, now
  flipping the identification; the recovery's "other quality" and the viewer's own pick share one path.
- i18n (en/es/fr/de/ar): toast startLowerTitle/Desc, stats download/connections.

### Tests
`plex.streamUrl.test.ts` (named vs plain, location, ping/decision share the session), `plexVersions.test.ts`
(parallel reads, merge, short file), `plexAutoQuality.starved.test.ts` (wall-clock customer case),
`PlexSection.autoQuality.test.tsx` (manual pick: stop → decision → playlist, one session; refusal chain
8 → 4 → 3 Mbps → file with toasts, no spinner; no-file title; ping only while a conversion is paused;
accepted-but-never-fed → plain flavour once → file; remote start measured short → 720p · 3 as auto's own;
measured short + refused → file over several connections; fast → direct over several connections, LAN
over one; nothing measured → one 3-way read per server), `useNativePlayer.resume.test.tsx` (rangeFetch with
every load/reload, never live; Kotlin pins for the factories and the source), stats panel/key tests.

### Not changed, still open
- Which address the Plex app uses (custom URL vs plex.direct, IPv4 vs IPv6): SMC still ranks plex.direct
  https IPv4 first. If the parallel read does not close the gap, ask the customer for the Plex app's
  server address (Plex app → Settings → the server → "Connection").
- A cloud-backed server may warm its cache for the Plex app after SMC played the same title first.
