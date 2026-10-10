import { useState, useEffect, useCallback, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import i18n from '@/i18n';
import { GLOBAL_MODAL_SELECTOR } from '@/components/games/shared/gameInput';
import { gameOwnsHardwareBack } from '@/components/games/shared/gameBack';
import { isTouchUI } from '@/lib/phoneMode';

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
    catch { alert(i18n.t('home.exit.pressHome')); }
  }
};

/** Two Back presses on Home at most this far apart leave the app. */
const DOUBLE_PRESS_MS = 2000;
/**
 * Home must have been on screen this long before a Back there counts toward
 * leaving the app. A press in Home's first moments belongs to the screen just
 * left: the one that walked out of the Player, or presses Capacitor held while
 * the page was not listening (it replays them to the first backButton listener
 * the moment one is added, which is Home's, at boot or after the WebView was
 * reloaded) and a box that is slow to draw Home under a recording.
 */
export const HOME_SETTLE_MS = 800;
/** One press delivered twice (the system Back event and a key) is still one press. */
const SAME_PRESS_MS = 350;

/** How long a phone's Back waits for the screen's own step to show. */
const BACK_PROOF_MS = 120;

export const useNavigation = (initialView: string = 'home', options: NavigationOptions = {}) => {
  const { onRootBack } = options;
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentView: initialView,
    navigationStack: [initialView]
  });

  const [backPressCount, setBackPressCount] = useState(0);

  // When Home came on screen (0 while another screen is up), and when the
  // first of the two exit presses was made there (0 = none). Refs: the native
  // listener and Index's key handler both read them, and must agree.
  const homeSinceRef = useRef(initialView === 'home' ? Date.now() : 0);
  const armedAtRef = useRef(0);
  useEffect(() => {
    homeSinceRef.current = navigationState.currentView === 'home' ? Date.now() : 0;
    armedAtRef.current = 0;
  }, [navigationState.currentView]);

  /**
   * Back on Home with nothing open there: the app's only way out. The first
   * press shows "press Back again to exit", a second one within two seconds
   * leaves. Neither can be a press that belongs to another screen.
   */
  const backAtHome = useCallback(() => {
    const now = Date.now();
    const since = homeSinceRef.current;
    if (!since || now - since < HOME_SETTLE_MS) return;
    const armed = armedAtRef.current;
    if (armed && now - armed < SAME_PRESS_MS) return;
    if (armed && now - armed < DOUBLE_PRESS_MS) {
      armedAtRef.current = 0;
      setBackPressCount(0);
      exitApp();
      return;
    }
    armedAtRef.current = now;
    setBackPressCount(1);
  }, []);

  const navigateTo = useCallback((view: string) => {
    setNavigationState(prev => {
      // Dedupe: laggy STB remotes sometimes deliver double-Enter which would
      // otherwise push the same view twice and force an extra Back to escape.
      if (view === prev.currentView) return prev;
      // A screen already on the way back is returned to, not stacked again:
      // Support's "Back to Player" on [home, livetv, support] is
      // [home, livetv], so Back from the Player then goes Home, not to
      // Support and a second Player. Home is always just [home].
      const at = prev.navigationStack.indexOf(view);
      if (at >= 0) {
        return { currentView: view, navigationStack: prev.navigationStack.slice(0, at + 1) };
      }
      return {
        currentView: view,
        navigationStack: [...prev.navigationStack, view]
      };
    });
  }, []);

  const stateRef = useRef(navigationState);
  stateRef.current = navigationState;
  const onRootBackRef = useRef(onRootBack);
  useEffect(() => { onRootBackRef.current = onRootBack; }, [onRootBack]);

  const goBack = useCallback(() => {
    const st = stateRef.current;
    if (st.navigationStack.length <= 1) {
      // Home: its own popups first, then the way out. Anywhere else at the
      // root (a screen opened straight from boot) Back does nothing.
      if (st.currentView === 'home' && !onRootBackRef.current?.()) backAtHome();
      return;
    }
    setNavigationState(prev => {
      if (prev.navigationStack.length <= 1) return prev;
      const newStack = prev.navigationStack.slice(0, -1);
      return {
        currentView: newStack[newStack.length - 1],
        navigationStack: newStack
      };
    });
  }, [backAtHome]);

  // Refs — keep the native backButton listener registered ONCE per mount.
  const currentViewRef = useRef(navigationState.currentView);
  const goBackRef = useRef(goBack);

  useEffect(() => { currentViewRef.current = navigationState.currentView; }, [navigationState.currentView]);
  useEffect(() => { goBackRef.current = goBack; }, [goBack]);

  useEffect(() => {
    let backButtonHandler: CapacitorListenerHandle | undefined;
    let cancelled = false;

    const setupBackHandler = async () => {
      try {
        const handle = await CapApp.addListener('backButton', ({ canGoBack }) => {
          const currentView = currentViewRef.current;

          if (typeof document !== 'undefined' &&
              document.querySelector(GLOBAL_MODAL_SELECTOR)) {
            return;
          }
          const handledAt = (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt ?? 0;
          const guideOpen = (window as unknown as { __bufferingGuideOpen?: boolean }).__bufferingGuideOpen === true;
          const playerOwnsBack = (window as unknown as { __playerOwnsBack?: boolean }).__playerOwnsBack === true
            || currentViewRef.current === 'livetv';
          // A mounted casino game owns hardware Back: its wager-safe guard
          // decides, so this listener must not pop the route underneath it.
          if (gameOwnsHardwareBack() || playerOwnsBack || guideOpen || Date.now() - handledAt < 350) {
            return;
          }

          console.log('Capacitor back button pressed, current view:', currentView, 'canGoBack:', canGoBack);

          // A phone or tablet: the gesture / the bar's Back reaches the page
          // only here, never as a key. The screen gets the Escape a remote's
          // Back gives it, so it takes its own steps first (a ticket → the
          // list, a guide's page → its menu: Tronix fe50f34, 6cd9617); only
          // a press nobody answered is a step back here. Home keeps its own
          // way out. A TV is unchanged.
          if (isTouchUI() && stateRef.current.navigationStack.length > 1) {
            // Answered = proven, not assumed: the screen marked the press
            // handled (__overlayHandledBackAt), or its step changed what is
            // on screen within a moment (a view went, a list came back). A
            // screen that only swallows the Escape (preventDefault, nothing
            // else) leaves the press unanswered, and this takes the step.
            const w = window as unknown as { __overlayHandledBackAt?: number };
            const markBefore = w.__overlayHandledBackAt ?? 0;
            let changed = false;
            let mo: MutationObserver | null = null;
            try {
              mo = new MutationObserver((list) => { if (list.some((m) => m.type === 'childList')) changed = true; });
              mo.observe(document.body, { childList: true, subtree: true });
            } catch { mo = null; }
            let swallowed = false;
            try {
              const ev = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
              document.body.dispatchEvent(ev);
              swallowed = ev.defaultPrevented;
            } catch { /* very old WebView: the plain step below */ }
            if ((w.__overlayHandledBackAt ?? 0) !== markBefore) { mo?.disconnect(); return; }
            if (!swallowed || !mo) { mo?.disconnect(); goBackRef.current?.(); return; }
            // Taken but not marked: give the screen's step a moment to render.
            window.setTimeout(() => {
              mo?.disconnect();
              if (!changed) goBackRef.current?.();
            }, BACK_PROOF_MS);
            return;
          }

          // One step back; on Home, the double press that leaves the app.
          goBackRef.current?.();
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
