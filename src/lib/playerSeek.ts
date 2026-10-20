// When the viewer last jumped in the stream. A jump always empties the
// player's buffer, so the stall that follows is the seek, not the connection:
// automatic quality (plexAutoQuality) and "Still buffering?" (Live TV's
// useBufferingHelp) leave those out. Seeks on the main player go through
// useNativePlayer, which marks them here; Live TV's rewind jumps (on-box
// buffer, catch-up within what is loaded) through useLiveRewind, which does too.
let lastSeek = 0;

export function markSeek(at: number = Date.now()): void { lastSeek = at; }
export function lastSeekAt(): number { return lastSeek; }

// When a film or episode last began to play: after a load (a start, a
// resume, a quality change, a reload) or after a seek, its first 'playing'.
// Automatic quality leaves the first half minute after it alone (the server
// is only getting going at that place in the file). useNativePlayer marks it.
let lastStart = 0;

export function markPlaybackStart(at: number = Date.now()): void { lastStart = at; }
export function lastPlaybackStartAt(): number { return lastStart; }
