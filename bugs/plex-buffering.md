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
