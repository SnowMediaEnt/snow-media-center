# Fix TV/Android D-pad scroll navigation

## Goal

Fix scroll position behavior for Android TV, Fire TV/Firestick, Android phones, and Android tablets without changing navigation routing, back-stack behavior, or view-switching logic.

This work only changes where the current screen scrolls on focus movement or snap-to-top events.

It does not change which screen/view is shown.

## Confirmed root causes

### 1. `snapAllTVScrollToTop` misses the real app scroller

The real viewport scroller is the outer app shell element with `data-app-scroll-root` in `src/App.tsx`. It has the height/overflow behavior that stores scroll position.

`src/utils/tvScroll.ts` currently resets document/body plus `.tv-scroll-container` and `.tv-safe-scroll`, but not `[data-app-scroll-root]`, so snap-to-top can leave the visible app scrolled down.

### 2. `block: 'center'` causes focus jumps

D-pad focus scrolls using `scrollIntoView({ block: 'center' })` recenter focused elements instead of minimally revealing them. This prevents natural top/bottom edge reach and creates large jumps on 1080p and 4K TV screens.

`block: 'nearest'` is the correct behavior for D-pad navigation focus movement because it scrolls only when needed and by the minimum amount.

## Files to change

### Core scroller reset

- `src/utils/tvScroll.ts`
  - Add `[data-app-scroll-root]` to the snap reset query:

```ts
document.querySelectorAll<HTMLElement>('[data-app-scroll-root], .tv-scroll-container, .tv-safe-scroll')
```

### D-pad/focus scroll behavior

Replace navigation-related `scrollIntoView` calls from `block: 'center'` to `block: 'nearest'` in:

- `src/contexts/FocusContext.tsx` — 1 instance
- `src/components/Settings.tsx` — 4 instances
- `src/components/ChatCommunity.tsx` — 1 D-pad navigation instance
- `src/components/UserDashboard.tsx` — 2 instances
- `src/components/SupportVideos.tsx` — 1 instance
- `src/components/MediaStore.tsx` — 1 instance
- `src/components/AIConversationSystem.tsx` — 3 instances
- `src/components/ApkCacheViewer.tsx` — 5 instances
- `src/components/BufferingGuide.tsx` — 5 center instances found in the D-pad/focus flow
- `src/components/PinnedAppsPopup.tsx` — 1 instance
- `src/components/MediaManager.tsx` — 1 instance
- `src/components/UserServicesEditor.tsx` — 2 instances
- `src/pages/Auth.tsx` — 1 instance

## Explicit exceptions

Do not change the two intentional AI chat history display scrolls in `src/components/ChatCommunity.tsx`:

- the conditional scroll option inside `currentFocusId.startsWith('ai-history-')`
- the matching direct history scroll immediately after that condition

Those remain `block: 'center'` because they are display behavior for saved chat history, not general D-pad navigation.

Do not change existing `block: 'start'` or already-`nearest` scroll calls.

## Systems that will not be touched

- `src/hooks/useNavigation.ts`
- `navigateTo()`, `goBack()`, `canGoBack`, back-press counting, double-press-to-exit behavior
- any `onBack` callback prop or function passed into it
- any `goBack()` calls in `Index.tsx` or components
- back key handlers for `Escape`, `Backspace`, `keyCode 4`, or `GoBack`
- `currentView` state or view-switching logic in `Index.tsx`

## Constraints

- No hardcoded pixel values.
- Preserve existing `dvh`, `dvw`, and `clamp()` responsive behavior.
- Keep the app usable with D-pad remote, touch, and keyboard across 480p phone layouts through 4K TV layouts.

## Verification after implementation

Re-test these screens and flows:

- Home / main dashboard back-to-top behavior
- Main Apps scrolling to true top and bottom
- Support scrolling and bottom button spacing behavior
- AI Chat conversation reading and saved chat list scrolling
- Settings, including image generation area and APK cache viewer
- Media Manager focus scrolling
- Media Store focus scrolling
- Support Videos focus scrolling
- Buffering Guide D-pad movement
- User Dashboard tabs/content focus movement
- Pinned Apps popup
- User Services editor
- Auth page focus movement

Expected result: D-pad focus movement should only scroll when needed, snap-to-top should reset the actual app viewport, and screens should be able to reach their true top and bottom edges without changing navigation/back behavior.