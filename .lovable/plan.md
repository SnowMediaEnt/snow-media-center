# Three fixes: Content Bar default, DreamStreams settings, Download resume

## 1. Turn the Content Bar back on by default (with a slower, safer load)

- Change the home Content Bar to default **on** for every device, including older Android TV / Fire TV / X96 boxes.
- To keep low-memory devices stable, the bar will load its content gradually instead of instantly:
  - Delay the first feed fetch to ~6 seconds after the home screen renders on low-memory devices (was 1.5s).
  - Keep the current safety cap that limits the bar to one page (8 items) on low-memory devices, so the WebView doesn't get hit with dozens of posters at once.
  - Refresh interval stays the same.
- Users can still toggle it off in Settings.

## 2. Buffering Guide "Open DreamStreams Settings" lands on the wrong page

Today it opens Android's generic "Manage Installed Applications" list instead of the DreamStreams App Info page. Plex and VibezTV work because their package names match what we hard-coded; the real DreamStreams APK on the device uses a different package name, so the lookup misses.

Fix:
- Have the buffering guide pass the **app's display name** ("Dreamstreams") to the open-settings call, not just the guessed package.
- In the native AppManager plugin, when the package isn't found, scan the installed apps list for one whose label matches "dreamstream" (case- and punctuation-insensitive) and use that real package to open App Info.
- If nothing matches at all, show a clear toast ("DreamStreams isn't installed on this device") instead of silently dumping the user on the generic Apps page.
- Same fix automatically helps any other app whose real package name differs from what's in the catalog.

## 3. Remember finished downloads so the user can install on next open

Right now, if a download reaches 100% and the user backs out before tapping Install, the APK is wiped and they have to re-download the whole thing.

Fix:
- When a download hits 100% (state = complete), **keep** the APK in cache even if the user closes the dialog. Only purge it on errors, cancellations during download, or after a successful install.
- When the user opens Main Apps or taps Download for that app again, check the APK cache first:
  - If a finished APK for that exact app + version is on disk, skip straight to the install prompt ("Ready to install — Install Now / Cancel") instead of starting a new download.
  - If the cached file is for an older version, delete it and download fresh.
- Existing 7-day / size-based cache cleanup keeps things from piling up forever.

## Technical notes

- `src/hooks/useMediaBarEnabled.ts` — default returns `true`; remove the low-memory auto-off branch.
- `src/components/MediaBar.tsx` — bump the initial `setTimeout` from 1500ms to 6000ms when `IS_LOW_MEMORY_NATIVE` is true; keep the existing `slice(0, PAGE_SIZE)` cap.
- `android/.../AppManagerPlugin.kt` — `openAppSettings` accepts an optional `appName`; on package miss, iterate `getInstalledPackages(0)` and match by normalised label substring.
- `src/capacitor/AppManager.ts` — extend `openAppSettings` signature with optional `appName`.
- `src/components/Support.tsx` — pass `appName: app.name` into `AppManager.openAppSettings`.
- `src/components/DownloadProgress.tsx` — in `handleCloseAndCleanup`, skip `purgeCachedApk()` when `state === 'complete'`.
- `src/components/InstallApps.tsx` — in `handleDownload`, before calling `startDownload`, use `AppManager.listCachedApks()` to look for `generateFileName(app.name, app.version)`. If present, open `DownloadProgress` in a new "ready-to-install" mode (or call `AppManager.installApk` directly with a confirmation toast).
- `src/utils/downloadApk.ts` — add a small helper `findCachedApk(filename)` that returns the cached path or null.
