import { useCallback, useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';

/** The viewer's player-engine choice for Live TV (owner test builds only —
 *  see PlaybackScreen). 'exo' is the only choice a customer build ever
 *  offers; 'mpv' simply never gets used if it isn't available. Per box, like
 *  useScreenFormat. */
export type PlayerEngine = 'exo' | 'mpv';

export const PLAYER_ENGINE_KEY = 'smc-player-engine-v1';

/** So other mounted players (a preview box alongside the settings screen)
 *  pick the change up live, the same visit — Preferences alone is only read
 *  once per mount. */
export const PLAYER_ENGINE_CHANGED_EVENT = 'smc:player-engine-changed';

export function usePlayerEngine() {
  const [engine, setEngineState] = useState<PlayerEngine>('exo');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Preferences.get({ key: PLAYER_ENGINE_KEY })
      .then(({ value }) => {
        if (cancelled) return;
        if (value === 'exo' || value === 'mpv') setEngineState(value);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Another mount (or PlaybackScreen) changed it — apply live.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<PlayerEngine>).detail;
      if (next === 'exo' || next === 'mpv') setEngineState(next);
    };
    window.addEventListener(PLAYER_ENGINE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PLAYER_ENGINE_CHANGED_EVENT, onChanged);
  }, []);

  const setEngine = useCallback(async (next: PlayerEngine) => {
    setEngineState(next);
    try { await Preferences.set({ key: PLAYER_ENGINE_KEY, value: next }); } catch { /* ignore */ }
    try { window.dispatchEvent(new CustomEvent(PLAYER_ENGINE_CHANGED_EVENT, { detail: next })); } catch { /* ignore */ }
  }, []);

  return { engine, setEngine, loaded };
}
