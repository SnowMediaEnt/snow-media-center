// Moving about in a Plex film (a seek, ◀ ▶, the seek bar, Fast-forward and
// Rewind, Skip Intro), kept free of React so the rules can be tested on
// their own.
//
// A file played as it is: the player jumps in the file (a range request at
// the new place), once per burst of presses.
// A conversion: the server converts from where its session was started
// (`offset`, plexTranscodeUrl) and runs on ahead of the player. A jump back
// within the session, or forward within what the player has loaded (and a
// little past it), is a plain jump in the playlist; anything else is a NEW
// session started at the new place (the old one stopped first), as Plex's own
// players do, never a jump into a playlist the server has not produced yet.
// Once per burst too: quick presses add up, and the session starts once they
// stop.

/** Presses this close together are one burst: the jump goes out once they stop. */
export const SEEK_BURST_MS = 700;
/** A conversion's jump forward this far past what the player has loaded
 *  (the server runs a little ahead of the player) is still a plain jump. */
export const CONVERT_SEEK_SLACK_SEC = 10;
/** A session started this far in (or more) is checked for the server having
 *  ignored where it was asked to start (offsetTimeline). */
export const OFFSET_CHECK_MIN_SEC = 30;

const TRANSCODE_START = '/video/:/transcode/universal/start';

/**
 * Where a conversion's session starts, seconds into the title: its
 * `offset`. 0 for anything else (a file played as it is, a session from the
 * top). The stream's own time 0 is that place in the title.
 */
export function transcodeOffsetOf(url: string | null | undefined): number {
  if (!url || url.indexOf(TRANSCODE_START) < 0) return 0;
  const q = url.indexOf('?');
  if (q < 0) return 0;
  const m = /(?:^|&)offset=(\d+(?:\.\d+)?)(?:&|$)/.exec(url.slice(q + 1));
  const v = m ? Number(m[1]) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export type ConvertSeek = 'seek' | 'restart';

/**
 * A jump to `target` (seconds into the title) in a conversion whose session
 * started at `offset`, the player being at `position` (the stream's own
 * time) with `bufferedAhead` seconds loaded past it: 'seek' when the session
 * has (or is about to have) that place, else 'restart' — a new session there.
 */
export function convertSeekPlan(i: { target: number; offset: number; position: number; bufferedAhead: number }): ConvertSeek {
  const rel = i.target - i.offset;
  if (rel < 0) return 'restart';
  const at = Math.max(0, i.position);
  // Back within what this session has already converted.
  if (rel <= at) return 'seek';
  return rel <= at + Math.max(0, i.bufferedAhead) + CONVERT_SEEK_SLACK_SEC ? 'seek' : 'restart';
}

/**
 * Whether a conversion asked to start at `offset` came back on its own clock
 * ('stream': its length is what is left of the title, its time 0 the offset)
 * or on the title's ('title': the server ignored the offset and the stream
 * is the whole title from 0:00). `duration` is the stream's, as the player
 * reads it; `titleDuration` the title's own. 'unknown' when it can't be told.
 */
export function offsetTimeline(duration: number, offset: number, titleDuration: number | null | undefined): 'stream' | 'title' | 'unknown' {
  if (!(duration > 0) || !(offset >= OFFSET_CHECK_MIN_SEC) || !titleDuration || !(titleDuration > offset)) return 'unknown';
  return Math.abs(duration - (titleDuration - offset)) <= Math.abs(duration - titleDuration) ? 'stream' : 'title';
}

export interface SeekBurst {
  /** A jump to `target` (seconds into the title); replaces one not sent yet. */
  push: (target: number) => void;
  /** The jump waiting to go out, or null. */
  pending: () => number | null;
  /** Forget a jump not sent yet (the player closing, a new title). */
  clear: () => void;
}

/**
 * Jumps that come in quick succession (◀ ▶ pressed again and again, a held
 * key, a scrub) go out as one: `run` is called with the last target once
 * none has come for `quietMs`.
 */
export function createSeekBurst(run: (target: number) => unknown, quietMs: number = SEEK_BURST_MS): SeekBurst {
  let target: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    const to = target;
    target = null;
    if (to == null) return;
    try {
      void Promise.resolve(run(to)).catch(() => { /* a failed jump must not stop the next */ });
    } catch { /* ignore */ }
  };
  return {
    push(to: number) {
      if (!Number.isFinite(to)) return;
      target = Math.max(0, to);
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, quietMs);
    },
    pending: () => target,
    clear() {
      if (timer) clearTimeout(timer);
      timer = null;
      target = null;
    },
  };
}
