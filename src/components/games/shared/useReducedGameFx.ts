import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'snow-games-reduced-fx-v1';

const systemPrefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const lowMemoryMode = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('native-low-memory');

/** Read the effective setting outside React (canvas/RAF code paths). */
export const isReducedGameFx = (): boolean => {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-game-fx') === 'reduced';
};

/**
 * Persisted Reduced FX preference, shared by the hub and every game.
 * The effective value is mirrored onto <html data-game-fx> so CSS and plain
 * JS animation code can consult the same switch.
 */
export const useReducedGameFx = () => {
  const [manual, setManual] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const [system, setSystem] = useState(systemPrefersReduced);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setSystem(query.matches);
    // Chrome 66-class TV WebViews only expose the deprecated addListener pair.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    const legacy = query as MediaQueryList & {
      addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(update);
    return () => legacy.removeListener?.(update);
  }, []);

  const reducedFx = manual || system || lowMemoryMode();

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-game-fx', reducedFx ? 'reduced' : 'full');
    return () => { root.removeAttribute('data-game-fx'); };
  }, [reducedFx]);

  const toggle = useCallback(() => {
    setManual((current) => {
      const next = !current;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  return { reducedFx, manualReducedFx: manual, toggleReducedFx: toggle };
};
