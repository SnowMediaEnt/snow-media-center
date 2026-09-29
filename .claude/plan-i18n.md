# Owner decisions (final)
- All 5 languages fully covered: en (default), es, fr, de, ar. Arabic: text only, screens stay LTR.
- AI assistant answers in the chosen language; Plex sends X-Plex-Language. Hub content, provider data stay as-is.
- Game Lounge (components/games, components/kids, games.* keys) is excluded: another chat owns it.
- Architect's recommended answers adopted (owner may override later):
  1. Staff-only admin screens stay English.
  2. Arabic digits 0-9.
  3. Latin-American Spanish (tú), French (vous), German (du), Modern Standard Arabic.
  4. 12-hour clock everywhere.
  5. Phone remote page follows the TV's language (?lang= in the QR link).
  6. Quick voice commands stay English-only; other languages go to the AI.

# Plan: switching the language changes all text (es, fr, de, ar; English stays the default)

**Why Español changed almost nothing.** Only 3 files outside the Game Lounge use translations today: `src/pages/Index.tsx`, `src/components/Settings.tsx` and `src/components/Games.tsx`. The "about 156 files" figure is wrong. Of the 381 English keys, 343 belong to the Game Lounge (`games.*`) and only 38 cover the rest of the app. Everything else is hard-coded English. The es/fr/de/ar files are also already 27 keys short of English: 2 are `home.giveaway.*` and 25 are `games.slots.*`.

The job is about 4,000 strings in about 180 files, plus the phone remote page and about 45 Android native strings. That is roughly 16,000 translations across the four languages.

