// The Snow Originals list for Live TV › Snow Originals.
//
// Starts from the saved list at once (no spinner on a second visit), then asks
// the server once, at the next idle moment, only when that list is over a
// minute old. No realtime and no polling: nothing loads behind the viewer's
// back, and nothing at all while a video plays (`paused`). The demo shows the
// made-up list and never calls the server.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runWhenIdle } from '@/utils/idle';
import { isDemo } from '@/lib/demoMode';
import { keepIfSame } from '@/lib/keepIfSame';
import {
  FRESH_MS,
  fetchOriginals,
  loadCachedOriginals,
  saveCachedOriginals,
  toOriginals,
  type SnowOriginal,
  type SnowOriginalRow,
} from '@/lib/snowOriginals';
import { ORIGINALS_DEMO } from '@/data/originalsDemo';

export interface SnowOriginalsState {
  items: SnowOriginal[];
  loading: boolean;
  /** The server could not be reached; `items` is the last saved list. */
  offline: boolean;
  /** The server could not be reached and there is no saved list. */
  error: boolean;
  refresh: () => void;
}

const noop = () => undefined;

export function useSnowOriginals(paused = false): SnowOriginalsState {
  const [demo] = useState(isDemo);
  const [initial] = useState(() => (demo ? null : loadCachedOriginals()));
  const [rows, setRows] = useState<SnowOriginalRow[] | null>(initial?.rows ?? null);
  const [loading, setLoading] = useState(!demo && !initial);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState(false);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const aliveRef = useRef(true);
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false; }; }, []);
  // Asked once per visit: done when the saved list was fresh or the fetch has run.
  const doneRef = useRef(demo || (!!initial && Date.now() - initial.at < FRESH_MS));

  const load = useCallback(async () => {
    try {
      const fresh = await fetchOriginals();
      if (!aliveRef.current) return;
      saveCachedOriginals(fresh);
      // Same list back: same array, so the grid does not re-render.
      setRows((prev) => keepIfSame(prev, fresh));
      setOffline(false);
      setError(false);
    } catch {
      if (!aliveRef.current) return;
      if (rowsRef.current && rowsRef.current.length) setOffline(true);
      else setError(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (paused || doneRef.current) return;
    const cancel = runWhenIdle(() => { doneRef.current = true; void load(); }, 1000);
    return cancel;
  }, [paused, load]);

  const refresh = useCallback(() => {
    if (demo) return;
    setError(false);
    if (!rowsRef.current) setLoading(true);
    doneRef.current = true;
    void load();
  }, [demo, load]);

  const items = useMemo(() => (demo ? ORIGINALS_DEMO : toOriginals(rows ?? [])), [demo, rows]);

  if (demo) return { items, loading: false, offline: false, error: false, refresh: noop };
  return { items, loading, offline, error, refresh };
}
