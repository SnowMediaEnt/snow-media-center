# Snow Media Center (SMC)

SMC is Snow Media's Android TV app for its customers: Live TV (IPTV lines from the provider's
panels), Plex movies and shows, an app store/installer, support, an AI assistant, profiles with a
Kids mode, and games. The owner builds it, installs it on real boxes, and reports results.

## Stack and devices
- React 18 + TypeScript + Vite, Tailwind, shadcn/ui (Radix), TanStack Virtual for long lists.
- Capacitor 7 Android shell + our Kotlin plugins (ExoPlayer/Media3 1.5 player, billing, notify, app manager, capture, tamper guard).
- Supabase (Postgres, auth, Deno edge functions), deployed through Lovable.
- Tests: Vitest + Testing Library (jsdom).
- Devices: Fire TV sticks/cubes, onn and Google TV boxes, Android TVs. Remote (D-pad) only.
  Oldest WebView is Chrome 66. Layout is a 960x540 CSS viewport. Many boxes have 2 GB RAM or less.

## Where things are (entry points)
- `src/pages/Index.tsx`: TV shell, Home cards, screen routing (`src/hooks/useNavigation.ts`: screen stack and Back).
- `src/components/LiveTV.tsx`: the Player; hosts `src/components/livetv/` sections.
- `livetv/LiveSection.tsx` (channels, favorites), `GuideSection.tsx` (TV guide), `MoviesSection`/`SeriesSection` + `VideoPlayer.tsx` (Live TV VOD, HTML5 video).
- `livetv/PlexSection.tsx` (Plex browse + playback), `PlexDetail`, `PlexPlayerOverlay`, `BufferingDiagnostics`, `PlayerStatsPanel`.
- `src/lib/`: logic. `xtream.ts` (Live TV API, favorites), `plex.ts` (Plex API, connections, stream URLs), `plexAutoQuality`, `plexProgress` (Continue Watching), `favoritesSync`, `kidsFilter`, `appActions` (open screen/section intents), `analytics`.
- `src/hooks/`: `useNativePlayer` (native player bridge), `usePlexAuth` (Plex sign-in, server choice), `useAuth`, `useTVFocus`.
- `src/capacitor/`: JS side of native plugins (`SnowPlayer.ts`, ...). `src/utils/`: platform, storage, TV scrolling, volume.
- Other screens: `Support.tsx`, `Settings.tsx`, `StoreScreen.tsx`, `InstallApps.tsx`, `UserDashboard.tsx`, `voice/`, `remote/`, `profiles/`, `billing/`.
- `android/app/build.gradle`: versionCode/versionName, signing, BuildConfig secrets (from gradle/local properties).
- `android/app/src/main/java/com/snowmedia/player/SnowPlayerPlugin.kt`: native player (buffers, timeouts, reconnects, stats).
- `supabase/functions/<kebab-name>/`: edge functions (`snow-media-ai`, `plex-provider-token`, `player-login`, ...). `supabase/migrations/`.
- `public/update.json`: in-app update manifest. `src/components/games`, `src/components/kids`: Game Lounge (hands off, see rules).

## Build, compile, test
- `npm install`; web build `npm run build`; dev server `npm run dev`.
- Checks (all must pass before a build is handed over):
  `npx tsc --noEmit -p tsconfig.app.json` · `npx eslint <changed files>` (no new problems vs before) ·
  `npx vitest run` (full) · edge functions: `npx -y esbuild supabase/functions/<name>/index.ts --format=esm`.
- Kotlin can't be compiled here without the Android SDK; the owner's Mac build is the real compile.
- Owner's device build (macOS):
  ```
  npm run build && npx cap sync android
  cd android && ./gradlew clean assembleRelease
  ```
  APK: `android/app/build/outputs/apk/release/app-release.apk`.

## Easy to get wrong (learned the hard way)
- On-screen keyboard: keep the simple 1.6.x path (focus the field, OK calls Keyboard.show(), Enter/Next moves
  to the next field). A custom input connection, key bridges and adjustResize looped Fire TV boxes on the username field.
