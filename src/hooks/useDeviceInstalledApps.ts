import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AppManager, type InstalledAppInfo } from '@/capacitor/AppManager';
import { runWhenIdle } from '@/utils/idle';

// Normalise an app/display name so "Dreamstreams 3.0" ≈ "dreamstreams30"
const normaliseName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '');

const PACKAGE_ALIASES: Record<string, string[]> = {
  ipvanish: [
    'com.ixolit.ipvanish',
    'com.ixonn.ipvanish',
    'com.ixolus.ipvanish',
    'com.ipvanish.vpn',
    'com.ipvanish.android',
  ],
  surfshark: ['com.surfshark.vpnclient.android', 'com.surfshark.android.tv'],
};

// ─────────────────────────────────────────────────────────────────────────────
// Module-level shared cache. The native `getInstalledApps()` enumeration is
// expensive (~360ms on Android boxes) — Phase 6A makes it run ONCE per app
// session and broadcasts the result to every subscriber.
// ─────────────────────────────────────────────────────────────────────────────

interface Snapshot {
  installedApps: InstalledAppInfo[];
  installedSet: Set<string>;
  installedNameSet: Set<string>;
  nameToPackage: Map<string, string>;
  loading: boolean;
  error: string | null;
}

const EMPTY: Snapshot = {
  installedApps: [],
  installedSet: new Set(),
  installedNameSet: new Set(),
  nameToPackage: new Map(),
  loading: false,
  error: null,
};

let snapshot: Snapshot = EMPTY;
let inflight: Promise<void> | null = null;
let hasFetched = false;
let lastFetchAt = 0;
// Debounce manual refresh + (rare) visibility-driven refreshes.
const REFRESH_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

const listeners = new Set<(s: Snapshot) => void>();
const emit = () => { listeners.forEach((l) => l(snapshot)); };

const runFetch = async (force = false): Promise<void> => {
  if (!Capacitor.isNativePlatform()) {
    snapshot = { ...EMPTY };
    hasFetched = true;
    emit();
    return;
  }
  if (inflight) return inflight;
  if (!force && hasFetched && Date.now() - lastFetchAt < REFRESH_DEBOUNCE_MS) return;

  snapshot = { ...snapshot, loading: true, error: null };
  emit();

  inflight = (async () => {
    try {
      const { apps } = await AppManager.getInstalledApps();
      console.log(`[useDeviceInstalledApps] Found ${apps.length} installed apps (single shared fetch)`);
      const installedSet = new Set(apps.map((a) => a.packageName.toLowerCase()));
      const installedNameSet = new Set(apps.map((a) => normaliseName(a.appName)));
      const nameToPackage = new Map<string, string>();
      apps.forEach((a) => nameToPackage.set(normaliseName(a.appName), a.packageName));
      snapshot = {
        installedApps: apps,
        installedSet,
        installedNameSet,
        nameToPackage,
        loading: false,
        error: null,
      };
      hasFetched = true;
      lastFetchAt = Date.now();
    } catch (e) {
      console.error('[useDeviceInstalledApps] Failed:', e);
      snapshot = {
        ...EMPTY,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to enumerate apps',
      };
      hasFetched = true;
      lastFetchAt = Date.now();
    } finally {
      inflight = null;
      emit();
    }
  })();

  return inflight;
};

/**
 * Shared installed-apps source. The native enumeration runs once per session
 * (or when `refresh()` is called and the debounce window has elapsed); every
 * component mounts simply subscribes to the cached snapshot — no per-mount
 * native calls, no visibilitychange re-enumeration.
 */
export const useDeviceInstalledApps = () => {
  const [snap, setSnap] = useState<Snapshot>(snapshot);

  useEffect(() => {
    listeners.add(setSnap);
    // Make sure the snapshot is current for late subscribers.
    setSnap(snapshot);
    if (!hasFetched && !inflight) {
      // Phase 7: defer the native enumeration off the boot critical path.
      // Home cards must be focusable on first paint; the installed-app list
      // is only needed for the pinned-apps popup / app-launch resolver.
      runWhenIdle(() => {
        if (!hasFetched && !inflight) runFetch().catch(() => { /* swallowed */ });
      }, 800);
    }
    return () => { listeners.delete(setSnap); };
  }, []);

  const refresh = useCallback(async () => {
    // Manual refresh respects the same debounce — call with force only when
    // we really know the install set changed (post-install / post-uninstall).
    await runFetch(false);
  }, []);

  // Exposed so the pinned-apps popup can force a fetch the instant it opens
  // (the deferred boot fetch may not have fired yet on cold start).
  const ensureLoaded = useCallback(() => {
    if (!hasFetched && !inflight) runFetch().catch(() => { /* swallowed */ });
  }, []);

  const isPackageInstalled = useCallback(
    (packageName?: string | null) => {
      if (!packageName) return false;
      const pkg = packageName.toLowerCase();
      if (snap.installedSet.has(pkg)) return true;
      return Object.values(PACKAGE_ALIASES).some((aliases) =>
        aliases.includes(pkg) && aliases.some((alias) => snap.installedSet.has(alias.toLowerCase()))
      );
    },
    [snap.installedSet]
  );

  const isAppNameInstalled = useCallback(
    (appName?: string | null) => {
      if (!appName) return false;
      const target = normaliseName(appName);
      if (!target || target.length < 3) return false;
      if (snap.installedNameSet.has(target)) return true;
      for (const installedName of snap.installedNameSet) {
        if (!installedName || installedName.length < 3) continue;
        if (installedName.includes(target) || target.includes(installedName)) {
          return true;
        }
      }
      return false;
    },
    [snap.installedNameSet]
  );

  const resolvePackageName = useCallback(
    (appName?: string | null, fallbackPackage?: string | null): string | null => {
      const target = normaliseName(appName || '');
      const fallback = fallbackPackage?.toLowerCase() || '';
      const aliases =
        (target ? PACKAGE_ALIASES[target] : undefined) ||
        Object.values(PACKAGE_ALIASES).find((group) => group.includes(fallback));

      if (aliases) {
        for (const pkg of aliases) {
          if (snap.installedSet.has(pkg.toLowerCase())) return pkg;
        }
      }
      if (fallbackPackage && snap.installedSet.has(fallbackPackage.toLowerCase())) {
        return fallbackPackage;
      }
      if (appName && target && target.length >= 3) {
        const exact = snap.nameToPackage.get(target);
        if (exact) return exact;
        for (const [installedName, pkg] of snap.nameToPackage.entries()) {
          if (!installedName || installedName.length < 3) continue;
          if (installedName.includes(target) || target.includes(installedName)) {
            return pkg;
          }
        }
      }
      if (aliases?.length) return aliases.includes(fallback) ? aliases[0] : aliases[0];
      return fallbackPackage || null;
    },
    [snap.installedSet, snap.nameToPackage]
  );

  return {
    installedApps: snap.installedApps,
    isPackageInstalled,
    isAppNameInstalled,
    resolvePackageName,
    loading: snap.loading,
    error: snap.error,
    refresh,
  };
};
