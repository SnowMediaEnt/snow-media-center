import { useState, useEffect, useCallback } from 'react';
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

  // Capacitor back button handling for Android TV
  useEffect(() => {
    let backButtonHandler: CapacitorListenerHandle | undefined;
    
    const setupBackHandler = async () => {
      try {
        backButtonHandler = await CapApp.addListener('backButton', ({ canGoBack }) => {
          console.log('Capacitor back button pressed, current view:', navigationState.currentView, 'canGoBack:', canGoBack);
          
          // Handle back navigation based on current view
          if (navigationState.currentView !== 'home') {
            // If we're not on home, go back one step
            goBack();
          } else {
            if (onRootBack?.()) {
              return;
            }
            // We're on home - implement double-press to exit
            const now = Date.now();
            if (now - lastBackPressTime < 2000 && backPressCount === 1) {
              // Double press detected within 2 seconds - exit app
              CapApp.exitApp();
            } else {
              // First press - set counter and timer
              setLastBackPressTime(now);
              setBackPressCount(1);
            }
          }
        });
      } catch (error) {
        console.log('Capacitor not available, using fallback back handling');
      }
    };

    setupBackHandler();

    return () => {
      if (backButtonHandler?.remove) {
        backButtonHandler.remove();
      }
    };
  }, [navigationState.currentView, lastBackPressTime, backPressCount, goBack, onRootBack]);

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