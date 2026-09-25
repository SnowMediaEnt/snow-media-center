# Snow Media Center (SMC)

SMC is Snow Media's Android TV app for its customers: Live TV (IPTV lines from the
provider's panels), Plex movies and shows, an app store/installer, support, an AI
assistant, profiles with a Kids mode, and games. It runs on Fire TV and Google TV
boxes and is driven entirely by a TV remote (D-pad).

## Tech stack
- React 18 + TypeScript + Vite, Tailwind, shadcn/ui (Radix), TanStack Virtual for long lists.
- Capacitor 7 Android shell with our own Kotlin plugins (native ExoPlayer/Media3 1.5 player,
  billing, notifications, app manager, capture, tamper guard).
- Supabase (Postgres, auth, Deno edge functions). The backend is deployed through Lovable.
- Tests: Vitest + Testing Library (jsdom); Playwright config exists but is rarely used.
- Target WebView is Chrome 66: no CSS `gap` on flex except the `gap-1..4` utilities,
  no `aspect-ratio`, `inset`, `:is()`; layout is a 960x540 CSS viewport on TV.

## Project map
Tests sit next to their source as `Name.topic.test.tsx`.

### src/pages, app shell
- `src/pages/Index.tsx`: the main TV shell: Home cards, routing between screens (via useNavigation).
- `src/App.tsx`, `src/main.tsx`: app bootstrap (sets `native-low-memory` etc. on low-end boxes).
- Other pages: Auth, Welcome, QRLogin, ClaimAccount, SsoConsume, AdminKnowledge, NotFound.

