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
