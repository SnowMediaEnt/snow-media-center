// The films and shows this viewer has watched on a line (src/lib/watchedMarks.ts),
// read once per change for a whole grid, not once per poster. Each section
// calls its hook once, so there is one listener per section.
//
// Tronix's useWatchedShows also counted the shows in Recently watched whose
// episode had a minute's resume position (both follow the account to other
// devices). SMC's Recently watched holds channels and Plex titles only, and
// it keeps no resume positions for the line's films and episodes, so here
// the marks are the box's own.
import { useEffect, useMemo, useState } from 'react';
import type { XtreamCreds } from '@/lib/xtream';
import { lineKey } from '@/lib/favoritesSync';
import { WATCHED_EVENT, initWatchedMarks, readWatchedFilms, readWatchedMarks, type ShowMark } from '@/lib/watchedMarks';

type Line = Pick<XtreamCreds, 'host' | 'username'>;

/** The line's entries of `all` (keyed `${lineKey}|${id}`), by numeric id. */
function onLine<T>(all: Record<string, T>, line: Line, keep: (v: T) => boolean): Map<number, T> {
  const out = new Map<number, T>();
  const prefix = `${lineKey(line)}|`;
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(prefix) || !v || !keep(v)) continue;
    const id = Number(k.slice(prefix.length));
    if (Number.isFinite(id)) out.set(id, v);
  }
  return out;
}

/** The shows begun on a line, by series id. */
export const watchedShowsOn = (line: Line): Map<number, ShowMark> => onLine(readWatchedMarks(), line, () => true);

/** The films watched to the end on a line (stream ids). */
export const watchedFilmsOn = (line: Line): Set<number> =>
  new Set(onLine(readWatchedFilms(), line, (m) => m.s === 2).keys());

/** A number that moves on every change to the marks (or of viewer). */
function useWatchedTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const changed = () => setTick((n) => n + 1);
    window.addEventListener(WATCHED_EVENT, changed);
    initWatchedMarks();
    return () => window.removeEventListener(WATCHED_EVENT, changed);
  }, []);
  return tick;
}

export function useWatchedShows(line: Line | null | undefined): Map<number, ShowMark> {
  const tick = useWatchedTick();
  const host = line?.host;
  const username = line?.username;
  return useMemo(
    () => (host && username ? watchedShowsOn({ host, username }) : new Map<number, ShowMark>()),
    // tick: a change to the marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host, username, tick],
  );
}

export function useWatchedFilms(line: Line | null | undefined): Set<number> {
  const tick = useWatchedTick();
  const host = line?.host;
  const username = line?.username;
  return useMemo(
    () => (host && username ? watchedFilmsOn({ host, username }) : new Set<number>()),
    // tick: a change to the marks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [host, username, tick],
  );
}
