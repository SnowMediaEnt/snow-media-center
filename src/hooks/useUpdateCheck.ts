import { useEffect, useState } from 'react';

/**
 * Listens to the global `smc:update-info` window event dispatched by
 * AutoUpdatePrompt (the single update checker). No own polling — keeps the
 * tiny "update available" triangle in the home header in sync without
 * adding a second timer / fetch.
 */
export const useUpdateCheck = (currentVersion: string) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVersion) return;

    const isVersionNewer = (a: string, b: string) => {
      const ap = a.split('.').map(Number);
      const bp = b.split('.').map(Number);
      for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
        const x = ap[i] || 0;
        const y = bp[i] || 0;
        if (x > y) return true;
        if (x < y) return false;
      }
      return false;
    };

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ version?: string }>).detail;
      const v = detail?.version;
      if (!v) return;
      setLatestVersion(v);
      setUpdateAvailable(isVersionNewer(v, currentVersion));
    };

    window.addEventListener('smc:update-info', handler as EventListener);
    return () => window.removeEventListener('smc:update-info', handler as EventListener);
  }, [currentVersion]);

  return { updateAvailable, latestVersion };
};
