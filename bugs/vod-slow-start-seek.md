# Live TV VOD is slow to start on ExoPlayer; seeking keeps buffering until OK

Tracker #32 · hard bug (playback) · starts at fixer-2

## Owner report
- Live TV VOD (the provider's movies, not Plex) now takes much longer to load, especially on ExoPlayer. "It was so quick and now so slow, if it even loads." About 30 seconds.
- MPV loads it "decently".
- Seeking: in the bar, they moved the position back to the beginning. Playback didn't restart; it kept buffering until they pressed OK to select the spot, then restarted and played fine. Seen on MPV; check ExoPlayer too.

## Suspects to check first
- The Plex buffering work (PreBufferRule film hold of 30 s / 45 s, SteadyLoadControl, FlooredLoadControl, `beginStream(film=true)`, the first-frame watchdog skipped for films) may now apply to Xtream VOD, which used to start fast.
- The rewind/recording hooks in SnowPlayerPlugin (tsReset and the like), and useNativePlayer `skipKeys` / `live:false` handling.
- Seek flow for VOD: the bar's scrub vs commit.

## Attempts
(none yet)
