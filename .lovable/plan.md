# Wire analytics into actual app actions

## Problem

The analytics pipeline works (table receives `app_open` events on startup), but no other events are being recorded. Database shows only `app_open` rows — zero `app_launched`, `screen_view`, or `alert_shown` events. That's why launching Plex / DreamStreams / VibezTV on the device produced nothing in the Admin Hub: the helper `trackAppLaunch()` exists but is never called from the launch code paths.

## What to change

Instrument the existing handlers with the silent helpers from `src/lib/analytics.ts`. All calls remain fire-and-forget — no awaits, no blocking, no UI changes.

### 1. Track app launches
- `src/components/InstallApps.tsx` → inside `attemptLaunch` (~line 400) call `trackAppLaunch(app.name)` right before `AppManager.launch(...)`.
- `src/components/Support.tsx` → inside `launchApp` (~line 53) call `trackAppLaunch(app.name)` before `AppManager.launch(...)`.
- `src/components/BufferingGuide.tsx` → if it has launch entry points, add the same call.

### 2. Track alerts shown
- Wherever the "active warning" popup is shown before a launch (InstallApps), call `trackAlertShown(title)` when it appears.

### 3. Track screen views (lightweight)
- `src/App.tsx` or the main shell: call `trackScreenView(route)` on route change. One call per navigation, no per-render spam.

### 4. Track key buttons (optional, minimal)
- Dashboard main tiles: `trackButtonClick(label, 'dashboard')` on activation. Skip granular UI like focus moves.

## What stays the same

- `src/lib/analytics.ts` — already correct (5s flush, 20-event batch, offline queue, silent failure).
- Database schema and RLS — unchanged.
- No new permissions, no new prompts, no extra data collected.

## Verification

After changes, on the device:
1. Open the app, launch Plex.
2. Within ~5 seconds an `app_launched` row with `properties.app = "Plex"` should appear in `analytics_events`.
3. Admin Hub should reflect it on next refresh.
