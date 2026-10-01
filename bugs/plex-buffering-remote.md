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
