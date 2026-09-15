import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'snow-games-reduced-fx-v1';

const systemPrefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const lowMemoryMode = () =>
  typeof document !== 'undefined' && document.documentElement.classList.contains('native-low-memory');

export const useReducedGameFx = () => {
  const [manual, setManual] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const [system, setSystem] = useState(systemPrefersReduced);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setSystem(query.matches);
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const toggle = useCallback(() => {
    setManual((current) => {
      const next = !current;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  return { reducedFx: manual || system || lowMemoryMode(), manualReducedFx: manual, toggleReducedFx: toggle };
};
