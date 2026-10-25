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

// When the viewer last MOVED a film's playback: a seek or a skip, playing on
// after a pause, or a start part-way into the film (Continue Watching, a
// resume point). Unlike a plain seek mark (a display mode switch is one too)
// it says the place changed under the viewer's own hand, and the server has
// to start again there: until playback picks up again, and for the half
// minute after, a stall is that jump, never the server being too slow for
// the stream (plexAutoQuality.afterJump). A jump is also a seek.
let lastJump = 0;

export function markJump(at: number = Date.now()): void { lastJump = at; lastSeek = at; }
export function lastJumpAt(): number { return lastJump; }
