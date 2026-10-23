// Multi-Screen and the line's live connections (owner, 2026-10-23: "if they
// dont have enough connections or that theyre being over used or they will
// be over using the live connections they are aware and they dont do it or
// else theyll buffer").
//
// Every screen is a stream on the line it came from, and a line plays only
// as many streams at once as its plan allows (the panel's user_info:
// max_connections, and active_cons in use right now, as Live TV Settings ›
// My Account shows them, "0 active / 2 allowed"). Counted per line: screens
// can come from different lines or services.
//
//   others  the panel's active count less our screens on the line when it
//           was asked (the other TVs, recordings, anything else on it)
//   total   others + our screens on the line now
//   mark    nothing under the limit, 'full' at it, 'over' past it
//
// The panel is asked gently: one read per line per LINE_POLL_MS at most,
// whatever happens (a failed read is not retried sooner, a second caller
// shares the read in flight), only while screens play and the app is in
// front. A provider bans an IP for a burst of player_api calls (Vibez,
// 2026-10-19), so nothing here ever loops on it. The same read Rewind makes
// (authenticate + parseLineUsage): direct first, then Snow Media's list proxy
// on an ISP block, an outside service only ever directly.
import { useCallback, useEffect, useState } from 'react';
import { authenticate, type XtreamCreds } from '@/lib/xtream';
import { parseLineUsage } from '@/lib/liveRewind';
import { lineKey } from '@/lib/favoritesSync';
import { isDemo } from '@/lib/demoMode';

/** At most one panel read per line this often (as Rewind's LINE_RECHECK_MS). */
export const LINE_POLL_MS = 60_000;
/** A line whose screens changed this recently is not read yet (the panel's count lags a moment). */
export const LINE_SETTLE_MS = 4_000;
/** The check before a screen is added never waits longer than this for the panel. */
export const LINE_ASK_TIMEOUT_MS = 3_000;
/** How often the poll looks whether a line is due (no request unless one is). */
const POLL_TICK_MS = 15_000;

export type LineMark = 'full' | 'over' | null;

/** What the panel said about a line, and how many of our screens played on it then. */
export interface LineReading {
  max: number;
  active: number;
  /** Our screens on the line when it was asked. */
  own: number;
  at: number;
}

/** The other devices' streams on the line, as of a reading (never below 0). */
export const othersOf = (reading: Pick<LineReading, 'active' | 'own'> | null | undefined): number =>
  (reading ? Math.max(0, reading.active - reading.own) : 0);

/** Streams on the line with `ownNow` of ours: the others as of the reading, plus ours. */
export const lineTotal = (reading: Pick<LineReading, 'active' | 'own'> | null | undefined, ownNow: number): number =>
  othersOf(reading) + ownNow;

/** The marker by a screen's name: nothing under the limit, F at it, O past it. No limit known (or 0, unlimited): nothing. */
export function lineMark(total: number, max: number | null | undefined): LineMark {
  if (max == null || !(max > 0)) return null;
  if (total > max) return 'over';
  if (total === max) return 'full';
  return null;
}

/** Adding one more screen on the line: would it go past the limit? */
export const addGoesOver = (total: number, max: number | null | undefined): boolean =>
  max != null && max > 0 && total > max;

// ---- the readings, kept for the run (a remount reuses them: "others" does not depend on our screens) ----
const readings = new Map<string, LineReading>();
const lastAsk = new Map<string, number>();
const inflight = new Map<string, Promise<LineReading | null>>();
const listeners = new Set<() => void>();
const notify = () => { listeners.forEach((l) => { try { l(); } catch { /* ignore */ } }); };

/** The latest reading for a line, or null. */
export const lineReading = (line: Pick<XtreamCreds, 'host' | 'username'>): LineReading | null => readings.get(lineKey(line)) ?? null;

/**
 * Ask the panel about a line, unless it was asked less than LINE_POLL_MS ago
 * (then the read in flight, if any). `own`: our screens on it right now.
 * Never throws; null when the panel did not say.
 */
function ask(line: XtreamCreds, own: number): Promise<LineReading | null> {
  const k = lineKey(line);
  const going = inflight.get(k);
  if (going) return going;
  if (isDemo() || Date.now() - (lastAsk.get(k) ?? 0) < LINE_POLL_MS) return Promise.resolve(null);
  lastAsk.set(k, Date.now());
  const p = (async () => {
    try {
      const usage = parseLineUsage(await authenticate(line));
      if (!usage) return null;
      const r: LineReading = { ...usage, own, at: Date.now() };
      readings.set(k, r);
      notify();
      return r;
    } catch {
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}

/**
 * A reading at most LINE_POLL_MS old, for the check before a screen is
 * added: the kept one, else the panel is asked (once a minute at most) and
 * waited for LINE_ASK_TIMEOUT_MS at most; a late answer is still kept. An
 * older reading is better than none (the other TVs rarely change that fast).
 */
export async function freshLineReading(line: XtreamCreds, own: number, timeoutMs = LINE_ASK_TIMEOUT_MS): Promise<LineReading | null> {
  const kept = lineReading(line);
  if (kept && Date.now() - kept.at < LINE_POLL_MS) return kept;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      ask(line, own),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    return r ?? lineReading(line);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The readings for the lines our screens play on, kept fresh while `on`
 * (screens playing): each line read when due (LINE_POLL_MS since the last
 * read, LINE_SETTLE_MS since its screens last changed), one at a time, never
 * while the app is in the background. `ownOf(key)`: our screens on that line
 * now; `changedAt(key)`: when they last changed.
 */
export function useLineReadings(
  lines: readonly XtreamCreds[],
  ownOf: (key: string) => number,
  changedAt: (key: string) => number,
  on: boolean,
): Record<string, LineReading> {
  const snapshot = useCallback(() => {
    const out: Record<string, LineReading> = {};
    readings.forEach((r, k) => { out[k] = r; });
    return out;
  }, []);
  const [state, setState] = useState<Record<string, LineReading>>(snapshot);
  useEffect(() => {
    const l = () => setState(snapshot());
    listeners.add(l);
    l();
    return () => { listeners.delete(l); };
  }, [snapshot]);

  const linesKey = lines.map(lineKey).join(',');
  useEffect(() => {
    if (!on || !lines.length || isDemo()) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      timer = 0;
      if (!alive) return;
      if (!document.hidden) {
        for (const line of lines) {
          const k = lineKey(line);
          const now = Date.now();
          if (now - (lastAsk.get(k) ?? 0) < LINE_POLL_MS || now - changedAt(k) < LINE_SETTLE_MS) continue;
          await ask(line, ownOf(k));
          if (!alive) return;
        }
      }
      timer = window.setTimeout(() => { void tick(); }, POLL_TICK_MS);
    };
    // The first look once the screens have settled (the add check has usually just asked).
    timer = window.setTimeout(() => { void tick(); }, LINE_SETTLE_MS);
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
    // `lines` is followed by its keys; ownOf / changedAt read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, linesKey]);

  return state;
}

/** Tests only. */
export function __resetLineReadingsForTests(): void {
  readings.clear();
  lastAsk.clear();
  inflight.clear();
  notify();
}