## Questions for the owner (one line each, my recommendation in brackets)
1. Should the staff-only admin screens stay in English? These are the Support dashboard, AI panel, media manager, alert manager, APK cache, knowledge editor and the free-AI panel: 13 files, about 600 strings, which customers never see. [Yes, keep them English. That saves about 15% of the work.]
2. Should Arabic show numbers as 0-9 or as Arabic-Indic digits? [0-9, so channel numbers match the number keys on the remote.]
3. Which tone and variety for each language? [Latin-American Spanish with "tú"; French with "vous"; German with "du"; Modern Standard Arabic.]
4. Should the clock stay 12-hour in every language, or follow each language's habit (24-hour in es/fr/de)? [12-hour everywhere. Customers are in the US and the Guide columns are sized for "10:30 PM".]
5. Should the phone remote page follow the TV's language (passed in the QR link), or the phone's own language? [The TV's language.]
6. Quick voice commands like "open Live TV" only understand English today. Anything else already goes to the AI assistant, which understands every language but is slower. Leave it that way for now? [Yes. Add phrases in other languages later if the owner asks.]

## 1. Scope

Counts come from scanning the code for on-screen text: text inside components, labels, placeholders and toasts. Treat them as ±25%.

| Area | Files | Strings (about) |
|---|---|---|
| Home and top bar (Index, HomeClock, MediaBar, MediaBarPrompt, the frame around the news ticker, WelcomePopup) | 8 | 175 |
| Settings (Settings.tsx, theme; the language picker is already in there) | 2 | 55 |
| Dashboard, account, billing (billing/*, UserDashboard, UserServicesEditor, QRCheckout, Giveaway*, CreditStore, ServiceExpirationBanner, aiTiers) | 20 | 470 |
| Auth and get-started (Auth, ClaimAccount, QRLogin, SsoConsume, Welcome, QRCodeLogin, AccountChooser, getstarted/*) | 14 | 270 |
| Live TV: sections, player bar, dialogs, VOD, multi-screen | ~25 | 360 |
| Live TV: Guide, Game Day (+GameReminderHost), Recordings, Record dialog, Rewind settings, Live TV settings and account screens | ~24 | 330 |
| Plex (PlexSection alone has 134, plus Detail, Player overlay, Stats, Auth, Overseerr, lib/plex*) | 22 | 425 |
| Support, tickets, AI chat, voice, guides (BufferingGuide 208, ChatCommunity 141, RemoteSupport 132, SupportTicketSystem 97, tutorialContent 79, …) | 25 | 1,050 |
| Store (the screen around the items) | 2 | 65 |
| Main Apps (InstallApps, PinnedApps, context menu, retired apps) | 9 | 115 |
| Profiles | 2 | 70 |
| Phone remote (TV side, plus `web/phone-remote/PhoneRemotePage.tsx` with 64) | 5 | 100 |
| Popups, toasts, errors (409 toast calls in 64 files, mostly counted in their areas above; the rest here) | 12 | 40 |
| Updater (AppUpdater, AutoUpdatePrompt, DownloadProgress, updateCache, downloadApk) | 5 | 90 |
| Android native (RecordingService 12, RecordScheduler 7, AlertNotifier/AlertPollWorker 9, SmcNewsWidget 4, BillingError 8, SnowPlayerPlugin player errors about 6) | 7 | 45 |

**What stays English, and why:**
- **Brand and product names.** Snow Media, Snow Media Center, SMC, "Snow Media Ent.", DreamStreams, VibezTV/Vibez, Plex, Overseerr, ExoPlayer, MPV, Fire TV, Android and Google TV, third-party app names, and codec labels (4K, HDR, Dolby, HEVC).
- **The Game Lounge.** That is `components/games`, `components/kids`, `Games.tsx`, `triviaQuestions.ts`, `gameSocket.ts` and the `games.*` keys; another chat owns them. The Home card "Kids Game Lounge" lives in Index.tsx, so its label does get translated.
- **Hub-authored content.** The news ticker, Store items, Posts (SnowMail), broadcast and app alerts, Support Videos titles, the update changelog in `update.json`, staff ticket replies and the AI knowledge base. The buttons, headings and messages around them do get translated.
- **Provider data.** Channel names, categories, Guide programme text, Live TV movie and series titles, demo data (`liveTvDemo.ts`) and the seasonal Plex titles in `halloween.ts`.
- **Things outside the app.** Emails (credentials, receipts), pushes, Telegram and Discord messages.
- **Things that are not display text.** Analytics event and column names, storage keys and error codes.
- **`CacheClearService.kt`.** It matches the words "Clear cache" in Android's own Settings screens. That follows the box's system language, not ours, so it must not change.
- **Dead code, skipped.** `AppManagement.tsx`, `KnowledgeManager.tsx` and `data/storeProducts.ts` are not imported anywhere.

## 2. Approach and conventions

**Locale files, one file per area.** Each area gets `src/i18n/locales/<lang>/<area>.json`, and its top-level key is the area name, e.g. `{ "plex": { … } }`. A builder in `src/i18n/index.ts` loads them with `import.meta.glob` and merges them deep into the single `translation` namespace. Call sites stay `t('plex.detail.play')`.
- Each work item creates its own new files, so the locale JSON never has merge conflicts.
- The existing `locales/<lang>.json` keeps only `games.*` for the Game Lounge chat. The core item moves `common`, `home` and `settings` out, unchanged.

**Lazy loading.** English is bundled with the app. Only the chosen other language (plus `games`) is loaded, from the APK before the first render: `main.tsx` awaits `i18nReady`, and falls back to English after 1.5 s. Set Vite `json.stringify: true` so the JSON parses faster on slow boxes.

**Key naming.**
- Keys are `<area>.<screen>.<element>` in camelCase. Toasts are `<area>.toast.<name>Title/Desc`; errors are `<area>.errors.<code>`.
- Keys ending in `Btn`, `Tab` or `Chip` count as short labels and get a length budget.
- `common.*` belongs to the core item and covers only true universals: OK, Cancel, Back, Close, Retry, Save, Delete, Yes, No, Loading…, Try again, Sign in, Sign out. Other items do not add to `common`.
- English text moves into the files word for word. That keeps the 32 test files that check English text passing unchanged.

**Plurals and inserted values.**
- Plurals use i18next's `_one`/`_other` endings.
- Arabic needs all six forms: `_zero`, `_one`, `_two`, `_few`, `_many`, `_other`.
- es and fr also carry `_many`, copied from `_other`, because newer rule data asks for it and older data does not.
- Values go in as `{{name}}`/`{{count}}`. Numbers and dates are formatted before they go in, not with i18next's built-in formatters.
- Never build a sentence from pieces. Use `<Trans>` for inline bold or links.

**Dates and times.** A new `src/i18n/format.ts` gives `formatTime`, `formatDate`, `formatDateTime`, `formatRelative`, `formatNumber` and `formatCurrency`.
- It keeps one cached Intl formatter per language, maps `ar` to `ar-u-nu-latn`, and uses `hour12: true` (both pending owner answers 2 and 4).
- `formatRelative` ("5 minutes ago") uses plural keys, because Chrome 66 has no `Intl.RelativeTimeFormat`.
- It replaces the 27 `formatDistanceToNow` calls from date-fns, the plain `toLocaleString`/`toLocaleDateString` calls on screen, and the `Intl.DateTimeFormat([])` calls.
- Leave the `'en-US'` + `timeZone` formatters in gameDay and the Guide alone. They do calculations, not display.

**Toasts and code outside React.**
- `src/lib/*` and hooks import the i18n instance and call `i18n.t()` at the moment of use. That is fine for toasts and thrown messages.
- Never call `t()` at the top of a module in constant arrays. Store a `labelKey` and translate when drawing the screen.
- A function whose result is stored (state, cache, storage) returns `{ key, params }` instead of text.
- Translated text is never used for logic: no comparing labels, no analytics names, no stored values.
- In long virtual lists (ChannelRow, Guide cells), translate in the parent, not once per row.

**Arabic, left to right.**
- `applyDocumentLang` sets `lang` only and always `dir="ltr"`. `lang` stays because it drives fonts and German hyphenation (`hyphens: auto`).
- The language picker in `Settings.tsx` (line 871) loses its `dir="rtl"` on the button and uses `dir="auto"` on the name only.
- One CSS rule, `html[lang="ar"] :is-free list: p, li, [data-i18n-block] { unicode-bidi: plaintext }`, puts punctuation on the right side in paragraph text. Buttons and layout are not mirrored.

**Android native text.** Recommendation: `res/values/strings.xml` plus `values-es`, `values-fr`, `values-de` and `values-ar`.
- New `AppLocale.kt` wraps a Context with the app's saved language (SharedPreferences), not the box's system language.
- The JS side saves the language on start and on every change, through a new `SnowNotify.setLanguage({lang})`.
- Why not pass the text from the app: scheduled recordings, restarts after a reboot, the recording notification and the alert poller all run while the WebView is dead.
- Notification channel names are re-registered when the language changes.
- Billing and player error messages go through `strings.xml` too, so the app shows them already translated.
- Native speech recognition gets `EXTRA_LANGUAGE`.

**Stable tests.**
- `src/test/setup.ts` imports `@/i18n`, removes `smc_lang` from storage, calls `changeLanguage('en')`, and sets `initAsync: false`.
- Existing English checks keep passing.

**Guard tests. Both are feasible.**
- `src/i18n/locales.parity.test.ts`: all 5 languages have the same keys in every area file; each file's top-level key equals its file name; no key is defined twice; the `{{placeholders}}` match; no empty values; plural forms are right per language; short labels (`Btn`/`Tab`/`Chip`) are at most English × 1.4 + 4 characters.
- `src/i18n/hardcoded.guard.test.ts`: uses the TypeScript compiler (already installed) to flag on-screen text in components, labels, placeholders, aria-labels and toast titles or descriptions.
  - It checks only folders listed in `src/i18n/guard/covered/<item>.txt`. Each work item adds its own file, so there are no conflicts.
  - It skips words on the do-not-translate list in `src/i18n/glossary.json`.
  - I tested the approach with a quick script and it works.

## 3. Translation work

I agree with your proposal:
- The coder agent who converts an area writes all four languages in short TV wording, using `glossary.json`: fixed terms for Live TV, Guide, Favorites, Record, Rewind and so on in each language, plus the do-not-translate list.
- A second agent per language then reviews every area file for native quality, as one pass after the build items: 4 reviewers, one per language, running in parallel.

**Text too long for TV buttons at 960x540:**
- The length-budget test catches it first.
- Translators may add a `…Short` variant.
- Buttons get `min-w-0 truncate` plus the full text on focus. Cards may wrap to 2 lines.
- Never shrink the font. German is the worst case, about 30% longer.

## 4. Work items (each in its own worktree off main)

| # | Item | Owns (files) | Locale files (×5 languages) |
|---|---|---|---|
| 0 | **Core. Done first, alone.** | `src/i18n/index.ts` (builder, lazy loading, Arabic LTR, `getAppLanguage()`), `src/i18n/format.ts` (new), `src/i18n/nativeLanguage.ts` (new, placeholder hook for item 10), `src/i18n/glossary.json` (new), both guard tests (new), `src/test/setup.ts`, `src/main.tsx` (await ready), `vite.config.ts` (`json.stringify`), `src/index.css` (Arabic paragraph rule), language picker in `Settings.tsx`, move existing keys out of `<lang>.json` | `common`, and seeds `home`, `settings` |
| 1 | Home, Settings, popups, Updater | `pages/Index.tsx`, `pages/NotFound.tsx`, HomeClock, MediaBar, MediaBarPrompt, NewsTicker (its frame only), WelcomePopup, `Settings.tsx`, AppAlertDialog, BroadcastAlertPopup, PreEventStepsDialog, `useAppAlerts`/`usePreEventAlert`/`useMediaAssets`, `utils/edgeFunctions`, `utils/network`, `lib/contentBar`, AppUpdater, AutoUpdatePrompt, DownloadProgress, `utils/updateCache`, `utils/downloadApk` | `home`, `settings`, `popups`, `updater` |
| 2 | Live TV A | `LiveTV.tsx`, `livetv/`: LiveSection, ChannelRow, liveBar, PlayerControlBar, PlaybackScreen, MultiScreenSection, LiveLayout*, LayoutTrialPrompt, PlayerModeChooser, PlayerServerAlertDialog, PreBufferIndicator, KidsAskGrownUp, ReportChannelDialog, MoviesSection, SeriesSection, VideoPlayer, PosterCard; `lib/xtream`, `lib/kidsFilter`, `lib/liveLayout`, `lib/playerNudge`, PlayerNudgeDialog, `hooks/useMultiScreenPlayers`, `useNativePlayer`, `usePlayerServerAlert` | `live` |
| 3 | Live TV B | GuideSection, GameDaySection, `GameReminderHost.tsx`, RecordDialog, RecordingsScreen, RewindSettingsScreen, SettingsHub, AccountInfo/Appearance/Backups/HideCategories/SwitchAccount screens, CredentialsForm, ClaimAccountCard, ExpirationNoticeDialog, RenewQR, PlayerAccountCard; `lib/gameDay`, `gameReminders`, `liveRewind`, `recording`, `recordSchedule`, `lineEmail`, `hooks/useLiveRewind` | `guide`, `gameDay`, `recordings`, `liveAccount` |
| 4 | Plex | Every `livetv/Plex*` file, PlayerStatsPanel, BufferingDiagnostics, OverseerrRequestPanel, EpisodeAutoplay, `RequestReadyDialog.tsx`, `lib/plex*.ts` **except `plex.ts`**, `lib/bufferDiagnostics`, `lib/overseerr`, `hooks/usePlexAuth` | `plex` |
| 5 | Support and tickets | `Support.tsx`, `SupportTicketSystem`, `support/*`, SnowMailPanel/Reader, DeviceCleaner, SpeedTest, SupportVideos, RemoteSupport, `hooks/useSupportTickets`, `useSnowMail`, `useUnreadTickets`, `lib/snowMail`, `lib/supportAttachments` | `support`, `tickets`, `cleaner`, `remoteHelp` |
| 6 | AI, voice, guides | ChatCommunity, CommunityChat, AIConversationSystem, FreeAiBlockedDialog, `voice/*`, VoiceInput, BufferingGuide, HowToGuide, TutorialArt, `data/tutorialContent`, `lib/kidsAiNotice`, `lib/appActions`, `lib/voiceUi`, `hooks/useAIConversations`; **adds `language: getAppLanguage()` to the 3 `snow-media-ai` calls** | `ai`, `voice`, `guides` |
| 7 | Account and billing | `billing/*`, UserDashboard, UserServicesEditor, QRCheckoutDialog, Giveaway, GiveawayPromoPopup, GiveawayWinnersPopup, CreditStore, ServiceExpirationBanner, `lib/billing`, `lib/aiTiers`, `lib/accountClaim` | `account`, `billing`, `giveaway` |
| 8 | Auth and Profiles | `pages/Auth`, ClaimAccount, QRLogin, SsoConsume, Welcome, QRCodeLogin, AccountChooser, `getstarted/*`, `profiles/*`, `lib/profilesUi`, `hooks/useAuth` | `auth`, `getStarted`, `profiles` |
| 9 | Apps, Store, Phone remote | InstallApps, PinnedAppsPopup, AppContextMenu, RetiredAppDialog, `lib/retiredApps`, StoreScreen, `lib/store`, `remote/*`, `lib/phoneRemote`, `web/phone-remote/PhoneRemotePage.tsx` (language from `?lang=` in the QR link; its own small dictionary, since it is a separate page) | `apps`, `store`, `phoneRemote` |
| 10 | **AI and Plex language, native text** | `supabase/functions/snow-media-ai/index.ts`: use `body.language` when it is one of the 5, otherwise keep today's Spanish/English detection, which stays compatible with old app builds; the sign-in refusal messages come from a small table in 5 languages. `src/lib/plex.ts`: `X-Plex-Language` in `plexHeaders()` for API calls only, stream-URL parameters unchanged, plus its 12 strings. `src/capacitor/*`: `SnowNotify.setLanguage`, and a language for `AppManager` speech recognition. `src/i18n/nativeLanguage.ts` filled in. Kotlin: `AppLocale.kt` (new), `strings.xml` plus `values-es/fr/de/ar/strings.xml` (new), RecordingService, RecordScheduler, AlertNotifier, AlertPollWorker, SmcNewsWidget, BillingError, SnowPlayerPlugin error text, SnowNotifyPlugin, AppManagerPlugin (`EXTRA_LANGUAGE`) | `plexApi` |
| 11 | **Final sweep. Last, after the reviewers.** | Every area listed in the guard tests; ask the owner whether the admin screens are in; fix what the sweep finds; Playwright screenshots at 960x540 in es and ar (demo mode, `smc_lang` preset) of every screen in the checklist; a test-only fake language that dresses translated text in marked brackets, so any leftover English stands out in screenshots; tracker update | none (fixes only) |

Items 1 to 10 run in parallel after item 0 merges. Then the 4 language reviewers run, then item 11. No file appears in two items. Item 6 adds only the `language` field to the AI requests; item 10 owns the edge function.

**Owner steps:**
- Redeploy `snow-media-ai` through Lovable. It is safe in either order: an old app without `language` behaves as today.
- Publish the phone remote page wherever snowmediaent.com/remote is hosted.
- Kotlin can't be compiled here, so the Mac build is the first real compile of item 10.

**Plex, stated honestly.** `X-Plex-Language` translates the server's own row names ("Recently Added", "Continue Watching") and some tags. Titles and summaries come in whatever metadata language the Plex server's owner set for each library. The app cannot change that, so on English-language servers titles will stay English.

## 5. Ready-to-test checklist for the owner (switch to Español in Settings → UI → Language)
1. **Home.** Card names and descriptions, the date and clock, the top-bar buttons, the "Recommended" heading and "press back again to exit" are all Spanish. News ticker text stays as the Hub wrote it.
2. **Settings.** Every tab, switch and description is Spanish. Switch back to English and everything returns without restarting.
3. **Live TV.**
   - The section menu, player bar and its button names, the Record and report-a-channel dialogs, and Live TV settings are Spanish.
   - The Guide shows day and time labels in Spanish. Game Day and Recordings (Scheduled/Missed) are Spanish.
   - Channel, category and programme names stay as the provider sends them.
4. **Recording notification.** Start a recording and press Home: the Android notification is in Spanish. Schedule one, reboot the box, and the "missed/late" notice is in Spanish.
5. **Plex.** Menus, the detail screen, player overlay, stats panel and sign-in screen are Spanish. Row names change if the server supports Spanish; titles follow the server's own language.
6. **Support.** Tickets, Device Cleaner, Speed Test, Remote Access, Posts, the Buffering Guide and How to Use SMC are all Spanish.
7. **AI chat.** Type a question in English: the answer comes back in Spanish. Try the voice assistant too.
8. **Store and Main Apps.** Buttons and headings are Spanish. Store items and app names stay as they are.
9. **Other screens.** Dashboard and billing, sign-in and the "get started" screens, Who's Watching and profile editing, and the phone remote are Spanish; the phone page follows the TV's language after scanning the QR. Pop-ups, error messages and the updater screen are Spanish too.
10. **Arabic.** Repeat a few of the above in العربية:
    - Text is Arabic, but the screens are not flipped: menus stay where they were and the arrows work the same.
    - Numbers show as 0-9.
    - No empty boxes appear in place of letters.
11. **Language per profile.** A profile keeps its own language after a profile switch. English is the default for a new box.

## 6. Risks
- **Chrome 66.** There is no `Intl.RelativeTimeFormat`, `ListFormat`, `dateStyle`/`timeStyle`, `Intl.Locale` or `DisplayNames`. `format.ts` avoids all of them; the guard also rejects them in covered folders. `Intl.PluralRules` (Chrome 63+) and dynamic `import()` (63+) are fine.
- **Missing Arabic font.** Montserrat and Nunito have no Arabic letters, so the box's system Arabic font is used. If any box shows empty boxes, bundle a small Noto Sans Arabic font loaded only when `lang=ar`.
- **Text overflow at 960x540**, German especially. The budget test, truncation plus text on focus, and the item-11 screenshots cover it.
- **Low memory.** All 5 languages loaded at once would be about 1 MB parsed on every boot. Lazy loading keeps English plus one language in memory.
- **Stale text after a switch.** Anything translated at module load, or inside a `useMemo([])`, keeps the old language. The rule and code review cover it. Profile switches already reload the app.
- **Plural rule data differs between the box and tests.** Node has newer rules than Chrome 66 (the fr/es `_many` form). Adding `_many` to fr/es handles it.
- **The Game Lounge chat edits the same `<lang>.json`.** Tell that chat that after item 0 the file holds `games.*` only. Its 25 missing `games.slots.*` translations are theirs to fill.
- **Kids profiles.** App screens will be Spanish while the Lounge stays English. That is expected; mention it to the owner.
- **Kotlin compiles only on the owner's Mac.** Item 10 is the riskiest build, so bump `versionCode` and test recording and alerts first.
- **Customers type in one language and chose another.** With the language chosen in the app, the assistant always answers in that language even if the question was typed in another. That matches the owner's instruction.
- **Scale.** About 16,000 translated strings is a large review. Quality comes from the glossary plus a native-quality reviewer per language. Admin screens left in English (question 1) shrink it.

## Tests
- **New:** `src/i18n/locales.parity.test.ts`, `src/i18n/hardcoded.guard.test.ts`, `src/i18n/format.test.ts` (each language, Arabic 0-9 digits, 12-hour clock), and a test that loading and switching language keeps `dir="ltr"`.
- **Edge function:** a `snow-media-ai` language-choice test under `src/test/edge/`.
- **Updated:** `src/test/setup.ts`.
- **Existing:** the 32 test files that check English text should pass unchanged, because English moves across word for word. Coders run the full `npx vitest run` after each item.

No code was changed. I used one throwaway scanning script, only in the scratchpad.