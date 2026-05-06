import { useEffect, useState } from 'react';
import { robustFetch } from '@/utils/network';
import { isNativePlatform } from '@/utils/platform';

interface UpdateInfo {
  version: string;
  downloadUrl: string;
  changelog?: string;
  releaseDate?: string;
}

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
 * Lightweight global update checker. Polls update.json every 10 minutes
 * and exposes whether a newer version is available — used by the home
 * screen header to show a small triangle next to the version.
 */
export const useUpdateCheck = (currentVersion: string) => {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!currentVersion) return;
    let cancelled = false;

    const check = async () => {
      try {
        const isNative = isNativePlatform();
        const res = await robustFetch(
          `https://snowmediaapps.com/smc/update.json?ts=${Date.now()}`,
          {
            timeout: 12000,
            retries: 2,
            useCorsProxy: !isNative,
            headers: { Accept: 'application/json' },
          }
        );
        const text = await res.text();
        let data: UpdateInfo;
        try {
          const parsed = JSON.parse(text);
          data = parsed.contents ? JSON.parse(parsed.contents) : parsed;
        } catch {
          return;
        }
        if (cancelled || !data?.version) return;
        if (isVersionNewer(data.version, currentVersion)) {
          setUpdateAvailable(true);
          setLatestVersion(data.version);
        } else {
          setUpdateAvailable(false);
          setLatestVersion(data.version);
        }
      } catch (err) {
        // Silent — header indicator is best-effort
        console.log('[useUpdateCheck] check failed:', err);
      }
    };

    check();
    const id = setInterval(check, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [currentVersion]);

  return { updateAvailable, latestVersion };
};
