// Rewind / Fast-forward from the remote, held down: the key repeats many
// times a second, and each step is an async player call (a seek, a rewind
// buffer jump, a catch-up reload). Steps that arrive while one is running are
// added up and sent as one, so none is lost and the player is never asked
// twice at once.

/** One press of Rewind / Fast-forward, in seconds. */
export const MEDIA_SKIP_SEC = 10;
/** The most one catch-up jump may cover (a long hold on a slow reload). */
const MAX_PENDING_SEC = 300;

export interface SkipQueue {
  /** Add a step (negative = back). */
  push: (deltaSec: number) => void;
  /** Forget steps not yet sent (a channel change, the player closing). */
  clear: () => void;
}

export function createSkipQueue(run: (deltaSec: number) => Promise<unknown> | unknown): SkipQueue {
  let pending = 0;
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    try {
      while (pending !== 0) {
        const d = pending;
        pending = 0;
        try { await run(d); } catch { /* one failed step must not stop the next */ }
      }
    } finally {
      busy = false;
    }
  };
  return {
    push(deltaSec: number) {
      if (!Number.isFinite(deltaSec) || deltaSec === 0) return;
      pending = Math.max(-MAX_PENDING_SEC, Math.min(MAX_PENDING_SEC, pending + deltaSec));
      void pump();
    },
    clear() { pending = 0; },
  };
}

/** Where a film is: seconds in, and its length (0 when unknown). */
export interface FilmPosition { position: number; duration: number }

/**
 * A jump made this recently is where the next one starts from: the player
 * may still report the spot it jumped from for a moment after a seek.
 */
const SEEK_SETTLE_MS = 2000;

/**
 * ◀ ▶ in a film (Live TV films, Plex): jumps relative to where it is, one
 * at a time, quick presses added up (a SkipQueue), each one from where the
 * last landed while the player catches up, so three quick ◀ are 30 s back,
 * never 10. Kept inside the film (0 .. its length − 1 s). `landed` hears
 * where each jump went.
 */
export function createSeekSkipper(
  getPosition: () => Promise<FilmPosition>,
  seekTo: (sec: number) => Promise<unknown> | unknown,
  landed?: (to: number, duration: number, deltaSec: number) => void,
  now: () => number = Date.now,
): SkipQueue {
  let last: { to: number; at: number; duration: number } | null = null;
  return createSkipQueue(async (delta) => {
    const from: FilmPosition = last && now() - last.at < SEEK_SETTLE_MS
      ? { position: last.to, duration: last.duration }
      : await getPosition();
    const max = from.duration > 0 ? Math.max(0, from.duration - 1) : Number.MAX_SAFE_INTEGER;
    const to = Math.min(max, Math.max(0, from.position + delta));
    last = { to, at: now(), duration: from.duration };
    await seekTo(to);
    last.at = now();
    landed?.(to, from.duration, delta);
  });
}
