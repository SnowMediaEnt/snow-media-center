import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Play, Smartphone, Tv, Settings, Trash2, Pin, RefreshCw, Gauge } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAppData, AppData } from '@/hooks/useAppData';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { AppManager, isWebUnsupportedError, WEB_UNSUPPORTED_MSG } from '@/capacitor/AppManager';
import { generatePackageName } from '@/utils/downloadApk';
import DownloadProgress from '@/components/DownloadProgress';

import AppContextMenu from '@/components/AppContextMenu';
import AppAlertDialog from '@/components/AppAlertDialog';
import SpeedTest from '@/components/SpeedTest';
import { usePinnedApps } from '@/hooks/usePinnedApps';
import { useAppAlerts, type AppAlert } from '@/hooks/useAppAlerts';
import { useDeviceInstalledApps } from '@/hooks/useDeviceInstalledApps';

interface InstallAppsProps {
  onBack: () => void;
}

const InstallApps = ({ onBack }: InstallAppsProps) => {
  const { toast } = useToast();
  const { apps, loading, error } = useAppData();

  // Early returns MUST happen before any other hooks
  if (loading) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-ice mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading apps...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="tv-scroll-container tv-safe flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">Error loading apps: {error}</p>
          <Button onClick={onBack} variant="gold" className="">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  return <InstallAppsContent onBack={onBack} apps={apps} />;
};

// Focus types for navigation
type FocusType = 
  | 'back' | 'speedtest' | 'refresh' | 'clearAll'
  | 'tab-0' | 'tab-1'
  | `app-${string}` 
  | `pin-${string}`
  | `download-${string}` 
  | `launch-${string}` 
  | `settings-${string}` 
  | `cache-${string}` 
  | `uninstall-${string}`
  | `pinned-${string}`;

interface ContextMenuState {
  app: AppData | null;
  position: { x: number; y: number };
}