- Chrome 66: no flex `gap` except `gap-1..4`, no `aspect-ratio`/`inset`/`:is()`; the OS button theme paints
  over rows on old WebViews (buttons have an app-wide reset). Test layout at 960x540.
- White flashes: the WebView stays see-through over black from the first frame; the native player draws
  under a transparent WebView (TextureView). Don't give full-screen layers a background by default.
- Two video paths: Live TV VOD plays in the WebView (Chromium); Plex and live channels play in the native
  ExoPlayer. A buffering problem in one says nothing about the other.
- Plex stream URLs carry `X-Plex-Token`: never log them. Prefer the server's own `*.plex.direct` address
  over custom ones; the relay is capped at ~1-2 Mb/s.
- Low-RAM boxes: every held list or buffer counts (`native-low-memory` class on the page). Don't load
  things behind the viewer's back.
- Every screen needs D-pad focus handling and one Back = one step. Check Kids profiles and demo mode (`isDemo()`).
- Analytics version comes from package.json at build time, not `.env`.

## Owner rules (must hold)
- Never log tokens, passwords, credentials, or URLs that carry them.
- Secrets live in BuildConfig from gradle/local properties, never in source. No encryption keys in the app.
- The admin key never ships in a customer app; the operator token lives only in the Hub.
- A `pay_url` is one-time: open it at once, never cache it, never load it in a WebView.
- Don't rename `analytics_sessions`, `analytics_events`, `analytics_crashes` or their columns (the Hub reads them).
- `src/components/games` and `src/components/kids` belong to another workstream: don't edit.
- Never apply `20260922060000_remote_support_codes.sql`.
- Live TV quietly signs a box into the Snow Media account on file; keep that.

## How we work
The owner sends batches of features and fixes, builds on the Mac, tests on real boxes, and reports back.
We can't see the device: the owner's test results are the final word on whether something works.

### Tracker
`TRACKER.md` (root) is the single source of truth: one line per item with name, type (feature/bug),
status (building, ready to test, still broken, done) and, for bugs, the current rung. Keep it current;
it is what lets a conversation be cleared without losing track.

### When a batch arrives
- Split it into numbered items and add them to TRACKER.md.
- Small changes (a label, a color, a one-file fix): do them directly.
- New features or big changes: architect plans → coder builds → tester checks → manager reviews (`.claude/agents/`).
- Bugs: the bug ladder below.
- Go straight to the locations in this map instead of searching the whole codebase.

### Bug ladder
- Each bug has its own file `bugs/<name>.md`: what's broken, how the owner reproduces it on the device,
  what was tried, and why each attempt failed.
- Normal bugs start at fixer-1. Hard bugs start at fixer-2: streaming, playback, network, performance,
  anything device-specific, or anything that has already failed once.
- Move up one rung when a fixer reports failure or the owner says it still doesn't work. Update the bug
  file first. Exception: a fixer that skipped steps (didn't read a file, didn't build) retries the same rung once.
- Before fixer-4, tell the owner it is the most expensive rung and wait for an OK. If fixer-4 fails, stop
  and give a plain-English summary of what's known.
- Need something only the device can show (exact steps, what's on screen, logs)? Ask for it specifically.
- When the owner confirms a fix: delete the bug file, mark it done in TRACKER.md, say which rung fixed it.

### Handing over a build
- It must build with no errors (checks above). Bump `versionCode` in `android/app/build.gradle` for every
  test build (versionName and `public/update.json` change only for a release).
- Give a short "Ready to test" checklist: the build number, then per item in plain English: what changed,
  how to test it on the device, what "working" looks like.

### Lean habits
- Read only the part of a file you need when you know where the change goes.
- Don't re-read a file you just edited to check it.
- Builds, tests, logs: show only errors and failures.
- When every item in a test round is confirmed done, remind the owner it's a good time to run /clear.

## Compact instructions
When compacting, keep: TRACKER.md status, code changes made (files and what changed), open bugs with
their rung and what was tried, decisions waiting on the owner, and the latest test/build results.
Drop: exploration, file dumps, dead ends and superseded plans.
