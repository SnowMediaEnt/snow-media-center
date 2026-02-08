import { useState, useEffect, useCallback } from 'react';

const PINNED_APPS_KEY = 'pinned-apps';
const PINNED_APPS_VERSION_KEY = 'pinned-apps-version';
const CURRENT_VERSION = 4; // Bumped: start with empty pinned apps - user adds their own
const MAX_PINNED_APPS = 7;

export interface PinnedApp {
  id: string;
  name: string;
  icon: string;
  packageName: string;
}

export const usePinnedApps = () => {
  const [pinnedApps, setPinnedApps] = useState<PinnedApp[]>([]);

  // Load pinned apps from localStorage on mount - start empty for fresh installs
  useEffect(() => {
    try {
      const storedVersion = localStorage.getItem(PINNED_APPS_VERSION_KEY);
      const isOutdated = !storedVersion || parseInt(storedVersion) < CURRENT_VERSION;
      
      if (isOutdated) {
        // Force reset to empty for new version
        console.log('[PinnedApps] Version updated, resetting to empty pinned apps');
        setPinnedApps([]);
        localStorage.setItem(PINNED_APPS_KEY, JSON.stringify([]));
        localStorage.setItem(PINNED_APPS_VERSION_KEY, CURRENT_VERSION.toString());
        return;
      }
      
      const stored = localStorage.getItem(PINNED_APPS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPinnedApps(parsed.slice(0, MAX_PINNED_APPS));
          return;
        }
      }
      // No stored apps - start with empty array (user pins their own)
      setPinnedApps([]);
      localStorage.setItem(PINNED_APPS_KEY, JSON.stringify([]));
      localStorage.setItem(PINNED_APPS_VERSION_KEY, CURRENT_VERSION.toString());
    } catch (error) {
      console.error('[PinnedApps] Error loading pinned apps:', error);
      setPinnedApps([]);
    }
  }, []);

  // Save to localStorage whenever pinned apps change
  const savePinnedApps = useCallback((apps: PinnedApp[]) => {
    try {
      localStorage.setItem(PINNED_APPS_KEY, JSON.stringify(apps));
    } catch (error) {
      console.error('[PinnedApps] Error saving pinned apps:', error);
    }
  }, []);

  const isPinned = useCallback((appId: string): boolean => {
    return pinnedApps.some(app => app.id === appId);
  }, [pinnedApps]);

  const pinApp = useCallback((app: PinnedApp): boolean => {
    if (pinnedApps.length >= MAX_PINNED_APPS) {
      return false; // Max limit reached
    }
    
    if (isPinned(app.id)) {
      return false; // Already pinned
    }

    const newPinnedApps = [...pinnedApps, app];
    setPinnedApps(newPinnedApps);
    savePinnedApps(newPinnedApps);
    return true;
  }, [pinnedApps, isPinned, savePinnedApps]);

  const unpinApp = useCallback((appId: string): boolean => {
    if (!isPinned(appId)) {
      return false; // Not pinned
    }

    const newPinnedApps = pinnedApps.filter(app => app.id !== appId);
    setPinnedApps(newPinnedApps);
    savePinnedApps(newPinnedApps);
    return true;
  }, [pinnedApps, isPinned, savePinnedApps]);

  const togglePin = useCallback((app: PinnedApp): { success: boolean; action: 'pinned' | 'unpinned' | 'limit_reached' } => {
    if (isPinned(app.id)) {
      unpinApp(app.id);
      return { success: true, action: 'unpinned' };
    } else {
      if (pinnedApps.length >= MAX_PINNED_APPS) {
        return { success: false, action: 'limit_reached' };
      }
      pinApp(app);
      return { success: true, action: 'pinned' };
    }
  }, [isPinned, pinApp, unpinApp, pinnedApps.length]);

  return {
    pinnedApps,
    isPinned,
    pinApp,
    unpinApp,
    togglePin,
    maxPinnedApps: MAX_PINNED_APPS,
    canPinMore: pinnedApps.length < MAX_PINNED_APPS,
  };
};
