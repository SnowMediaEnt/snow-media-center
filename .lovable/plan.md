I can see a few likely conflicts that would show up on the Android box more than in preview:

1. The RSS feed is still fetching every 60 seconds on web and 5 minutes on native, but on web it tries failing CORS proxies first. On a device the bigger issue is that the ticker is always animating while every D-pad movement triggers React state changes, focus scaling, shadows, and sometimes scroll/focus work. Android WebView compositing is weaker than desktop Chrome, so the ticker layer can hitch when nearby UI repaints.
2. Home focus changes currently re-render the whole Home screen, not just the old/new focused cards.
3. Focus effects still use expensive styles on TV hardware: `brightness`, large `box-shadow`, `filter`, gradients, `transition-all`, and `will-change` on multiple cards. Those can steal compositor time from the marquee.
4. There are duplicate/global back and navigation listeners (`App.tsx`, `useNavigation`, page-level handlers, component-level handlers). That can add extra work and unpredictable behavior on remote input.
5. Main Apps status scanning refreshes all app statuses on focus/visibility return and loops through apps with async checks. That can cause hitches after returning from Settings/cache/uninstall.
6. Uninstall may still fail because Android TV builds can ignore or restrict the standard delete intent. We need a stronger fallback that opens the app’s App Info uninstall path when the package installer result says it is still installed.

## Plan

### 1. Make the RSS ticker device-safe
- Add a native/TV “low-jank” mode for the ticker.
- Pause the ticker briefly while the user is pressing D-pad keys, then resume after a short idle delay. This removes the competing animation during cursor movement, which is exactly when you notice the stutter.
- On native, avoid repeated RSS refresh work during normal use: fetch once at startup, cache the parsed ticker text in localStorage/Capacitor storage, then refresh much less often in the background.
- Keep the CSS marquee for web/desktop, but reduce layer pressure on Android WebView.

### 2. Stop Home from repainting more than necessary
- Split Home into smaller memoized pieces: header controls, title, ticker, and card row.
- Replace focus-driven full-page updates where possible with DOM `data-focused` attributes or card-local state so only the previous and next focused surfaces visually change.
- Keep the current D-pad behavior, but make each key press do less React/render work.

### 3. Simplify TV focus effects for smoother remote movement
- Replace expensive focused-card styles (`brightness`, heavy shadows, filters, large gradient overlays) with cheaper transform + ring/border/glow that matches the existing “glow and grow” design.
- Remove broad `transition-all` and use only `transform`/`opacity`/`box-shadow` where needed.
- Disable or reduce hover/focus image/icon scale transitions on TV/native.
- Avoid `will-change` on every card all the time; only promote the currently focused/animated element.

### 4. Clean up navigation event handling
- Consolidate duplicate Android back-button handling so back events are not processed by multiple systems.
- Ensure home D-pad handling uses capture/preventDefault consistently and does not fall through to browser/WebView scroll behavior.
- Keep modal/dialog key handling isolated so background focus does not move.

### 5. Make Main Apps status refresh less janky
- Debounce visibility/focus refreshes after returning from Android Settings.
- Refresh only the affected app after uninstall/cache/settings actions instead of rechecking every app immediately.
- Move full installed-app scanning to explicit Refresh or app-open only, not every focus return.

### 6. Improve uninstall reliability
- Keep the current standard uninstall intent first.
- If Android returns but the app is still installed, show a clear fallback toast and open the exact App Info screen for that package so the user can press Uninstall manually.
- Add better result handling and package verification so the UI doesn’t claim success unless the package is actually gone.
- If possible on that Android build, add a second native fallback intent (`ACTION_APPLICATION_DETAILS_SETTINGS`) with uninstall guidance instead of repeatedly saying “uninstalling.”

## Technical files to update
- `src/components/NewsTicker.tsx`
- `src/index.css`
- `src/pages/Index.tsx`
- `src/components/HomeClock.tsx` if needed for low-jank native styling
- `src/hooks/useNavigation.ts`
- `src/App.tsx`
- `src/components/InstallApps.tsx`
- `src/hooks/useDeviceInstalledApps.ts`
- `android/app/src/main/java/com/snowmedia/appmanager/AppManagerPlugin.kt`
- `src/capacitor/AppManager.ts`

## Expected result
- D-pad left/right movement on the Home screen should feel steadier because the ticker won’t fight the focus animation during remote input.
- The RSS feed should stop visibly hitching when moving the cursor.
- Main Apps should avoid unnecessary rescans and hitches after returning from Android system screens.
- Uninstall will no longer falsely report success; if the TV box blocks programmatic uninstall, it will take the user directly to the correct Android App Info screen as a reliable fallback.