// When the viewer last jumped in the stream. A jump always empties the
// player's buffer, so the stall that follows is the seek, not the connection:
// automatic quality (plexAutoQuality) leaves those out. Every seek on the
// main player goes through useNativePlayer, which marks it here.
let lastSeek = 0;

export function markSeek(at: number = Date.now()): void { lastSeek = at; }
export function lastSeekAt(): number { return lastSeek; }
