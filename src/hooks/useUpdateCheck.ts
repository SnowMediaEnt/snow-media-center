import { useEffect, useState } from 'react';
import { useVersion } from './useVersion';

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

/**
 * Listens to the global `smc:update-info` window event dispatched by
 * AutoUpdatePrompt (the single update checker). No own polling. Treats an
 * update as available if EITHER the native versionCode is higher OR the
 * version name is newer — so apk-only bumps (same name, higher code) also
 * surface the "update available" triangle.
 */
export const useUpdateCheck = (currentVersion: string) => {
  const { versionCode } = useVersion();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVersion) return;

    const evaluate = (detail: { version?: string; versionCode?: number | null } | undefined) => {
      const v = detail?.version;
      if (!v) return;
      setLatestVersion(v);
      const codeNewer =
        detail?.versionCode != null && versionCode != null && versionCode > 0 &&
        (detail.versionCode as number) > versionCode;
      const nameNewer = isVersionNewer(v, currentVersion);
      setUpdateAvailable(codeNewer || nameNewer);
    };

    // Recover a missed event dispatched before this hook mounted.
    const cached = (window as any).__smcUpdateInfo;
    if (cached) evaluate(cached);

    const handler = (e: Event) => {
      evaluate((e as CustomEvent<{ version?: string; versionCode?: number | null }>).detail);
    };

    window.addEventListener('smc:update-info', handler as EventListener);
    return () => window.removeEventListener('smc:update-info', handler as EventListener);
  }, [currentVersion, versionCode]);

  return { updateAvailable, latestVersion };
};