const InstallAppsContent = ({ onBack, apps }: { onBack: () => void; apps: AppData[] }) => {
  const [appStatuses, setAppStatuses] = useState<Map<string, { installed: boolean }>>(new Map());
  const [focusedElement, setFocusedElement] = useState<FocusType>('back');
  const [activeTab, setActiveTab] = useState<string>('featured');
  const [downloadingApp, setDownloadingApp] = useState<AppData | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ app: null, position: { x: 0, y: 0 } });
  const { toast } = useToast();
  const focusedRef = useRef<HTMLElement>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clearAllCancelRef = useRef<boolean>(false);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  
  // Pinned apps hook
  const { pinnedApps, isPinned, pinApp, unpinApp, canPinMore } = usePinnedApps();

  // Bulk lookup of every user-installed app on the device
  const { isPackageInstalled, isAppNameInstalled, resolvePackageName, refresh: refreshDeviceApps, installedApps: deviceApps } =
    useDeviceInstalledApps();

  // App alerts (warning popups)
  const { getAlertForApp } = useAppAlerts();
  const [pendingAlert, setPendingAlert] = useState<{ alert: AppAlert; app: AppData } | null>(null);
  const [pendingDownloadApp, setPendingDownloadApp] = useState<AppData | null>(null);

  // Helper function to get the apps for a tab.
  // 'featured' = curated featured list (sorted A→Z)
  // 'all'      = every available app, alphabetical
  const getCategoryApps = useCallback((tab: string) => {
    const sorted = [...apps].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    return tab === 'featured' ? sorted.filter(app => app.featured) : sorted;
  }, [apps]);

  // Get action buttons for an app based on install status
  const getAppButtons = useCallback((app: AppData): string[] => {
    const status = appStatuses.get(app.id);
    if (status?.installed) {
      return [`launch-${app.id}`, `settings-${app.id}`, `cache-${app.id}`, `uninstall-${app.id}`];
    }
    return [`download-${app.id}`];
  }, [appStatuses]);

  // Helpers to extract the app id out of a focus token like "launch-<id>".
  const getAppIdFromFocus = (focus: string): string | null => {
    const prefixes = ['app-', 'pin-', 'download-', 'launch-', 'settings-', 'cache-', 'uninstall-'];
    for (const p of prefixes) {
      if (focus.startsWith(p)) return focus.slice(p.length);
    }
    return null;
  };

  // TV Remote Navigation with button-level focus
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // If a modal/dialog is open (alert popup, context menu, download progress),
      // let the dialog handle keys natively. Don't move background focus.
      if (pendingAlert || contextMenu.app || downloadingApp) {
        if (event.key === 'Escape' || event.key === 'Backspace') {
          event.preventDefault();
          event.stopPropagation();
          if (pendingAlert) setPendingAlert(null);
          else if (contextMenu.app) setContextMenu({ app: null, position: { x: 0, y: 0 } });
        }
        return;
      }

      // Handle Android back button and other back buttons
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        // If a Clear-All run is in progress, Back cancels it instead of leaving the page.
        if (isClearingAll) {
          clearAllCancelRef.current = true;
          toast({ title: 'Stopping Clear All…', description: 'Will exit after the current app.' });
          return;
        }
        onBack();
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      const categoryApps = getCategoryApps(activeTab);
      const currentAppId = getAppIdFromFocus(focusedElement);
      const currentAppIdx = currentAppId
        ? categoryApps.findIndex((a) => a.id === currentAppId)
        : -1;
      const currentApp = currentAppIdx >= 0 ? categoryApps[currentAppIdx] : null;
      const buttons = currentApp ? getAppButtons(currentApp) : [];
      const isInstalled = !!currentApp && appStatuses.get(currentApp.id)?.installed;

      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'speedtest') setFocusedElement('back');
          else if (focusedElement === 'refresh') setFocusedElement('speedtest');
          else if (focusedElement === 'clearAll') setFocusedElement('refresh');
          else if (focusedElement === 'tab-1') setFocusedElement('tab-0');
          else if (focusedElement === 'tab-0') setFocusedElement('back');
          else if (currentApp && isInstalled) {
            // Within action row: settings ← cache ← uninstall
            if (focusedElement === `cache-${currentApp.id}`) {
              setFocusedElement(`settings-${currentApp.id}` as FocusType);
            } else if (focusedElement === `uninstall-${currentApp.id}`) {
              setFocusedElement(`cache-${currentApp.id}` as FocusType);
            } else if (focusedElement === `settings-${currentApp.id}` || focusedElement === `launch-${currentApp.id}`) {
              setFocusedElement(`app-${currentApp.id}` as FocusType);
            } else if (focusedElement === `pin-${currentApp.id}`) {
              setFocusedElement(`app-${currentApp.id}` as FocusType);
            }
          } else if (currentApp) {
            setFocusedElement(`app-${currentApp.id}` as FocusType);
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'back') setFocusedElement('speedtest');
          else if (focusedElement === 'speedtest') setFocusedElement('refresh');
          else if (focusedElement === 'refresh') setFocusedElement('clearAll');
          else if (focusedElement === 'tab-0') setFocusedElement('tab-1');
          else if (currentApp) {
            if (focusedElement === `app-${currentApp.id}`) {
              // App card → Pin button (top-right of card)
              setFocusedElement(`pin-${currentApp.id}` as FocusType);
            } else if (focusedElement === `pin-${currentApp.id}`) {
              // No-op (already at right edge of header row)
            } else if (isInstalled) {
              // Within action row: settings → cache → uninstall
              if (focusedElement === `settings-${currentApp.id}`) {
                setFocusedElement(`cache-${currentApp.id}` as FocusType);
              } else if (focusedElement === `cache-${currentApp.id}`) {
                setFocusedElement(`uninstall-${currentApp.id}` as FocusType);
              }
            }
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement === 'back' || focusedElement === 'speedtest' || focusedElement === 'refresh' || focusedElement === 'clearAll') {
            // Stay
          } else if (focusedElement.startsWith('tab-')) {
            setFocusedElement('back');
          } else if (focusedElement.startsWith('pin-') && currentApp) {
            // From pin go up to previous card or tabs
            if (currentAppIdx > 0) {
              setFocusedElement(`app-${categoryApps[currentAppIdx - 1].id}` as FocusType);
            } else {
              setFocusedElement('tab-0');
            }
          } else if (currentApp && isInstalled) {
            // From action row, go to launch; from launch go to app card; from app card go to pin (above)
            if (focusedElement === `settings-${currentApp.id}` ||
                focusedElement === `cache-${currentApp.id}` ||
                focusedElement === `uninstall-${currentApp.id}`) {
              setFocusedElement(`launch-${currentApp.id}` as FocusType);
            } else if (focusedElement === `launch-${currentApp.id}`) {
              setFocusedElement(`app-${currentApp.id}` as FocusType);
            } else if (focusedElement === `app-${currentApp.id}`) {
              if (currentAppIdx > 0) {
                setFocusedElement(`app-${categoryApps[currentAppIdx - 1].id}` as FocusType);
              } else {
                setFocusedElement('tab-0');
              }
            }
          } else if (currentApp) {
            // Not installed: just card ↔ download
            if (focusedElement === `download-${currentApp.id}`) {
              setFocusedElement(`app-${currentApp.id}` as FocusType);
            } else if (focusedElement === `app-${currentApp.id}`) {
              if (currentAppIdx > 0) {
                setFocusedElement(`app-${categoryApps[currentAppIdx - 1].id}` as FocusType);
              } else {
                setFocusedElement('tab-0');
              }
            }
          }
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back' || focusedElement === 'refresh' || focusedElement === 'clearAll') {
            setFocusedElement('tab-0');
          } else if (focusedElement.startsWith('tab-')) {
            if (categoryApps.length > 0) {
              setFocusedElement(`app-${categoryApps[0].id}` as FocusType);
            }
          } else if (currentApp) {
            // Default behavior: ArrowDown moves between APP CARDS, never enters
            // the action row. To open Launch / Clear Cache / Uninstall, the
            // user explicitly presses Enter on the card (or uses long-press
            // for the context menu). This matches the user's request:
            // "if we press down to go through the apps it should go through
            // each one until a container is selected".
            if (focusedElement === `pin-${currentApp.id}`) {
              // From the pin star, drop straight to next app card
              if (currentAppIdx + 1 < categoryApps.length) {
                setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
              }
            } else if (focusedElement === `app-${currentApp.id}`) {
              if (currentAppIdx + 1 < categoryApps.length) {
                setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
              }
            } else if (isInstalled) {
              // User is *already inside* the action row (entered via Enter on card).
              // launch → settings (first of bottom row), bottom row → next app
              if (focusedElement === `launch-${currentApp.id}`) {
                setFocusedElement(`settings-${currentApp.id}` as FocusType);
              } else if (currentAppIdx + 1 < categoryApps.length) {
                setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
              }
            } else if (focusedElement === `download-${currentApp.id}`) {
              if (currentAppIdx + 1 < categoryApps.length) {
                setFocusedElement(`app-${categoryApps[currentAppIdx + 1].id}` as FocusType);
              }
            }
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') {
            onBack();
          } else if (focusedElement === 'refresh') {
            (async () => {
              await refreshDeviceApps();
              refreshAllStatuses();
              toast({ title: 'Refreshing…', description: 'Re-scanning installed apps.' });
            })();
          } else if (focusedElement === 'clearAll') {
            handleClearAllCaches();
          } else if (focusedElement === 'tab-0') {
            setActiveTab('featured');
          } else if (focusedElement === 'tab-1') {
            setActiveTab('all');
          } else if (focusedElement.startsWith('pin-') && currentApp) {
            if (isPinned(currentApp.id)) {
              handleUnpinApp(currentApp.id, currentApp.name);
            } else {
              handlePinApp(currentApp);
            }
          } else if (focusedElement.startsWith('download-') && currentApp) {
            handleDownload(currentApp);
          } else if (focusedElement.startsWith('launch-') && currentApp) {
            attemptLaunch(currentApp);
          } else if (focusedElement.startsWith('settings-') && currentApp) {
            // "Clear Data" button → open App Info (data clearing requires manual tap, by design)
            toast({
              title: "Tap 'Storage' → 'Clear data'",
              description: `Opening ${currentApp.name} system info…`,
            });
            handleOpenAppSettings(currentApp);
          } else if (focusedElement.startsWith('cache-') && currentApp) {
            // "Clear Cache" button → open App Info so the user can clear it manually.
            handleAutoClearCache(currentApp);
          } else if (focusedElement.startsWith('uninstall-') && currentApp) {
            handleUninstall(currentApp);
          } else if (focusedElement.startsWith('app-') && currentApp) {
            // Pressing Enter on the app CARD now "enters" the container so the
            // user can choose between Launch / Clear Cache / Uninstall via the
            // D-pad. Pressing Enter again on Launch actually launches the app.
            // (If the app isn't installed yet, there's only one action — Download —
            // so trigger it directly.)
            if (isInstalled) {
              setFocusedElement(`launch-${currentApp.id}` as FocusType);
            } else {
              handleDownload(currentApp);
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onBack, apps, getCategoryApps, getAppButtons, appStatuses, isPinned, refreshDeviceApps, pendingAlert, contextMenu.app, downloadingApp, isClearingAll, toast]);

  // Scroll focused element into view
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  }, [focusedElement]);

  // App status management functions
  const generateAppPackageName = (app: AppData) => app.packageName || generatePackageName(app.name);

  const checkInstallStatus = useCallback(async (app: AppData): Promise<boolean> => {
    try {
      const packageName = generateAppPackageName(app);
      // 1) Bulk-scan by package name (works when DB has real package_name).
      if (isPackageInstalled(packageName)) return true;
      // 2) Bulk-scan by display name — covers every app in the catalog,
      //    even ones without a known package_name in the database.
      if (isAppNameInstalled(app.name)) return true;
      // 3) Per-package fallback (covers devices where QUERY_ALL_PACKAGES is blocked).
      if (Capacitor.isNativePlatform()) {
        const { installed } = await AppManager.isInstalled({ packageName });
        return installed;
      }
      return false;
    } catch (error) {
      console.error('Error checking install status:', error);
      return false;
    }
  }, [isPackageInstalled, isAppNameInstalled]);

  const ensureStatus = useCallback(async (app: AppData): Promise<{ installed: boolean }> => {
    try {
      const installed = await checkInstallStatus(app);
      setAppStatuses(prev => new Map(prev.set(app.id, { installed })));
      return { installed };
    } catch (error) {
      console.error('Error checking app status:', error);
      return { installed: false };
    }
  }, [checkInstallStatus]);

  const startDownload = useCallback((app: AppData) => {
    if (Capacitor.isNativePlatform()) {
      setDownloadingApp(app);
    } else {
      let url = app.downloadUrl!;
      if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
      window.open(url, '_blank');
      toast({ title: "Download Started", description: `${app.name} download opened in browser.` });
    }
  }, [toast]);

  const handleDownload = useCallback(async (app: AppData) => {
    if (!app.downloadUrl) {
      toast({
        title: "Download Error",
        description: "No download URL available for this app",
        variant: "destructive",
      });
      return;
    }

    // If the app is already installed, switch the UI to Launch instead of
    // re-downloading. No popup — just update status and silently launch
    // (launch path itself will surface any active warning).
    if (Capacitor.isNativePlatform()) {
      const alreadyInstalled = await checkInstallStatus(app);
      if (alreadyInstalled) {
        setAppStatuses(prev => new Map(prev.set(app.id, { installed: true })));
        const alert = getAlertForApp(app.name);
        if (alert) {
          setPendingAlert({ alert, app });
        } else {
          handleLaunch(app);
        }
        return;
      }
    }

    // Warnings only fire on launch — go straight to download here.
    startDownload(app);
  }, [toast, checkInstallStatus, getAlertForApp, startDownload]);
  useEffect(() => {
    if (apps.length > 0) {
      apps.forEach(app => {
        ensureStatus(app);
      });
    }
  }, [apps, ensureStatus]);

  // Re-check all app statuses (useful after returning from external actions)
  const refreshAllStatuses = useCallback(() => {
    apps.forEach(app => ensureStatus(app));
  }, [apps, ensureStatus]);

  // Debounced refresh: when the user comes back from Android Settings or
  // toggles visibility quickly, we don't want to re-scan every catalog app on
  // every event — that produced visible hitches right after navigation.
  useEffect(() => {
    let timer: number | undefined;
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        refreshAllStatuses();
      }, 600);
    };
    const handleFocus = () => scheduleRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (timer) window.clearTimeout(timer);
    };
  }, [refreshAllStatuses]);

  const handleLaunch = async (app: AppData) => {
    try {
      const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
      console.log(`[Launch] ${app.name} → ${packageName}`);
      await AppManager.launch({ packageName });
      
      toast({
        title: "Launching App",
        description: `Opening ${app.name}...`,
      });
    } catch (error) {
      console.error('Launch error:', error);
      const friendly = isWebUnsupportedError(error)
        ? WEB_UNSUPPORTED_MSG
        : `Could not launch ${app.name}. Make sure it's installed.`;
      toast({
        title: "Launch Failed",
        description: friendly,
        variant: "destructive",
      });
    }
  };

  // Wrapper used by all UI launch entry points: shows the alert popup first if one exists.
  const attemptLaunch = useCallback((app: AppData) => {
    const alert = getAlertForApp(app.name);
    if (alert) {
      setPendingAlert({ alert, app });
      return;
    }
    handleLaunch(app);
  }, [getAlertForApp, resolvePackageName]);

  const handleUninstall = async (app: AppData) => {
    try {
      const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
      console.log(`[Uninstall Settings] ${app.name} → ${packageName}`);
      // Verify the package is actually installed first — otherwise some Android
      // versions open SMC's own App Info page instead of the target.
      const { installed } = await AppManager.isInstalled({ packageName });
      if (!installed) {
        toast({
          title: "App not installed",
          description: `${app.name} is not installed on this device, so there's nothing to uninstall.`,
          variant: "destructive",
        });
        return;
      }
      await AppManager.openAppSettings({ packageName });

      toast({
        title: "Tap 'Uninstall'",
        description: `Opening ${app.name} App Info — tap Uninstall there.`,
      });
    } catch (error) {
      console.error('Uninstall error:', error);
      const msg = error instanceof Error ? error.message : '';
      const friendly = isWebUnsupportedError(error)
        ? WEB_UNSUPPORTED_MSG
        : msg.includes('Package not installed')
          ? `${app.name} is not installed on this device.`
          : `Could not open ${app.name} App Info.`;
      toast({
        title: "Uninstall Menu Failed",
        description: friendly,
        variant: "destructive",
      });
    }
  };

  const handleOpenAppSettings = async (app: AppData) => {
    try {
      const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
      console.log(`[Settings] ${app.name} → ${packageName}`);
      await AppManager.openAppSettings({ packageName });

      toast({
        title: "Opening App Settings",
        description: `${app.name} settings opened`,
      });
    } catch (error) {
      console.error('App settings error:', error);
      const friendly = isWebUnsupportedError(error)
        ? WEB_UNSUPPORTED_MSG
        : `Could not open ${app.name} settings.`;
      toast({
        title: "Settings Failed",
        description: friendly,
        variant: "destructive",
      });
    }
  };

  /** Opens App Info so the user can manually clear this app's cache. */
  const handleAutoClearCache = useCallback(async (app: AppData) => {
    if (!Capacitor.isNativePlatform()) {
      toast({ title: WEB_UNSUPPORTED_MSG, variant: 'destructive' });
      return;
    }
    const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
    try {
      const { installed } = await AppManager.isInstalled({ packageName });
      if (!installed) {
        toast({
          title: "App not installed",
          description: `${app.name} isn't installed, so there's no cache to clear.`,
          variant: "destructive",
        });
        return;
      }
      await AppManager.openAppSettings({ packageName });
      toast({
        title: "Tap 'Storage' → 'Clear cache'",
        description: `Opening ${app.name} system info…`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast({
        title: 'Clear Cache Menu Failed',
        description: isWebUnsupportedError(err)
          ? WEB_UNSUPPORTED_MSG
          : msg.includes('Package not installed')
            ? `${app.name} is not installed on this device.`
            : `Could not open ${app.name} App Info.`,
        variant: 'destructive',
      });
    }
  }, [resolvePackageName, toast]);

  /** Walks every installed app from our catalog and auto-clears each one's cache. */
  const handleClearAllCaches = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      toast({ title: WEB_UNSUPPORTED_MSG, variant: 'destructive' });
      return;
    }
    // Guard against accidental re-entry (e.g. clicking twice or D-pad spam).
    // This is the bug that caused Settings to pop open over and over.
    if (isClearingAll) {
      toast({
        title: 'Already clearing…',
        description: 'A Clear-All run is already in progress.',
      });
      return;
    }
    const installed = apps.filter(a => appStatuses.get(a.id)?.installed);
    if (installed.length === 0) {
      toast({ title: 'No installed apps to clean.' });
      return;
    }
    // Amazon Fire TV / Firestick doesn't expose our Accessibility Service
    // (Fire OS strips it). Fall back to opening App Info one-by-one so users
    // can still clear cache manually.
    const ua = (navigator.userAgent || '').toLowerCase();
    const isFireOS = /\b(aft[a-z0-9]+|firetv|fire tv|kf[a-z]{2,4}|amazon)\b/.test(ua);

    // Hard-require Accessibility BEFORE we touch system Settings even once.
    let accessibilityOk = false;
    try {
      const { enabled } = await AppManager.isAccessibilityEnabled();
      accessibilityOk = enabled;
    } catch {
      accessibilityOk = false;
    }

    if (!accessibilityOk) {
      if (isFireOS) {
        toast({
          title: 'Fire TV: manual clear required',
          description: `Auto-clear isn't available on Fire OS. Opening App Info for each app — tap Storage → Clear cache, then Back.`,
        });
        for (const app of installed) {
          const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
          try {
            await AppManager.openAppSettings({ packageName });
          } catch {/* skip */}
          await new Promise(r => setTimeout(r, 1500));
        }
        return;
      }
      toast({
        title: 'Enable Cache Cleaner first',
        description: 'Turn on "Snow Media Cache Cleaner" in Accessibility, then try again.',
      });
      try { await AppManager.openAccessibilitySettings(); } catch {/* */}
      return;
    }

    // Final confirmation so a stray click can't kick off a 6-second-per-app loop.
    const ok = window.confirm(
      `Auto-clear cache for ${installed.length} installed app${installed.length === 1 ? '' : 's'}?\n\n` +
      `Each app will briefly flash by in Settings (~6s each). Don't touch the remote until it finishes.`
    );
    if (!ok) return;

    setIsClearingAll(true);
    clearAllCancelRef.current = false;

    // Also wipe our own cache while we're at it
    try {
      const { freedBytes } = await AppManager.clearOwnCache();
      if (freedBytes > 0) {
        toast({
          title: 'Snow Media cache cleared',
          description: `Freed ${(freedBytes / (1024 * 1024)).toFixed(1)} MB from this app.`,
        });
      }
    } catch {/* non-fatal */}

    toast({
      title: `Cleaning ${installed.length} app${installed.length === 1 ? '' : 's'}…`,
      description: 'Each app will flash by in Settings. Press Back/Esc to stop.',
    });

    let processed = 0;
    let failures = 0;
    for (let i = 0; i < installed.length; i++) {
      if (clearAllCancelRef.current) {
        toast({ title: 'Clear All cancelled', description: `Stopped after ${processed} app(s).` });
        break;
      }
      const app = installed[i];
      const packageName = resolvePackageName(app.name, app.packageName) || generateAppPackageName(app);
      try {
        await AppManager.clearAppCache({ packageName });
        processed++;
      } catch (e) {
        console.warn(`[ClearAll] ${app.name} failed`, e);
        failures++;
        // Bail out if the service stopped responding — otherwise we'd keep
        // re-opening Settings forever.
        if (failures >= 3) {
          toast({
            title: 'Stopping Clear All',
            description: 'The Cache Cleaner service is not responding. Re-enable it in Accessibility settings.',
            variant: 'destructive',
          });
          break;
        }
      }
      // Wait ~6s between apps to let the service complete its taps + back-out
      await new Promise(r => setTimeout(r, 6000));
    }
    setIsClearingAll(false);
    clearAllCancelRef.current = false;
    if (processed > 0) {
      toast({ title: 'All caches cleared ✅', description: `Processed ${processed} app(s).` });
    }
  }, [apps, appStatuses, resolvePackageName, toast, isClearingAll]);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'streaming': return Tv;
      case 'support': return Settings;
      default: return Smartphone;
    }
  };

  // Long press handlers for pinning
  const handleLongPressStart = (app: AppData, event: React.TouchEvent | React.MouseEvent) => {
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    
    longPressTimerRef.current = setTimeout(() => {
      setContextMenu({
        app,
        position: { x: clientX, y: clientY }
      });
    }, 600); // 600ms for long press
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePinApp = (app: AppData) => {
    const success = pinApp({
      id: app.id,
      name: app.name,
      icon: app.icon,
      packageName: app.packageName
    });
    
    if (success) {
      toast({
        title: "App Pinned! 📌",
        description: `${app.name} added to your pinned apps.`,
      });
    } else {
      toast({
        title: "Cannot Pin App",
        description: "Maximum of 4 apps can be pinned.",
        variant: "destructive",
      });
    }
  };

  const handleUnpinApp = (appId: string, appName: string) => {
    unpinApp(appId);
    toast({
      title: "App Unpinned",
      description: `${appName} removed from pinned apps.`,
    });
  };

  const isFocused = (id: string) => focusedElement === id;
  const focusRing = (id: string) => isFocused(id) ? 'scale-110 ring-4 ring-brand-gold shadow-[0_0_30px_rgba(255,215,0,0.8),0_0_60px_rgba(161,213,220,0.4)] brightness-125 z-10' : '';

  const renderAppGrid = (categoryApps: AppData[]) => (
    <div className="space-y-6 pb-8">
      {categoryApps.map((app) => {
        const status = appStatuses.get(app.id) || { installed: false };
        const isInstalled = status.installed;
        const appFocused = isFocused(`app-${app.id}`);
        const appIsPinned = isPinned(app.id);
        
        return (
          <Card 
            key={app.id} 
            data-focus-id={`app-${app.id}`}
            onClick={() => isInstalled ? attemptLaunch(app) : handleDownload(app)}
            className={`bg-gradient-to-br from-slate-700/80 to-slate-800/80 border-slate-600 overflow-hidden transition-all duration-200 cursor-pointer ${appFocused ? 'ring-4 ring-brand-gold scale-[1.03] shadow-[0_0_30px_rgba(255,215,0,0.7),0_0_60px_rgba(161,213,220,0.35)] brightness-110 z-10' : ''} ${appIsPinned ? 'border-l-4 border-l-brand-gold' : ''}`}
            onTouchStart={(e) => handleLongPressStart(app, e)}
            onTouchEnd={handleLongPressEnd}
            onTouchCancel={handleLongPressEnd}
            onMouseDown={(e) => handleLongPressStart(app, e)}
            onMouseUp={handleLongPressEnd}
            onMouseLeave={handleLongPressEnd}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({
                app,
                position: { x: e.clientX, y: e.clientY }
              });
            }}
          >
            <div className="p-6">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-16 h-16 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                  <img 
                    src={app.icon || '/icons/default.png'} 
                    alt={`${app.name} icon`}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <h3 className="text-xl font-bold text-white">{app.name}</h3>
                    {appIsPinned && (
                      <Badge className="bg-brand-gold/20 text-brand-gold border border-brand-gold/30">📌 Pinned</Badge>
                    )}
                    {app.featured && (
                      <Badge className="bg-green-600 text-white">Featured</Badge>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mb-2 line-clamp-2">{app.description}</p>
                  <div className="flex gap-2 text-xs text-slate-500">
                    <span>{app.size}</span>
                  </div>
                </div>

                {/* Pin/Unpin Button */}
                <Button
                  data-focus-id={`pin-${app.id}`}
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (appIsPinned) {
                      handleUnpinApp(app.id, app.name);
                    } else {
                      handlePinApp(app);
                    }
                  }}
                  className={`flex-shrink-0 transition-all ${focusRing(`pin-${app.id}`)} ${
                    appIsPinned 
                      ? 'text-brand-gold hover:text-red-400 hover:bg-red-500/20' 
                      : 'text-slate-400 hover:text-brand-gold hover:bg-brand-gold/20'
                  }`}
                  title={appIsPinned ? 'Unpin app' : 'Pin app for quick access'}
                >
                  <Pin className={`w-5 h-5 ${appIsPinned ? 'fill-current' : ''}`} />
                </Button>
              </div>
              
              {/* Action Buttons - each individually focusable */}
              <div className="space-y-3">
                {!isInstalled && (
                  <Button 
                    data-focus-id={`download-${app.id}`}
                    onClick={() => handleDownload(app)}
                    className={`w-full transition-all duration-200 ${focusRing(`download-${app.id}`)} bg-brand-ice hover:bg-brand-ice/80 text-white`}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                )}
                
                {isInstalled && (
                  <>
                    <Button 
                      data-focus-id={`launch-${app.id}`}
                      onClick={() => attemptLaunch(app)}
                      className={`w-full transition-all duration-200 ${focusRing(`launch-${app.id}`)} bg-primary hover:bg-primary/80 text-primary-foreground`}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Launch
                    </Button>
                    
                    <div className="grid grid-cols-3 gap-2">
                      <Button 
                        data-focus-id={`settings-${app.id}`}
                        onClick={() => {
                          toast({
                            title: "Tap 'Storage' → 'Clear data'",
                            description: `Opening ${app.name} system info…`,
                          });
                          handleOpenAppSettings(app);
                        }}
                        variant="outline"
                        className={`transition-all duration-200 ${focusRing(`settings-${app.id}`)} bg-amber-600/20 border-amber-500/50 text-amber-300 hover:bg-amber-600/30`}
                        title="Opens system App Info – tap Storage → Clear data"
                      >
                        <Settings className="w-4 h-4 mr-1" />
                        Clear Data
                      </Button>

                      <Button 
                        data-focus-id={`cache-${app.id}`}
                        onClick={() => handleAutoClearCache(app)}
                        variant="outline"
                        className={`transition-all duration-200 ${focusRing(`cache-${app.id}`)} bg-blue-600/20 border-blue-500/50 text-blue-300 hover:bg-blue-600/30`}
                        title="Auto-taps Storage → Clear cache (no data loss). Requires Accessibility permission once."
                      >
                        <Settings className="w-4 h-4 mr-1" />
                        Clear Cache
                      </Button>

                      <Button 
                        data-focus-id={`uninstall-${app.id}`}
                        onClick={() => handleUninstall(app)}
                        variant="outline"
                        className={`transition-all duration-200 ${focusRing(`uninstall-${app.id}`)} bg-red-600/20 border-red-500/50 text-red-400 hover:bg-red-600/30`}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        Uninstall
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );

  return (
    <div className="tv-scroll-container tv-safe">
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center w-full justify-between">
          <Button 
            data-focus-id="back"
            onClick={onBack}
            variant="gold" 
            size="lg"
            className={`transition-all duration-200 ${focusRing('back')}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
            <Button
              data-focus-id="refresh"
              onClick={async () => {
                await refreshDeviceApps();
                refreshAllStatuses();
                toast({
                  title: 'Refreshing…',
                  description: `Re-scanning device. Found ${deviceApps.length} installed apps.`,
                });
              }}
              variant="outline"
              size="lg"
              className={`bg-blue-600/20 border-blue-500/50 text-blue-200 hover:bg-blue-600/30 transition-all duration-200 ${focusRing('refresh')}`}
              title="Re-check installed apps"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              Refresh
            </Button>
            <Button
              data-focus-id="clearAll"
              onClick={handleClearAllCaches}
              variant="outline"
              size="lg"
              disabled={isClearingAll}
              className={`bg-purple-600/20 border-purple-500/50 text-purple-200 hover:bg-purple-600/30 transition-all duration-200 ${focusRing('clearAll')} ${isClearingAll ? 'opacity-60 cursor-not-allowed' : ''}`}
              title="Auto-clear cache for every installed app (uses Accessibility Service)"
            >
              <Trash2 className="w-5 h-5 mr-2" />
              {isClearingAll ? 'Clearing…' : 'Clear All Caches'}
            </Button>
          </div>
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Main Apps</h1>
            <p className="text-xl text-blue-200">Download, Install & Launch APKs</p>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8 bg-slate-800/50 border-slate-600">
            <TabsTrigger 
              data-focus-id="tab-0"
              value="featured" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-0')}`}
            >
              Featured ({getCategoryApps('featured').length})
            </TabsTrigger>
            <TabsTrigger 
              data-focus-id="tab-1"
              value="all" 
              className={`text-white data-[state=active]:bg-brand-gold text-center transition-all duration-200 ${focusRing('tab-1')}`}
            >
              All ({getCategoryApps('all').length})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="featured" className="mt-0">
            {renderAppGrid(getCategoryApps('featured'))}
          </TabsContent>
          
          <TabsContent value="all" className="mt-0">
            {renderAppGrid(getCategoryApps('all'))}
          </TabsContent>
        </Tabs>
      </div>

      {/* Download Progress Modal */}
      {downloadingApp && (
        <DownloadProgress
          app={downloadingApp}
          onClose={() => setDownloadingApp(null)}
          onComplete={() => {
            // Refresh the app status after download/install
            ensureStatus(downloadingApp);
            setDownloadingApp(null);
          }}
        />
      )}

      {/* Context Menu for Pin/Unpin */}
      {contextMenu.app && (
        <AppContextMenu
          app={contextMenu.app}
          isPinned={isPinned(contextMenu.app.id)}
          canPinMore={canPinMore}
          position={contextMenu.position}
          onPin={() => handlePinApp(contextMenu.app!)}
          onUnpin={() => handleUnpinApp(contextMenu.app!.id, contextMenu.app!.name)}
          onClose={() => setContextMenu({ app: null, position: { x: 0, y: 0 } })}
        />
      )}

      {/* App Alert Popup (e.g. "Dreamstreams EPG is down") */}
      <AppAlertDialog
        alert={pendingAlert?.alert ?? null}
        appName={pendingAlert?.app.name}
        open={!!pendingAlert}
        onDismiss={() => { setPendingAlert(null); setPendingDownloadApp(null); }}
        onContinue={() => {
          const app = pendingAlert?.app;
          const isDownload = !!pendingDownloadApp;
          setPendingAlert(null);
          setPendingDownloadApp(null);
          if (app) {
            if (isDownload) startDownload(app);
            else handleLaunch(app);
          }
        }}
      />
    </div>
  );
};

export default InstallApps;