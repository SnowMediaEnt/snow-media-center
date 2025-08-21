import { useState, useEffect, useCallback } from 'react';

interface NavigationState {
  currentView: string;
  previousView: string | null;
  navigationStack: string[];
}

export const useNavigation = (initialView: string = 'home') => {
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
          const now = Date.now();
          if (now - lastBackPressTime < 1000) {
            // Double press detected within 1 second
            try {
              // For Capacitor/Cordova apps
              if ((window as any).Capacitor) {
                (window as any).Capacitor.Plugins.App.exitApp();
              } else if ((window as any).device && (window as any).device.exitApp) {
                (window as any).device.exitApp();
              } else if ((window as any).navigator && (window as any).navigator.app) {
                (window as any).navigator.app.exitApp();
              } else if ((window as any).Android && (window as any).Android.exitApp) {
                (window as any).Android.exitApp();
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
  }, [lastBackPressTime]);

  const resetNavigation = useCallback(() => {
    setNavigationState({
      currentView: initialView,
      previousView: null,
      navigationStack: [initialView]
    });
    setBackPressCount(0);
    setLastBackPressTime(0);
  }, [initialView]);

  // Reset back press count after timeout
  useEffect(() => {
    if (backPressCount > 0) {
      const timeout = setTimeout(() => {
        setBackPressCount(0);
      }, 1000);
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