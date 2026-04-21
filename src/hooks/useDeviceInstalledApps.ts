import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppManager, type InstalledAppInfo } from '@/capacitor/AppManager';

// Normalise an app/display name so "Dreamstreams 3.0" ≈ "dreamstreams30"
const normaliseName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Bulk-loads every user-installed app on the Android device.
 * Returns an empty list on web (or when permission is denied).
 */
export const useDeviceInstalledApps = () => {
  const [installedApps, setInstalledApps] = useState<InstalledAppInfo[]>([]);
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());
  const [installedNameSet, setInstalledNameSet] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setInstalledApps([]);
      setInstalledSet(new Set());
      setInstalledNameSet(new Set());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { apps } = await AppManager.getInstalledApps();
      console.log(`[useDeviceInstalledApps] Found ${apps.length} user-installed apps on device`);
      setInstalledApps(apps);
      setInstalledSet(new Set(apps.map((a) => a.packageName.toLowerCase())));
      setInstalledNameSet(new Set(apps.map((a) => normaliseName(a.appName))));
    } catch (e) {
      console.error('[useDeviceInstalledApps] Failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to enumerate apps');
      setInstalledApps([]);
      setInstalledSet(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-scan when user returns from system installer/uninstaller
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [refresh]);

  const isPackageInstalled = useCallback(
    (packageName?: string | null) =>
      Boolean(packageName && installedSet.has(packageName.toLowerCase())),
    [installedSet]
  );

  return { installedApps, isPackageInstalled, loading, error, refresh };
};
