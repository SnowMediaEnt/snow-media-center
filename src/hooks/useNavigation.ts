import { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';

interface NavigationState {
  currentView: string;
  previousView: string | null;
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

export const useNavigation = (initialView: string = 'home', options: NavigationOptions = {}) => {
  const { onRootBack } = options;
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentView: initialView,
    previousView: null,
    navigationStack: [initialView]
  });

  const [backPressCount, setBackPressCount] = useState(0);
  const [lastBackPressTime, setLastBackPressTime] = useState(0);

  const navigateTo = useCallback((view: string) => {
    setNavigationState(prev => ({
      currentView: view,
      previousView: prev.currentView,
      navigationStack: [...prev.navigationStack, view]
    }));
  }, []);

  const goBack = useCallback(() => {
    setNavigationState(prev => {
      if (prev.navigationStack.length <= 1) {
        // We're at the root (home), handle double-press to exit
        if (prev.currentView === 'home') {
          if (onRootBack?.()) {
            return prev;
          }
          const now = Date.now();
          if (now - lastBackPressTime < 1000) {
            // Double press detected within 1 second
            try {
              // For Capacitor/Cordova apps
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
                // For web/desktop - try to close window
                window.close();
              }
            } catch (error) {
              console.log('Exit app failed:', error);
              // Fallback: try to go to about:blank or show exit message
              try {
                window.location.href = 'about:blank';
              } catch (e) {
                alert('Press home button to exit');
              }
            }
            return prev;
          } else {
            setLastBackPressTime(now);
            setBackPressCount(1);
            return prev;
          }
        }
        return prev;
      }

      const newStack = [...prev.navigationStack];
      newStack.pop(); // Remove current view
      const previousView = newStack[newStack.length - 1];

      return {
        currentView: previousView,
        previousView: prev.currentView,
        navigationStack: newStack
      };
    });
  }, [lastBackPressTime, onRootBack]);

  const resetNavigation = useCallback(() => {
    setNavigationState({
      currentView: initialView,
      previousView: null,
      navigationStack: [initialView]
    });
    setBackPressCount(0);
    setLastBackPressTime(0);
  }, [initialView]);

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 6B.1: register the native backButton listener ONCE per mount.
  // Previously this effect depended on currentView / lastBackPressTime /
  // backPressCount / goBack / onRootBack, so every navigation tore the native
  // listener down and re-added it (154 add/remove calls / 60s on device).
  // We now keep all changing values in refs and read them from the single
  // long-lived handler — behavior is identical.
  // ──────────────────────────────────────────────────────────────────────────
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
          // If an overlay (BufferingGuide, SpeedTest, etc.) just handled this
          // back press, do not also pop the underlying view.
          const handledAt = (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt ?? 0;
          const guideOpen = (window as unknown as { __bufferingGuideOpen?: boolean }).__bufferingGuideOpen === true;
          if (guideOpen || Date.now() - handledAt < 350) {
            return;
          }

          const currentView = currentViewRef.current;
          console.log('Capacitor back button pressed, current view:', currentView, 'canGoBack:', canGoBack);

          if (currentView !== 'home') {
            goBackRef.current?.();
          } else {
            if (onRootBackRef.current?.()) {
              return;
            }
            // We're on home - implement double-press to exit
            const now = Date.now();
            if (now - lastBackPressTimeRef.current < 2000 && backPressCountRef.current === 1) {
              CapApp.exitApp();
            } else {
              setLastBackPressTime(now);
              setBackPressCount(1);
            }
          }
        });
        if (cancelled) {
          handle?.remove?.();
        } else {
          backButtonHandler = handle;
        }
      } catch (error) {
        console.log('Capacitor not available, using fallback back handling');
      }
    };

    setupBackHandler();

    return () => {
      cancelled = true;
      if (backButtonHandler?.remove) {
        backButtonHandler.remove();
      }
    };
  }, []);

  // Reset back press count after timeout
  useEffect(() => {
    if (backPressCount > 0) {
      const timeout = setTimeout(() => {
        setBackPressCount(0);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [backPressCount]);

  return {
    currentView: navigationState.currentView,
    previousView: navigationState.previousView,
    navigationStack: navigationState.navigationStack,
    backPressCount,
    navigateTo,
    goBack,
    resetNavigation,
    canGoBack: navigationState.navigationStack.length > 1
  };
};
