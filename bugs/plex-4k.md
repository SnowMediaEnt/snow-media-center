# Plex 4K has trouble (1.7.9)

## What's broken
After the 1.7.9 buffering fix, 1080p plays well but 4K titles "have trouble" (owner, first report).
Details still needed from the device: see below.

## How the owner reproduces it
Play a 4K title in Plex: it buffers immediately at the start, then automatic quality converts it down to
1080p ("Lowered to 1080p…"). The official Plex app plays the same 4K title direct (earlier photo from the
same box: HEVC direct play, avg 84 Mb/s, peaks 305 Mb/s from the server, ~18 s buffer ahead).
Stats-panel photo not yet provided.

## Context from the Plex buffering fix (closed at rung 3)
- 1.7.9 player: continuous top-up; main slot byte budget ~144 MB on normal boxes (4K at 60-80 Mb/s = only
  ~15-19 s ahead) and 128 MiB + 20 s floor on 2 GB boxes; pre-buffer hold targets 25 s (can't be reached for
  4K, so it ends on the "buffer full" rule or the 10 s/30 s caps).
- Auto quality won't move the original to a conversion on stalls alone when the internet check is >= 2x the
  file's bitrate. For 4K (60-80 Mb/s) that needs a 120-160 Mb/s quick check; below that it can still drop
  to a server conversion from 4K, which is slow to start on a shared server.
- Audio is decoded in software (FFmpeg) where the Plex app passes it through; video drawn via TextureView.

## Tried
(nothing yet)
