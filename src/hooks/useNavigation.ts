import { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';

interface NavigationState {
  currentView: string;
  navigationStack: string[];
}

interface NavigationOptions {
  onRootBack?: () => boolean;
}

interface LegacyExitWindow extends Window {
  Capacitor?: { Plugins?: { App?: { exitApp?: () => void } } };
  device?: { exitApp?: () => void };
  Android?: { exitApp?: () => void };
}

interface LegacyNavigator extends Navigator {
  app?: { exitApp?: () => void };
}

type CapacitorListenerHandle = { remove?: () => void };

// Consolidated app-exit. Try Capacitor's official exit first; then fall back
// through the legacy ladder — one of these rungs is the only exit that works
// on the DOM-delivered back path on some Fire TV / STB boxes.
const exitApp = () => {
  try {
    void CapApp.exitApp();
    return;
  } catch { /* fall through */ }
  try {
    const legacyWindow = window as LegacyExitWindow;
    const legacyNavigator = window.navigator as LegacyNavigator;
    if (legacyWindow.Capacitor) {
      legacyWindow.Capacitor.Plugins?.App?.exitApp?.();
    } else if (legacyWindow.device?.exitApp) {
      legacyWindow.device.exitApp();
    } else if (legacyNavigator.app?.exitApp) {
      legacyNavigator.app.exitApp();
    } else if (legacyWindow.Android?.exitApp) {
      legacyWindow.Android.exitApp();
    } else {
      window.close();
    }
  } catch (error) {
    console.log('Exit app failed:', error);
    try { window.location.href = 'about:blank'; }
    catch { alert('Press home button to exit'); }
  }
};

const DOUBLE_PRESS_MS = 2000;

export const useNavigation = (initialView: string = 'home', options: NavigationOptions = {}) => {
  const { onRootBack } = options;
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentView: initialView,
    navigationStack: [initialView]
  });

  const [backPressCount, setBackPressCount] = useState(0);
  const [lastBackPressTime, setLastBackPressTime] = useState(0);

  const navigateTo = useCallback((view: string) => {
    setNavigationState(prev => {
      // Dedupe: laggy STB remotes sometimes deliver double-Enter which would
      // otherwise push the same view twice and force an extra Back to escape.
      if (view === prev.currentView) return prev;
      return {
        currentView: view,
        navigationStack: [...prev.navigationStack, view]
      };
    });
  }, []);

  const goBack = useCallback(() => {
    setNavigationState(prev => {
      if (prev.navigationStack.length <= 1) {
        if (prev.currentView === 'home') {
          if (onRootBack?.()) return prev;
          const now = Date.now();
          if (now - lastBackPressTime < DOUBLE_PRESS_MS) {
            exitApp();
            return prev;
          }
          setLastBackPressTime(now);
          setBackPressCount(1);
          return prev;
        }
        return prev;
      }

      const newStack = [...prev.navigationStack];
      newStack.pop();
      const previousView = newStack[newStack.length - 1];

      return {
        currentView: previousView,
        navigationStack: newStack
      };
    });
  }, [lastBackPressTime, onRootBack]);

  // Refs — keep the native backButton listener registered ONCE per mount.
  const currentViewRef = useRef(navigationState.currentView);
  const lastBackPressTimeRef = useRef(lastBackPressTime);
  const backPressCountRef = useRef(backPressCount);
  const goBackRef = useRef(goBack);
  const onRootBackRef = useRef(onRootBack);

  useEffect(() => { currentViewRef.current = navigationState.currentView; }, [navigationState.currentView]);
  useEffect(() => { lastBackPressTimeRef.current = lastBackPressTime; }, [lastBackPressTime]);
  useEffect(() => { backPressCountRef.current = backPressCount; }, [backPressCount]);
  useEffect(() => { goBackRef.current = goBack; }, [goBack]);
  useEffect(() => { onRootBackRef.current = onRootBack; }, [onRootBack]);

  useEffect(() => {
    let backButtonHandler: CapacitorListenerHandle | undefined;
    let cancelled = false;

    const setupBackHandler = async () => {
      try {
        const handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
          const currentView = currentViewRef.current;

          if (typeof document !== 'undefined' &&
              document.querySelector('[data-autoupdate-dialog="true"], [data-download-progress="true"], [aria-modal="true"]')) {
            return;
          }
          const handledAt = (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt ?? 0;
          const guideOpen = (window as unknown as { __bufferingGuideOpen?: boolean }).__bufferingGuideOpen === true;
          const playerOwnsBack = (window as unknown as { __playerOwnsBack?: boolean }).__playerOwnsBack === true
            || currentViewRef.current === 'livetv';
          if (playerOwnsBack || guideOpen || Date.now() - handledAt < 350) {
            return;
          }

          console.log('Capacitor back button pressed, current view:', currentView, 'canGoBack:', canGoBack);

          if (currentView !== 'home') {
            goBackRef.current?.();
          } else {
            if (onRootBackRef.current?.()) return;
            const now = Date.now();
            if (now - lastBackPressTimeRef.current < DOUBLE_PRESS_MS && backPressCountRef.current === 1) {
              exitApp();
            } else {
              setLastBackPressTime(now);
              setBackPressCount(1);
            }
          }
        });
        if (cancelled) handle?.remove?.();
        else backButtonHandler = handle;
      } catch (error) {
        console.log('Capacitor not available, using fallback back handling');
      }
    };

    setupBackHandler();

    return () => {
      cancelled = true;
      backButtonHandler?.remove?.();
    };
  }, []);

  // Reset back press count after timeout
  useEffect(() => {
    if (backPressCount > 0) {
      const timeout = setTimeout(() => setBackPressCount(0), DOUBLE_PRESS_MS);
      return () => clearTimeout(timeout);
    }
  }, [backPressCount]);

  return {
    currentView: navigationState.currentView,
    navigationStack: navigationState.navigationStack,
    backPressCount,
    navigateTo,
    goBack,
    canGoBack: navigationState.navigationStack.length > 1
  };
};
