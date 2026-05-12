# Add In-App Speedtest to Install Apps

## Goal
Add a **Speedtest** button at the top of the Install Apps screen (next to Back / Refresh / Clear All). Tapping it opens a full-screen in-app speed test that measures download, upload, ping, and jitter — runs entirely inside Snow Media Center, works on Android TV / STB / mobile, fully D-pad navigable.

## Why LibreSpeed
- Open source (LGPL), free forever, no API key
- Pure browser JS — runs inside the WebView, no native plugin needed
- Uses public LibreSpeed backends (Cloudflare-hosted) by default; can be self-hosted on snowmediaapps.com later if you want your own server
- Accuracy comparable to Ookla for typical home connections

## Where it goes
Top action row in `src/components/InstallApps.tsx`, alongside Back / Refresh / Clear All. Gauge icon, blue gradient (matches the secondary-action button pattern in memory).

## What gets built

### 1. New component `src/components/SpeedTest.tsx`
Full-screen overlay with:
- Big circular gauge showing live download/upload Mbps
- Ping & jitter readouts
- Start / Stop / Run Again buttons (D-pad focusable, glow-and-grow focus)
- Result summary card after the run with a "Good for 4K?" badge using the 15 Mbps threshold from the existing buffering guide memory
- Back button returns to Install Apps with focus restored

Uses the official LibreSpeed `speedtest.js` worker (vendored to `public/librespeed/`) — single ~25 KB file plus a worker. No npm package, no build changes.

### 2. New focus type `'speedtest'` in `InstallApps.tsx`
- Add button to the top action row (left of Refresh)
- Wire D-pad: Back ↔ Speedtest ↔ Refresh ↔ Clear All
- Open `<SpeedTest />` as a state-toggled overlay (same pattern as `AppAlertDialog`)

### 3. Native network allowance
LibreSpeed defaults to Cloudflare endpoints (`speedtest.net`-style HTTPS). Add the LibreSpeed test host to `android/app/src/main/res/xml/network_security_config.xml` whitelist so Android 7+ cleartext/TLS rules don't block it.

### 4. No backend / no Edge Function
Fully client-side. No Supabase changes, no secrets, no migrations.

## D-pad / TV behavior
- Glow-and-grow focus, no boxy outlines (per Core memory)
- Back button on remote closes the speedtest overlay first, then exits Install Apps (uses existing hierarchical back-nav pattern)
- `scrollIntoView({block:"center"})` on focus changes inside the result card

## Out of scope
- Ookla branding/Speedtest.net embed (not licensable for this use case)
- Self-hosting a LibreSpeed backend on snowmediaapps.com — can be added later by dropping the PHP backend on your server and pointing the component at it
- History of past speedtest results (can be added later via a `speedtest_results` table if you want)

## Files touched
- **New**: `src/components/SpeedTest.tsx`
- **New**: `public/librespeed/speedtest.js`, `public/librespeed/speedtest_worker.js` (vendored)
- **Edit**: `src/components/InstallApps.tsx` — add button + focus wiring + overlay state
- **Edit**: `android/app/src/main/res/xml/network_security_config.xml` — whitelist LibreSpeed test host

After merging you'll need to run `npx cap sync android` once for the network config change to take effect.
