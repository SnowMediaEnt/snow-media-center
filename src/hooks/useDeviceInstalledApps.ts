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
  const [nameToPackage, setNameToPackage] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setInstalledApps([]);
      setInstalledSet(new Set());
      setInstalledNameSet(new Set());
      setNameToPackage(new Map());
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
      const map = new Map<string, string>();
      apps.forEach((a) => map.set(normaliseName(a.appName), a.packageName));
      setNameToPackage(map);
    } catch (e) {
      console.error('[useDeviceInstalledApps] Failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to enumerate apps');
      setInstalledApps([]);
      setInstalledSet(new Set());
      setInstalledNameSet(new Set());
      setNameToPackage(new Map());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
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

  /**
   * Match by display name — works for every app in the catalog,
   * not just the few we have hard-coded package names for.
   * Uses normalised compare + substring match so "Plex" finds "Plex for Android TV".
   */
  const isAppNameInstalled = useCallback(
    (appName?: string | null) => {
      if (!appName) return false;
      const target = normaliseName(appName);
      if (!target) return false;
      if (installedNameSet.has(target)) return true;
      for (const installedName of installedNameSet) {
        if (installedName.includes(target) || target.includes(installedName)) {
          return true;
        }
      }
      return false;
    },
    [installedNameSet]
  );

  /**
   * Resolve the REAL Android package name for one of our catalog apps,
   * either by trying the catalog package, or matching by display name.
   * This is what we must use for launch/uninstall/openAppSettings.
   */
  const resolvePackageName = useCallback(
    (appName?: string | null, fallbackPackage?: string | null): string | null => {
      if (fallbackPackage && installedSet.has(fallbackPackage.toLowerCase())) {
        return fallbackPackage;
      }
      if (appName) {
        const target = normaliseName(appName);
        if (target) {
          const exact = nameToPackage.get(target);
          if (exact) return exact;
          for (const [installedName, pkg] of nameToPackage.entries()) {
            if (installedName.includes(target) || target.includes(installedName)) {
              return pkg;
            }
          }
        }
      }
      return fallbackPackage || null;
    },
    [installedSet, nameToPackage]
  );

  return {
    installedApps,
    isPackageInstalled,
    isAppNameInstalled,
    resolvePackageName,
    loading,
    error,
    refresh,
  };
};