### src/components (screens)
- `LiveTV.tsx`: the Player: hosts Live TV and Plex sections (`livetv/`), sign-in, Back to Home.
- `Support.tsx`, `SupportTicketSystem.tsx`, `RemoteSupport.tsx`, `BufferingGuide.tsx`, `HowToGuide.tsx`: help.
- `Settings.tsx`, `StoreScreen.tsx`, `InstallApps.tsx`, `AppUpdater.tsx`, `UserDashboard.tsx`: settings, store, apps, account.
- `Admin*.tsx`, `KnowledgeManager.tsx`: admin panels. `AIConversationSystem.tsx`, `voice/`: AI assistant and voice.
- `ChatCommunity.tsx`, `SnowMail*.tsx`: chat and in-app mail. Popups/banners: `WelcomePopup`, `BroadcastAlertPopup`, `ServiceExpirationBanner`, `NewsTicker`, `MediaBar*`.
- `livetv/`: the media player area:
  - `LiveSection.tsx` (channel list, favorites, categories), `GuideSection.tsx` (TV guide grid), `GameDaySection.tsx`, `MultiScreenSection.tsx`, `BackupsSection.tsx`.
  - `MoviesSection.tsx`, `SeriesSection.tsx`, `VideoPlayer.tsx`: Live TV VOD (plays in the WebView's HTML5 video).
  - `PlexSection.tsx` (Plex browse + playback, the big one), `PlexDetail.tsx`, `PlexLibraryRows.tsx`, `PlexPlayerOverlay.tsx`, `PlexProgressReporter.tsx`, `EpisodeAutoplay.tsx`.
  - `BufferingDiagnostics.tsx`, `PlayerStatsPanel.tsx`: buffering card and playback stats.
  - `SettingsHub.tsx`, `CredentialsForm.tsx`, `HideCategoriesScreen.tsx`, `AppearanceScreen.tsx`: in-player settings and sign-in.
- `kids/`, `games/`: Kids lounge and the Game Lounge (owned by another workstream; see Owner rules).
- `billing/`, `profiles/`, `remote/` (phone as remote), `getstarted/` (onboarding), `support/`, `ui/` (shadcn parts, BackButton).

### src/lib (logic, flat folder, grouped by name)
- Live TV: `xtream.ts` (Xtream API, favorites storage), `liveLines`, `liveLayout`, `channelStatus`, `catalogCounts`, `bufferDiagnostics`, `preBuffer`.
- Plex: `plex.ts` (API client, server/connection choice, stream URLs), `plexProvider`, `plexAutoQuality`, `plexStallVerdict`, `plexVersions`, `plexProgress` (Continue Watching), `plexFavorites`, `plexDeeplink`, other `plex*`.
- Sync and viewer: `favoritesSync`, `watchHistory`, `viewer` (which account/profile is watching).
- Profiles and Kids: `profiles`, `kidsFilter`, `adultContent`, `kidsGameNavigation`.
- App actions: `appActions` (intents: open a screen/section/title), `store`, `retiredApps`.
- AI/voice: `voiceCommands`, `voiceUi`, `aiTiers`. Billing: `billing.ts`. Analytics: `analytics.ts`.
- Demo mode: `demoMode`, `xtreamDemo`, `plexDemo`. Mail/support: `snowMail`, `supportAttachments`.
- Player account: `playerLogin`, `playerAutoSignIn`, `playerAccountSync`, `playerSigninCapture`.

### src/hooks, src/capacitor, src/utils, other src
- Hooks: `useNavigation` (screen stack, Back), `useTVFocus` / `useOwnHardwareBack` (D-pad, Back key),
  `useNativePlayer` (bridge to the native player), `usePlexAuth` (Plex sign-in, server choice),
  `useAuth`, `useUserProfile`, `useActiveProfile`, `usePlayerAccount`, `useApps`, `useFeatureFlag`.
- `src/capacitor/`: JS wrappers for native plugins (`SnowPlayer.ts`, `SmcBilling`, `SnowNotify`, `AppManager`, `SnowCapture`).
- `src/utils/`: platform detection, storage, network, edge-function calls, TV scrolling, volume, idle timers.
- `src/data/` (static data, tutorials), `src/integrations/supabase/` (client + generated DB types),
  `src/i18n/` (en, fr, de, es, ar), `src/styles/` (tv.css, plex.css, games), `src/test/` (setup, edge-function shims).

### android/
- `android/app/build.gradle`: versionCode/versionName, release signing, BuildConfig fields (secrets come from gradle/local properties, never from Kotlin files).
- `android/app/src/main/java/com/snowmedia/`: `MainActivity.kt`, `SplashActivity.kt`,
  `player/SnowPlayerPlugin.kt` (ExoPlayer: load control, data sources, reconnects, stats),
  `billing/`, `notify/`, `appmanager/`, `capture/`, `security/TamperGuard.kt`, `widget/`.

### supabase/, other folders
- `supabase/functions/<kebab-name>/`: edge functions (AI: `snow-media-ai`; Plex: `plex-provider-token`;
  Live TV: `player-login`, `player-favorites`, `channel-status`; notify: `send-push`, `notify-ticket`; shared code in `_shared/`).
- `supabase/migrations/`: SQL migrations `YYYYMMDDHHMMSS_name.sql`.
- `public/update.json`: in-app update manifest (version + changelog). `web/phone-remote/`: phone remote page.
- `docs/`: handoffs, brand assets, billing notes. `scripts/`: postinstall helpers.

## Run, build, test
- Install: `npm install`. Dev server: `npm run dev`. Web build: `npm run build`.
- Checks before any commit:
  - `npx tsc --noEmit -p tsconfig.app.json`
  - `npx eslint <changed files>` (compare with the file's previous version; some files carry old warnings)
  - `npx vitest run <related tests>`, then `npx vitest run` for everything
  - Edge functions: `npx -y esbuild supabase/functions/<name>/index.ts --format=esm` to catch syntax errors
- Android release (on the owner's Mac):
  ```
  npm run build && npx cap sync android
  cd android && ./gradlew clean assembleRelease
  ```
  Output: `android/app/build/outputs/apk/release/app-release.apk`. Bump versionCode/versionName in
  `android/app/build.gradle` and `public/update.json` together.

## Conventions
- Components PascalCase `.tsx`; hooks `useX.ts`; lib modules camelCase `.ts`; Kotlin plugins `XPlugin.kt`;
  edge functions kebab-case folders; tests `Name.topic.test.tsx` beside the source.
- Comments explain why, in plain words. Match the density of the surrounding code.
- Everything is D-pad driven: every new screen needs focus handling and a Back path.
- Kids profiles and demo mode (`isDemo()`) must be checked for anything customer-facing.
- Commit messages: a short subject, then plain-English lines on what changed and why.

## Owner rules (must hold)
- Never log tokens, passwords, credentials, or URLs that carry them (Plex URLs carry `X-Plex-Token`).
- Secrets go in BuildConfig from gradle/local properties, never in Kotlin or TS source.
  No encryption keys in the app: a key shipped in an APK is not a secret.
- The admin key never ships in a customer-facing client. The operator token lives only in the Hub.
- A payment `pay_url` is one-time: open it immediately, never cache it, never load it in a WebView.
- Don't rename tables or the columns sent to `analytics_sessions`, `analytics_events`, `analytics_crashes`
  (the admin Hub's reports read them).
- `src/components/games` and `src/components/kids` (Game Lounge) belong to another workstream: don't edit.
- Never apply `20260922060000_remote_support_codes.sql` (it breaks admin-made support codes).
- Live TV quietly signs a box into the Snow Media account on file; keep that behaviour.

## When to use the team (.claude/agents)
- New features or big changes: use the full team in order: `architect` (plan + questions for the
  owner, names the files) → owner answers → `coder` (builds only the plan) → `tester` (tries to break
  it, reports failures only) → `manager` (plain-English approve/reject decisions for the owner).
- Small fixes (a button, a label, a color, a one-file bug): skip the team and handle it directly.
- Always go straight to the files named in this project map instead of searching the whole codebase.

## Lean habits
- Read only the part of a file you need when you know where the change goes (use line ranges or grep).
- Don't re-read a file you just edited to check it.
- When running tests or reading logs, show only errors and failures (e.g. `| grep -E "FAIL|Error|×"`).

## Compact instructions
When compacting, keep: code changes made (files and what changed), open bugs and decisions waiting on
the owner, and the latest test/check results. Drop: exploration, file dumps, dead ends and superseded plans.
