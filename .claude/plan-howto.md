# Plan: rebuild "How to use SMC" with real screenshots and labelled highlights

## Plain-English summary

Today every slide shows grey boxes with a gold ring and no words. The new guide will show:

- a **real picture of the screen** in the customer's own language;
- the part to look at **lit up** (the rest dimmed) with a **gold ring**;
- a **short label** next to each lit area ("Favorites", "Hold OK here"), numbered 1-2-3 when there is more than one;
- a small **remote hint** where it helps ("Hold OK").

The chapters are rewritten to cover the app as it is today: Home, the remote, Live TV (sign-in, several services, the hold-OK menu, the player bar, rewind, recording, the Guide, Game Day), Plex (VOD), Main Apps, the Store, Support, the Dashboard and Settings. There is a new slide on changing the language.

The pictures are not taken by hand. A script opens the app in a browser with demo data, drives it with the "remote" (key presses) and takes the pictures. It measures where each lit area is on the screen, so the rings always land in the right place. It does this for all 5 languages (en, es, fr, de, ar), because longer words move things around. If a picture is missing in one language, the guide shows the English one. If there is no picture at all, it shows the old drawing.

The pictures ship inside the APK: 48 pictures × 5 languages ≈ **9 MB**. Only the picture on screen is loaded.

Nothing changes on the box outside the guide. The capture helpers exist only in the developer build (`import.meta.env.DEV`) and are removed from the APK and the website.

---

## Questions for the owner (details in "Owner decisions" at the end)

1. APK grows by about 9 MB for pictures in 5 languages at 1024×576. Recommended: yes.
2. Posters in the pictures: made-up titles with drawn artwork, no real movie posters. Recommended: made-up.
3. In-app billing ("My Account" in Live TV Settings, Buy a plan): leave it out of the guide this round? Recommended: leave out until it's on for customers.

---

## 1. Shared contract (item 0, done by the orchestrator before the coders start)

The orchestrator commits these 3 files to main. Every worktree branches from that commit, so each item compiles on its own.

### 1a. `src/data/howtoContract.ts` (new)

The single list of shots and highlight ids. It changes only through the orchestrator.

```ts
export const HOWTO_LANGS = ['en', 'es', 'fr', 'de', 'ar'] as const;
export type HowtoLang = (typeof HOWTO_LANGS)[number];
export type RemoteHint = 'ok' | 'holdOk' | 'back' | 'upDown' | 'leftRight';
/** Drawn in code (no screenshot): only 'remote'. */
export const HOWTO_DIAGRAMS = { remote: ['remote.arrows', 'remote.ok', 'remote.back', 'remote.home', 'remote.mic'] } as const;
export const HOWTO_SHOTS = { /* table 1c, shot id -> readonly highlight ids */ } as const;
export type ShotId = keyof typeof HOWTO_SHOTS | keyof typeof HOWTO_DIAGRAMS;
export interface HowtoHighlight { id: string; labelKey: string }      // id must be in the shot's list
export interface HowtoArt { shot: ShotId; highlights?: HowtoHighlight[]; remote?: RemoteHint } // 0-3 highlights
/** [left, top, width, height] in percent of the frame, 2 decimals. */
export type ShotRect = [number, number, number, number];
export interface HowtoRectsFile {
  version: 1; width: 1024; height: 576;
  langs: Partial<Record<HowtoLang, Record<string, { bytes: number; rects: Record<string, ShotRect> }>>>;
}
export const HOWTO_IMAGE_DIR = 'howto';       // public/howto/<lang>/<shot>.webp
export const HOWTO_ATTR = 'data-howto';        // DOM hook: data-howto="<highlight id>"
```

### 1b. `src/data/howtoRects.json` (new) and `src/components/howto/HowtoShot.tsx` (new stub)

- `howtoRects.json`: `{ "version": 1, "width": 1024, "height": 576, "langs": {} }`.
- `HowtoShot.tsx`:
  `export interface HowtoShotProps { art: HowtoArt; titleKey?: string }`
  `export default function HowtoShot(_p: HowtoShotProps) { return null; }`

### 1c. Shots and highlight ids

- A highlight id is a DOM hook: `data-howto="<id>"` on the element. Several elements with the same id are measured as one box (their union).
- "stage" means the shot is drawn by the dev-only stage page (section 3), because the web build can't show it (native player, recorder, Multi-Screen).
- "over X" means the stage draws the dialog over the picture of shot X.

| Shot id | How it's reached | Highlight ids |
|---|---|---|
| home | Home, focus on Live TV card | home.clock, home.profile, home.dashboard, home.settings, home.voice, home.ticker, home.recommended, home.cards, home.cardLivetv, home.cardPlex, home.cardSupport, home.cardStore |
| home-bar | Home, focus in Recommended (2nd tile) | home.recommended, home.recTile, home.recArrows, home.recDots |
| settings-remote | Settings → Phone Remote | set.remoteQr, set.remoteCode, set.remoteSteps |
| live-signin | stage (CredentialsForm) | signin.username, signin.password, signin.submit, signin.note |
| live-layout | Live TV, first visit (layout chooser) | live.layoutCards |
| live-list | Live TV, Classic, 2 services, "Sports" category, channel 2 focused | live.back, live.updateChannels, live.settingsBtn, live.sections, live.lineGroup, live.categories, live.favorites, live.searchBtn, live.recordingsBtn, live.channels, live.preview, live.nowNext |
| live-search | Live TV, Search open, "sum" typed | live.searchBox, live.channels |
| live-holdmenu | stage over live-list (ReportChannelDialog with Record row) | menu.favorite, menu.report, menu.record |
| live-report | stage, same dialog on "Report a problem" | report.reasons |
| live-player | stage (PlayerControlBar: rewind + record on, focus Record, 45 s behind) | bar.root, bar.channel, bar.timeline, bar.prev, bar.rew, bar.play, bar.fwd, bar.golive, bar.next, bar.rec, bar.report, bar.cc, bar.audio, bar.vol, bar.label |
| live-record | stage over live-list (RecordDialog) | rec.length, rec.saveTo, rec.start |
| guide | Live TV → Guide | guide.categories, guide.channels, guide.grid |
| guide-record | stage over guide (RecordDialog, programme mode) | rec.programmes, rec.start |
| recordings | stage over live-list (RecordingsScreen) | recs.list, recs.scheduled, recs.drive |
| gameday | Live TV → Game Day | gd.chips, gd.game, gd.remind |
| gameday-game | Game Day, first game opened | gd.links, gd.serviceTag, gd.picked, gd.down, gd.unconfirmed, gd.holdHint |
| multi | stage (Multi-Screen layout picker) | multi.layouts |
| backups | Live TV → Backups | backups.list, backups.refresh |
| vod | Live TV → VOD | vod.categories, vod.grid |
| live-settings | Live TV → Settings (hub menu) | hub.switch, hub.hideCats, hub.appearance, hub.rewind, hub.signOut |
| plex-connect | stage (PlexAuthScreen, signed out, line saved) | plexauth.connect, plexauth.ownServer |
| plex-link | stage (PlexAuthScreen, link code) | plexauth.code, plexauth.url |
| plex-home | Plex card → Plex Home | plex.menu, plex.continue, plex.recent |
| plex-discover | Plex → Discover | plex.discover |
| plex-search | Plex → Search, "star" typed | plex.searchBox, plex.results |
| plex-detail | Plex, a movie with 2 versions | detail.play, detail.myList, detail.version, detail.cast |
| plex-player | stage (PlexPlayerOverlay, Skip Intro prompt, controls shown) | pp.skip, pp.seek, pp.controls, pp.subs, pp.audio |
| plex-upnext | stage (Up next prompt) | pp.upNext |
| plex-subs | stage (Subtitles menu open) | pp.getSubs |
| plex-audio | stage (Audio menu open) | pp.fixAudio |
| apps | Support → Main Apps | apps.grid |
| apps-detail | Main Apps, OK on an app | apps.download |
| store | Home → Store | store.grid |
| gems | Dashboard → Snow Gems (view `credits`) | gems.packs, gems.qr |
| dashboard | Home → Dashboard (demo signed-in user) | dash.player, dash.services, dash.gems, dash.games, dash.signOut |
| support-help | Support, Help tab | sup.helpTab, sup.aiTab, sup.postsTab, sup.howto, sup.speed, sup.guide, sup.videos, sup.tickets, sup.remote, sup.cleaner, sup.apps |
| support-ai | Support, AI Chat tab | ai.input |
| support-posts | Support, Posts tab | posts.list |
| voice | Home, voice panel open (listening) | voice.mic |
| tickets | Support → Submit a Ticket | tickets.new, tickets.list |
| speedtest | Support → Speedtest (before Start) | speed.start |
| buffering | Support → Buffering Guide, step 1 | bg.steps |
| videos | Support → Support Videos | videos.grid |
| settings-ui | Settings → UI (top) | set.tabs, set.updatesTab, set.contentBar, set.postNotify, set.alerts |
| settings-language | Settings → UI, scrolled to Language, current language focused | set.language |
| settings-media | Settings → Media Manager | set.wallpaper |
| profiles-pick | "Who's watching?" (Me, Sam, Kids profile with PIN) | prof.list, prof.kids, prof.manage |
| profile-edit | Manage profiles → edit the Kids profile | prof.kidsLevel, prof.pinBtn |

That makes 48 screenshots and 1 diagram. If a shot's highlights can't all be on screen at once, the coder tells the orchestrator, who changes this table (for example by splitting the shot).

### 1d. Text keys (all in `guides.json`, 5 languages)

- Slide text: `guides.howTo.<chapterId>.<slideId>.title | line2 | linkBtn`.
- Chapter: `guides.howTo.<chapterId>.title | subtitle`.
- Labels: `guides.howTo.labels.<labelId>`, at most 26 characters in every language.
- Remote hints: `guides.howTo.remote.<RemoteHint>` (ok "Press OK", holdOk "Hold OK", back "Press Back", upDown "Up / Down", leftRight "Left / Right").
- The general keys stay: `guides.howTo.title`, `pickTopic`, `slideCount_*`, `slideOf`, `doneBtn`, `nextBtn`. `guides.buffering` is not touched.
- The old `guides.howTo.<chapter>.s0..s6` keys are removed.

---

## 2. Chapters and slides (item C writes them; English is final wording, TV-short)

Rules:
- Chapter ids `basics`, `livetv`, `movies`, `apps`, `support`, `account` and `extras` stay, because analytics `tutorial_chapter` / `tutorial_complete` report them. New ids: `watching`, `recording`, `gameday`.
- Deep-link kinds stay `view` / `event` / `player` (live|movies) with the same Kids rules.
- Every slide has `art`.
- Format: `slideId` · shot · highlights (labelId = "label") · remote · link · **title** / line2.

**basics** — "The Basics" / "Your remote, your phone and Home"
- `remote` · remote · remote.arrows (move="Move"), remote.ok (okHold="OK · hold for more"), remote.back (back="Back") · — · — · **Arrows move. OK picks. Back goes back.** / Hold OK on a channel or a title for more options. You can't break anything.
- `phone` · settings-remote · set.remoteQr (scanPhone="Scan with your phone"), set.remoteCode (orCode="Or type this code") · — · view settings "Take me there" · **Use your phone as a remote.** / Settings → Phone Remote. Scan, then pick Allow on the TV. Your phone can type and talk too.
- `home` · home · home.cardLivetv (liveTv="Live TV"), home.cardPlex (plexVod="Movies & shows"), home.cardSupport (help="Help") · — · — · **This is Home.** / The big buttons: Live TV, Plex (VOD), Support and the Store.
- `topbar` · home · home.clock (dateTime="Date & time"), home.profile (whoWatching="Who's watching"), home.settings (settings="Settings") · upDown · — · **Top right: the date, the time and your buttons.** / Press Up from the big buttons to reach them.
- `dashVoice` · home · home.dashboard (dashboard="Dashboard"), home.voice (voice="Voice") · — · — · **Dashboard is your account. Voice lets you talk to SMC.** / Not signed in? The button says Sign In.
- `ticker` · home · home.ticker (news="News") · — · — · **The scrolling strip is news from Snow Media.** / Deals, updates and heads-ups.
- `recommended` · home-bar · home.recTile (okPlays="OK plays it"), home.recArrows (more="More"), home.recDots (pages="Pages") · leftRight · — · **Recommended: what's on and what to watch.** / Press Up from the big buttons. Left and Right scroll; the dots show the page.

**livetv** — "Live TV" / "Sign in, channels and favorites"
- `open` · home · home.cardLivetv (liveTv) · ok · player live "Take me there" · **Open Live TV from Home.** / It opens where you left off.
- `signin` · live-signin · signin.username (username="Username"), signin.password (password="Password"), signin.submit (signIn="Sign in") · — · — · **First time? Sign in with the details from your seller.** / Email usernames connect to Vibez; all others to DreamStreams.
- `services` · live-list · live.lineGroup (yourServices="Your services") · — · — · **More than one service? They all show in one list.** / Add one under Live TV Settings → Switch Account. Each has its own heading.
- `layout` · live-layout · live.layoutCards (pickOne="Pick one") · leftRight · — · **Pick your look: Classic, Compact or Vibez.** / Live TV asks the first time. Change it in Live TV Settings → Appearance.
- `menu` · live-list · live.sections (menu="Menu") · — · — · **The menu on the left: Live TV, Guide, Game Day, VOD, Multi-Screen, Backups.** / Press Left to reach it.
- `categories` · live-list · live.categories (categories="Categories"), live.favorites (favorites="Favorites"), live.channels (channels="Channels") · — · — · **Pick a category, then a channel.** / Favorites is at the top of the categories.
- `preview` · live-list · live.preview (preview="Preview"), live.nowNext (whatsOn="What's on") · ok · — · **Rest on a channel and it plays in the preview. OK goes full screen.** / In the Vibez look, OK plays right away.
- `search` · live-search · live.searchBox (typeHere="Type here"), live.channels (results="Results") · — · — · **Search finds any channel.** / Open Search above the list and type the name, or just use Voice.
- `holdMenu` · live-holdmenu · menu.favorite (favorite="Favorite"), menu.report (report="Report"), menu.record (record="Record") · holdOk · — · **Hold OK on a channel for its options.** / Add it to Favorites, report a problem, or record it.
- `report` · live-report · report.reasons (whatsWrong="Pick what's wrong") · — · — · **Reports come straight to Snow Media.** / Channel down, buffering, no audio or other. ⚠️ shows while we fix it.

**watching** — "Live TV: watching" / "The player bar, VOD, Multi-Screen, settings"
- `bar` · live-player · bar.root (playerBar="Player bar"), bar.label (buttonName="Button name") · ok · — · **While watching, OK shows the player bar.** / Left and Right move along it. The name shows under each button. Back hides it.
- `channels` · live-player · bar.prev (chDown="Channel −"), bar.next (chUp="Channel +") · upDown · — · **Up and Down change the channel.** / Or use the channel buttons on the bar.
- `barButtons` · live-player · bar.report (report), bar.cc (subtitles="Subtitles"), bar.audio (audio="Audio") · — · — · **Report, Subtitles and Audio are on the bar too.** / Greyed out when the channel has no choice.
- `top` · live-list · live.updateChannels (updateChannels="Update Channels"), live.settingsBtn (settings) · — · — · **At the top: Update Channels and Settings.** / Update Channels gets the newest list from your service.
- `settings` · live-settings · hub.switch (switchAccount="Switch Account"), hub.hideCats (hideCategories="Hide Categories"), hub.appearance (appearance="Appearance") · — · — · **Live TV Settings** / Account info, switch service, hide categories, the look, rewind and sign out.
- `vod` · vod · vod.categories (categories), vod.grid (movies="Movies") · — · — · **VOD: your service's movies.** / Pick a category, OK on a poster, then Play Movie.
- `multi` · multi · multi.layouts (pickLayout="Pick a layout") · — · — · **Multi-Screen plays 2 or 4 channels at once.** / The sound follows the screen you highlight. Each screen uses one stream of your plan.
- `backups` · backups · backups.list (backups="Backup streams"), backups.refresh (refresh="Refresh") · — · — · **Channel down? Try Backups.** / Streams posted by Snow Media. Press Refresh if something was just added.

**recording** — "Guide, rewind & recording" / "Go back, record, schedule"
- `guide` · guide · guide.categories (categories), guide.channels (channels), guide.grid (nowNext="Now & next") · — · — · **The Guide shows what's on now and next.** / OK on a channel plays it. Favorites come first.
- `rewind` · live-player · bar.rew (back10="Back 10s"), bar.timeline (howFar="How far back"), bar.golive (goLive="Go live") · — · — · **Missed something? Back 10s rewinds live TV.** / Go live jumps back to now. It needs a free stream on your plan, or a channel with catch-up.
- `record` · live-record · rec.length (howLong="How long"), rec.saveTo (saveTo="Where to save"), rec.start (start="Start") · holdOk · — · **Record from the bar, or hold OK on a channel → Record…** / Pick how long and where: this box or a USB drive.
- `schedule` · guide-record · rec.programmes (pickShow="Pick a show"), rec.start (recordIt="Record it") · holdOk · — · **Hold OK in the Guide to record a show later.** / A red dot marks shows that will record.
- `recordings` · recordings · recs.list (yourRecordings="Your recordings"), recs.scheduled (scheduled="Scheduled"), recs.drive (freeSpace="Free space") · ok · — · **Recordings: the button above the channel list.** / OK on one to play, rename or delete it.
- `settings` · live-settings · hub.rewind (rewindSettings="Rewind & recording") · — · — · **Rewind & recording settings** / Max rewind, and start early / end late for shows you schedule.

**gameday** — "Game Day" / "Today's big games and where they're on"
- `list` · gameday · gd.chips (leagues="Leagues"), gd.game (todaysGames="Today's games") · — · — · **Game Day lists today's big games.** / Live TV → Game Day. OK on a game shows where it's on.
- `links` · gameday-game · gd.links (whereOn="Where it's on"), gd.serviceTag (whichService="Which service") · ok · — · **Each channel says which service it's on.** / "On DreamStreams" or "On Vibez". OK plays it.
- `picked` · gameday-game · gd.picked (ourPick="Picked by Snow Media"), gd.down (reportedDown="⚠️ Reported down") · — · — · **"Picked by Snow Media" is our pick.** / ⚠️ means someone reported it down, so it's listed last.
- `unconfirmed` · gameday-game · gd.unconfirmed (mayNotHave="May not have it") · — · — · **"Not confirmed by the guide" may not show this game.** / Try the channels above it first.
- `report` · gameday-game · gd.holdHint (holdToReport="Hold OK to report") · holdOk · — · **Channel not working? Hold OK on it to report it.** / Reports come straight to Snow Media.
- `remind` · gameday · gd.remind (remindMe="Remind me") · — · — · **Remind me pops up on the TV when the game starts.**

**movies** — "Plex (VOD)" / "Movies & shows"
- `open` · home · home.cardPlex (plexVod) · ok · player movies "Take me there" · **Open Plex (VOD) from Home.** / Your service's Movies and Series are in the same menu.
- `connect` · plex-connect · plexauth.connect (pressThis="Press this") · ok · — · **Signed into Live TV? Plex connects by itself.** / If asked, press Connect with Live TV. No Plex account needed.
- `code` · plex-link · plexauth.code (yourCode="Your code"), plexauth.url (goHere="Go here on your phone") · — · — · **Run your own Plex server? Link it with a code.** / Only for your own server. Snow Media members don't need it.
- `menu` · plex-home · plex.menu (menu) · — · — · **The menu: Home, Discover, your libraries, Search, Request.** / Hold OK on a library to hide it.
- `home` · plex-home · plex.continue (continueWatching="Continue Watching"), plex.recent (newArrivals="New") · — · — · **Home shows what you were watching and what's new.**
- `discover` · plex-discover · plex.discover (ideas="Ideas") · — · — · **Not sure what to watch? Try Discover.** / Hidden Gems, Surprise Me, genres and decades.
- `search` · plex-search · plex.searchBox (typeOrTalk="Type or talk"), plex.results (results) · — · — · **Search finds any movie or show.** / Not there? Request it.
- `detail` · plex-detail · detail.play (play="Play"), detail.myList (myList="My List"), detail.cast (cast="Cast") · ok · — · **OK on a poster opens its page.** / Play or Resume, add it to My List, or browse episodes.
- `versions` · plex-detail · detail.version (version="Version") · leftRight · — · **Some titles come in more than one version.** / 4K or 1080p: pick the one that plays best on your internet.
- `controls` · plex-player · pp.controls (controls="Controls"), pp.seek (seekBar="Seek bar") · ok · — · **OK shows the controls.** / Up goes to the seek bar. Left and Right jump.
- `skip` · plex-player · pp.skip (skipIntro="Skip Intro") · ok · — · **Skip Intro shows at the start of an episode.** / Press OK to skip it.
- `next` · plex-upnext · pp.upNext (nextEpisode="Next episode") · ok · — · **Up next plays the next episode.** / OK plays it now. Back keeps watching.
- `subs` · plex-subs · pp.getSubs (getSubs="Get subtitles") · — · — · **Need subtitles? Open Subtitles → "Get subtitles…".**
- `audio` · plex-audio · pp.fixAudio (fixAudio="Fix audio") · — · — · **No sound? Open Audio → Fix audio.** / It fixes the sound without restarting.

**apps** — "Main Apps & Store" / "Get apps and devices"
- `where` · support-help · sup.apps (mainApps="Main Apps") · — · view apps "Take me there" · **Main Apps is in Support.** / Every extra app you might need, in one safe place.
- `pick` · apps · apps.grid (apps="Apps") · ok · — · **Pick an app and press OK.**
- `download` · apps-detail · apps.download (download="Download") · — · — · **Press Download to install it.** / Already installed? It says Launch.
- `store` · store · store.grid (products="Products") · — · view store "Take me there" · **The Snow Media Store.** / Pick something, then scan the code with your phone to buy it there.

**support** — "Support" / "Help, AI Chat and Posts"
- `tabs` · support-help · sup.helpTab (help), sup.aiTab (aiChat="AI Chat"), sup.postsTab (posts="Posts") · — · — · **Support has three tabs: Help, AI Chat and Posts.**
- `ai` · support-ai · ai.input (askAnything="Ask anything") · — · — · **AI Chat answers right away, and can do things for you.** / Open a screen, report a channel, install an app, make a wallpaper.
- `voice` · voice · voice.mic (talkNow="Talk now") · — · — · **Voice: the mic on Home, or your remote's mic button.** / Say a channel, a movie, or "open the Guide".
- `tickets` · tickets · tickets.new (newTicket="New ticket"), tickets.list (yourTickets="Your tickets") · — · event support:open-tickets "Open tickets" · **Submit a Ticket reaches a real person.** / A number shows on the Support button when we reply.
- `speed` · speedtest · speed.start (start) · ok · — · **Speedtest checks your internet.** / About 25 Mb/s or more is good for 4K.
- `buffering` · buffering · bg.steps (steps="Steps") · — · event support:open-buffering-guide "Open it" · **TV keeps pausing? The Buffering Guide walks you through the fixes.**
- `videos` · videos · videos.grid (videos="Videos") · — · — · **Support Videos: short how-to videos.**
- `posts` · support-posts · posts.list (posts) · — · event support:open-posts "Open Posts" · **Posts: news and deals from Snow Media.** / New ones are marked New. Links become a code to scan.
- `more` · support-help · sup.remote (remoteAccess="Remote Access"), sup.cleaner (cleaner="Device Cleaner") · — · event support:open-cleaner "Open the cleaner" · **Remote Access and Device Cleaner.** / A technician can fix your box live. The cleaner frees space and memory.

**account** — "My Account & Snow Gems" / "Dashboard, gems, sign out"
- `dashboard` · dashboard · dash.player (liveAccount="Live TV account"), dash.services (devices="Devices & services") · — · view user "Take me there" · **The Dashboard: your account on one screen.** / Open it with Dashboard at the top of Home.
- `gems` · dashboard · dash.gems (snowGems="Snow Gems") · — · — · **Snow Gems pay for Premium AI and Image Gen.**
- `buyGems` · gems · gems.packs (pickPack="Pick a pack"), gems.qr (scanToPay="Scan to pay") · — · view credits "Take me there" · **Buy gems: pick a pack and scan the code with your phone.** / They land on your account by themselves.
- `signOut` · dashboard · dash.signOut (signOut="Sign Out") · — · — · **Sign Out is on the Dashboard.** / It signs this box out of your Snow Media account and Live TV.
- `lounge` · dashboard · dash.games (gameLounge="Game Lounge") · — · view games "Open the lounge" · **The Game Lounge: cards, slots, trivia and the Daily Spin.** / Play for Snow Coins. Never real money.

**extras** — "Settings" / "Language, looks and profiles"
- `language` (new) · settings-language · set.language (language="Language") · — · view settings "Take me there" · **Change the language: Settings → UI → Language.** / Every screen and button changes, and so do the AI's answers, Live TV and Plex. Channel and show names come from your service and stay as they are.
- `wallpaper` · settings-media · set.wallpaper (wallpaper="Wallpaper") · — · — · **Change your wallpaper in Settings → Media Manager.** / Upload your own, or describe one and AI makes it.
- `switches` · settings-ui · set.contentBar (recommendedRow="Recommended row"), set.postNotify (postAlerts="Post alerts"), set.alerts (serviceAlerts="Service alerts") · — · — · **Settings → UI has the switches.** / The Recommended row, Large dashboard, and alerts.
- `profiles` · profiles-pick · prof.list (profiles="Profiles"), prof.manage (manage="Manage") · — · — · **Everyone can have their own profile.** / Their own Continue Watching, My List and favorites. Switch with the profile button on Home.
- `kids` · profile-edit · prof.kidsLevel (ageLevel="Age level"), prof.pinBtn (pin="PIN") · — · — · **Kids profiles only show what fits their age.** / Add a PIN so kids can't open the grown-up profiles.
- `updates` · settings-ui · set.updatesTab (updates="Updates") · — · — · **Update available? Settings → Updates installs it.** / Home shows "Update available" under the clock.

Dropped: "Saved Accounts" (no longer in Settings; its job is Live TV → Switch Account) and the Player engine (customers only have ExoPlayer; MPV is test builds only).

---

## 3. Item A: DOM hooks + the capture-only app side

Owns the app components listed below, plus `src/lib/demoMode.ts`, `src/App.tsx`, `src/capacitor/SnowRecorder.ts`, `src/data/liveTvDemo.ts` and the new `src/howto/`.

1. **Capture flag.** In `src/lib/demoMode.ts`, add `isHowtoCapture()`, true only when all three hold:
   - `import.meta.env.DEV`;
   - `isDemo()`;
   - sessionStorage `smc-howto` is `'1'`, latched from `?howto=1` the same way `?demo=1` is.

   The production build turns it into `false` and drops every branch it guards. It only **shows** things the demo hides; it never enables an action:
   - `src/components/LiveTV.tsx`: the gold Settings button (and `HEADER_COUNT`) and `showSettings`. The hub still shows its demo note for account items.
   - `src/components/Settings.tsx`: `showUpdates`.
   - `src/components/SupportTicketSystem.tsx`: the new-ticket button and the list (lines ~917 and ~1004).
   - `src/components/UserDashboard.tsx`: the parts hidden at ~677.
   - `src/components/livetv/PlexDetail.tsx`: `canList` (My List).
2. **`data-howto` hooks.** Add the ids from table 1c.
   - Values must be **string literals** in the source, so the static check can find them. Mapped lists (bar buttons, sidebar sections, Home cards) use a literal map, e.g. `const BAR_HOWTO: Record<BarControlId, string> = { prev: 'bar.prev', … }`.
   - Put a hook on an element that is only there in the right state (for example `home.recTile` only on the focused tile).
   - Files: `pages/Index.tsx` (header buttons, ticker wrapper, cards row and each card), `HomeClock.tsx`, `MediaBar.tsx`, `Settings.tsx`, `remote/PairingQR.tsx`, `livetv/CredentialsForm.tsx`, `livetv/LiveLayoutChooser.tsx`, `LiveTV.tsx` (header, sidebar), `livetv/LiveSection.tsx` (line group header, categories, Favorites row, Search / Recordings buttons, channel list, preview, now/next, search box), `livetv/ReportChannelDialog.tsx`, `livetv/PlayerControlBar.tsx`, `livetv/RecordDialog.tsx`, `livetv/GuideSection.tsx`, `livetv/RecordingsScreen.tsx`, `livetv/GameDaySection.tsx`, `livetv/MultiScreenSection.tsx`, `livetv/BackupsSection.tsx`, `livetv/MoviesSection.tsx`, `livetv/SettingsHub.tsx`, `livetv/PlexAuthScreen.tsx`, `livetv/PlexSection.tsx`, `livetv/PlexLibraryRows.tsx`, `livetv/PlexDetail.tsx`, `livetv/PlexPlayerOverlay.tsx`, `InstallApps.tsx` (and its app dialog), `StoreScreen.tsx`, `CreditStore.tsx`, `UserDashboard.tsx`, `Support.tsx`, `AIConversationSystem.tsx`, `SnowMailPanel.tsx`, `voice/VoiceCommandHost.tsx`, `SupportTicketSystem.tsx`, `SpeedTest.tsx`, `BufferingGuide.tsx`, `SupportVideos.tsx`, `MediaManager.tsx`, `profiles/ProfileScreens.tsx`.
3. **Stage page** (dev only). In `src/App.tsx`:
   `const HowToStage = import.meta.env.DEV ? lazy(() => import('@/howto/HowToStage')) : null;`
   plus a `/howto-stage` route only when it is set.

   `src/howto/HowToStage.tsx` (new) reads `?shot=<id>&bg=<url>` and draws the real component with made-up props from `src/howto/stageFixtures.ts` (new):
   - live-signin: `CredentialsForm initial={null}`.
   - live-holdmenu / live-report: `ReportChannelDialog` with `onRecord` and `onToggleFavorite`, over `bg`. The script presses the keys that reach the reasons step.
   - live-player: `PlayerControlBar` with `visible`, `order={liveBarOrder({ rewind: true, record: true })}`, `focus="rec"`, `rewind={{ availableSec: 1800, behindSec: 45, archiveDays: 0 }}` and a fake `VideoController` with 2 subtitle and 2 audio tracks. It sits over a drawn still: a gradient with the demo channel's logo, never a real TV frame. The channel and its now/next come from `liveTvDemo`.
   - live-record: `RecordDialog` (channel, programme, `maxConnections` 2) over `bg`.
   - guide-record: `RecordDialog` in programme mode, with programmes from the demo EPG, over `bg`.
   - recordings: `RecordingsScreen active` over `bg`. Its data comes from `SnowRecorder`'s `webFallback`: when `isHowtoCapture()`, it returns `stageFixtures` recordings (3 done, 1 scheduled, 1 missed) and 2 volumes (This box, USB drive).
   - multi: the Multi-Screen layout picker. Add a prop `previewOnly?: boolean` to `MultiScreenSection` (only the stage passes it). It draws the picker without `hasNativePlayer()` and makes no native call.
   - plex-connect / plex-link: `PlexAuthScreen` with status props; link code `K7Q4`.
   - plex-player / plex-upnext / plex-subs / plex-audio: `PlexPlayerOverlay active` with a fake controller, a demo title, and `prompt` `skip` or `next`. The subtitle and audio menus are opened by the script's keys.
4. **Game Day and 2 services.** If the fixture lineup (item D) needs sports channels the demo doesn't have, add them in `liveTvDemo.ts`, used only when `isHowtoCapture()`. Channel and team names are made up.
5. **Must stay the same:** what a box draws, D-pad focus, Back, Kids profiles, demo mode, analytics, Chrome 66 rules, memo behaviour (hooks are static attributes).
6. **Tests.**
   - `src/howto/hooks.test.ts` (new): every id in `HOWTO_SHOTS` appears as a quoted literal in `src/pages`, `src/components` or `src/howto` (tests excluded).
   - Also in that file: `isHowtoCapture()` is false without demo, false on native, and false when the `DEV` flag is false.
   - The existing tests of every touched component still pass.

## 4. Item D: the capture script, fixtures and the generated pictures

Owns: `scripts/howto/**` (new), `package.json` (scripts only), `.gitignore`, `public/howto/**` (generated) and `src/data/howtoRects.json` (after item 0).

1. **Run it.**
   - Commands: `npm run howto:capture [-- --lang en,ar --shot home,live-list --url http://127.0.0.1:5199]` and `npm run howto:check`.
   - `scripts/howto/capture.mjs` runs from inside the repo so it resolves `playwright`.
   - It starts `npx vite --host 127.0.0.1 --port 5199 --strictPort` unless `--url` is given, and waits for it.
   - Browser: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (chromium).
2. **One browser context per language.**
   - Viewport **960×540** (the TV's CSS size, so the layout matches the box), `deviceScaleFactor: 2`, `timezoneId: 'America/New_York'`.
   - `context.clock.install` at a fixed time (Sun 2026-10-04 19:30), so the clock, the EPG and Game Day are the same every run.
   - `addInitScript` seeds localStorage:
     - `smc_lang`;
     - first-run popups marked seen (welcome, content-bar prompt, profiles intro);
     - content bar on; Live TV layout `classic` (not for `live-layout`);
     - profiles "Me", "Sam", and "Kids" with a kids level and a PIN tag;
     - a second saved Live TV line labelled "Vibez" (demo host);
     - a fake Supabase session for the made-up user (so Dashboard shows).
   - It also fakes `SpeechRecognition` so the voice panel stays in "listening".
   - Start URL: `/?demo=1&howto=1`. Stage shots use `/howto-stage?shot=…`.
3. **All network is answered from fixtures** (`context.route('**/*')`):
   - Vite (`127.0.0.1:5199`) and `data:` pass through.
   - Google Fonts pass through. For `ar`, inject Noto Sans Arabic as a fallback font, because this Linux box has no Arabic font.
   - Supabase `functions/v1/<name>` → `scripts/howto/fixtures/functions/<name>.json`: `game-day`, `demo-plex-catalog`, `media-bar-feed`, `phone-remote`, and others as found. Anything unlisted returns `{}`.
   - Supabase `rest/v1/<table>` → `fixtures/rest/<table>.json`, else `[]`. `auth/v1/*` → fixture user.
   - RSS, store API, Vimeo, TMDB → `fixtures/external/*.json`.
   - Anything else → 404, and it is logged, so nothing reaches a real server.
   - `/__howto_bg/<lang>/<shot>.png` serves an earlier raw capture as the stage background.
4. **Fixture content** (made up, English, the same in every language: this is server data, which isn't translated either):
   - Game Day: 3 games in real leagues with made-up teams. Channel picks give "Picked by Snow Media", one ⚠️ down channel, a "Not confirmed by the guide" group, and links on both services.
   - Plex catalog: made-up titles with drawn SVG posters. One movie has 4K + 1080p versions. One show has a Continue Watching entry.
   - Recommended row: 8 made-up tiles.
   - Posts, tickets, store items, videos and gem packs: made up.
   - User: "Alex Demo", `alex@example.com`. Phone remote code `SNOWDEMO`.
5. **Recipes** (`scripts/howto/recipes.mjs`): one entry per shot in table 1c:
   `{ id, start, keys: [...], holdOk?, typeText?, bg?, ready: '<selector>' }`.
   - The app is driven with the remote keys (`ArrowDown`, `Enter`, hold `Enter` 800 ms, `Escape`), the way a customer does it.
   - Before each capture:
     - wait for `ready` and `document.fonts.ready`, then 400 ms;
     - add CSS that pauses animations and transitions and hides toasts and the caret.
6. **Output.**
   - Screenshot (1920×1080 PNG) → a canvas at **1024×576** (smoothing high) → `toDataURL('image/webp', q)`, starting at q 0.62 and stepping down to 0.4.
   - It fails if a picture is still over 70 KB.
   - Writes `public/howto/<lang>/<shot>.webp`.
7. **Rects.**
   - `$$eval('[data-howto]')` collects every visible element (not `display:none` / `visibility:hidden` / zero size). Boxes with the same id are merged, clipped to the viewport, converted to % of 960×540 and rounded to 2 decimals.
   - Only the ids the shot lists in 1c are kept. A missing id fails the shot (`--allow-missing` only warns).
   - Results are merged into `src/data/howtoRects.json` with sorted keys; other shots and languages are kept.
8. **Review output** (gitignored, `scripts/howto/out/`):
   - per shot, a PNG with the rects drawn and named;
   - `out/index.html`, a contact sheet of every language;
   - `--review`: after all items are merged, a picture of every guide slide in the 5 languages at 960×540, to check nothing overflows. This is how Tronix's guide was checked.
9. **`--check` (dry, no browser)**, in `scripts/howto/check.mjs` (pure, exported `checkAll()`):
   - every shot in the contract has a recipe;
   - every highlight id is in the source as a literal;
   - every fixture parses;
   - privacy scan of fixtures: no email except `@example.com`, no URL except an allowlist (`example.com`, `demo://`, `plex.tv/link`, `snowmediaent.com/remote`), and nothing matching password/token/`X-Plex-Token`;
   - rects JSON is in range.
10. **Generate the set.** After item A is on main, rebase and run all 5 languages. Look at every contact sheet; no real name, email, URL or password may appear. Commit the images and the JSON.
11. **Tests.** `src/data/howtoRects.test.ts` (new):
    - the schema is right;
    - every language in `HOWTO_LANGS` has every shot and every highlight of table 1c;
    - every rect has `0 ≤ l, t`, `w, h ≥ 0.5`, `l + w ≤ 100.01` and `t + h ≤ 100.01`;
    - each file exists and its `bytes` match;
    - each file ≤ 70 KB, and the total ≤ 10 MB;
    - `checkAll()` returns no problems.

## 5. Item B: the new picture view with labels

Owns `src/components/howto/**` (the stub `HowtoShot.tsx` and new files) and `src/components/TutorialArt.tsx`. Deletes `src/data/tutorialShots.ts`.

1. **`shotSource.ts`** (new).
   - `normalizeLang(i18n.language)` → one of `HOWTO_LANGS`, otherwise `en`.
   - `resolveShot(shot, lang)` →
     `{ url: import.meta.env.BASE_URL + 'howto/' + lang + '/' + shot + '.webp', rects, lang }`.
     It uses that language's entry in `howtoRects.json`, then `en`'s, else returns `null`.
2. **`calloutLayout.ts`** (new, pure).
   - Input: 1-3 rects in % and the frame's aspect.
   - Output per highlight:
     - the ring (the rect grown by 0.8%, clamped to the frame);
     - a badge number (only when there are 2-3 highlights);
     - the label box: `left`/`top` in %, max width 38%, plus which side it is on and the pointer.
   - Side order: below the ring if its bottom < 70%, else above if its top > 30%, else right, else left.
   - The label is clamped inside 1..99%. When 2 labels overlap, the later one moves down, or up at the bottom edge.
3. **`HowtoShot.tsx`** (props from 1b).
   - Frame: `relative w-full` with `paddingTop: '56.25%'`. Its child is absolute with `top/left/right/bottom: 0` (no `inset`, no `aspect-ratio`).
   - One `<img key={url} decoding="async" alt="">`, only for the current slide. `onError` → fallback.
   - Dim: one full-size `<svg viewBox="0 0 100 100" preserveAspectRatio="none">` with a single `path` (outer rect + a hole per ring, `fill-rule="evenodd"`), `rgba(0,0,0,.6)`.
   - Ring: `border-2 border-brand-gold` plus a gold glow. `animate-pulse`, except when `html.native-low-memory` is set.
   - Label: gold chip with navy text, 13px bold, at most 2 lines, `t(labelKey)`, the badge number in front, and a CSS-border triangle pointing at the ring.
   - Remote hint: chip at the bottom-left with a drawn remote button (a circle for OK, a filled circle for Hold OK, arrows) and `t('guides.howTo.remote.<hint>')`.
   - `shot === 'remote'` → `RemoteDiagram.tsx` (new): a drawn remote with the 5 ids from `HOWTO_DIAGRAMS` and their rects fixed in the file. It uses the same rings and labels.
   - No picture and no rects → `<TutorialArt shot=… />` fallback.
   - The frame is `aria-hidden`; the slide text says it all.
   - Chrome 66: flex gap only `gap-1..4`, no `clamp()` without a px fallback, no `:is()`.
4. **`TutorialArt.tsx`**: keep only as the fallback. Props become `{ shot: ShotId; highlight?: string }`.
   - A table maps new shot ids to the old drawings: home/home-bar → home, live-list/live-search → livetv, live-player → controls, guide → guide, multi → multi-screen, plex-* → plex-grid, support-* → support, settings-* → settings, apps* → apps, store/gems → store.
   - Anything else → a plain frame with the chapter icon.
   - Drop the `tutorialShots` import.
5. **Tests.**
   - `src/components/howto/calloutLayout.test.ts`: labels always inside the frame; 3 highlights don't overlap; the side rules; badge numbers only when there is more than one.
   - `src/components/howto/HowtoShot.test.tsx`:
     - uses a mocked `howtoRects.json` (en + es; fr missing);
     - it shows the es picture when the language is es, and the en picture when it is fr;
     - it shows the schematic when the shot is missing;
     - there is exactly one `img`;
     - there is one ring per highlight that has a rect, and a label with `t(labelKey)`;
     - numbers show only when there are 2 or more highlights;
     - the remote chip shows;
     - after an image error it falls back.
   - `src/components/howto/chrome66.guard.test.ts`: none of B's files uses `aspect-ratio`, `inset-`/`inset:`, `:is(`, `gap-[5-9]`, or `clamp(` without a px fallback.

## 6. Item C: chapters, slides, guide screen and 5 languages

Owns `src/data/tutorialContent.ts`, `src/components/HowToGuide.tsx`, `src/components/HowToGuide.kids.test.tsx`, `src/data/tutorialContent.test.ts` (new), `src/i18n/locales/{en,es,fr,de,ar}/guides.json` and `src/i18n/guard/covered/howto.txt` (new).

1. **`tutorialContent.ts`**: the chapters and slides of section 2.
   - `TutorialSlide` = `{ id; icon; titleKey; line2Key?; deepLink?; art: HowtoArt }`, with `HowtoArt` from the contract.
   - Each slide keeps a lucide icon, as today.
2. **`HowToGuide.tsx`.**
   - Replace `TutorialArt` with `<HowtoShot art={slide.art} titleKey={slide.titleKey} />`.
   - The slide goes **side by side**: picture on the left (`width: '62%'`), text on the right (title `text-2xl`, line 2 `text-base`, vertically centred, left aligned).
   - Tighter header and footer: `pt-3 pb-2`, footer `pt-2 pb-4`.
   - At 960×540 the picture is about 565×318. Everything must fit without scrolling in all 5 languages. Keep the scroll fallback for anything taller, with auto margins as in Tronix, so the top never clips.
   - The keys, focus, Back, Capacitor back, deep links, Kids rules and analytics calls stay exactly as they are.
   - The chapter list scrolls, as now (10 chapters).
3. **Text.**
   - Replace `guides.howTo` in `en/guides.json` with the section-2 text, labels and remote hints, then translate into es, fr and de. Use glossary words (`src/i18n/glossary.json`: Live TV, Guide, Favorites, Record, Rewind, Settings…); Plex, Snow Media, DreamStreams and Vibez stay as they are.
   - Arabic: text only, left to right, as in the rest of the app.
   - Labels ≤ 26 characters. Titles ≤ 2 lines and line 2 ≤ 2 lines at 960×540.
   - `guides.buffering` is not touched.
4. **`covered/howto.txt`**: `src/components/howto` and `src/data/tutorialContent.ts`, so the hard-coded-English guard covers the new view.
5. **Tests.**
   - `src/data/tutorialContent.test.ts` (new):
     - every slide's `art.shot` is in `HOWTO_SHOTS` or `HOWTO_DIAGRAMS`, and each highlight id is in that shot's list;
     - 0-3 highlights, and unique slide ids in a chapter;
     - every title / line2 / linkBtn / label / remote key exists, and is not empty, in all 5 languages;
     - label ≤ 26 characters; en title ≤ 90 and line2 ≤ 150 characters;
     - the 7 old chapter ids are still there;
     - every `deepLink` view is a real Index view.
   - `HowToGuide.kids.test.tsx`: mock `@/components/howto/HowtoShot`. Keep the Kids cases (no Main Apps / Dashboard / Store / Snow Gems / tickets / cleaner / posts links; the Buffering Guide and Live TV are still offered). Add one for the new `store` and `credits` links.
   - The parity and guard tests (`locales.parity.test.ts`, `hardcoded.guard.test.ts`) pass.

## 7. Order, merge, and what the orchestrator does

1. **Item 0**: commit 1a, 1b and the 1c table on main.
2. **A, B, C and D start at once**, each in its own worktree. No file is shared.
   - D writes the script, fixtures and `--check` first.
   - D runs the real capture after A is merged (D rebases, then generates).
3. **Merge order**: A → B → C → D (with the generated images).
4. **Orchestrator**:
   - `versionCode 55` in `android/app/build.gradle`;
   - `TRACKER.md` rows (items 0, A–D);
   - full checks (`tsc`, `eslint` on changed files, full `vitest`, `npm run build`);
   - `npm run howto:capture -- --review` and a look at every slide in 5 languages.

## Files that will change

- **Item 0:** `src/data/howtoContract.ts` (new), `src/data/howtoRects.json` (new), `src/components/howto/HowtoShot.tsx` (new, stub).
- **A:**
  - `src/lib/demoMode.ts`, `src/App.tsx`, `src/capacitor/SnowRecorder.ts`, `src/data/liveTvDemo.ts`;
  - `src/howto/HowToStage.tsx` (new), `src/howto/stageFixtures.ts` (new), `src/howto/hooks.test.ts` (new);
  - `src/pages/Index.tsx`;
  - `src/components/`: `HomeClock.tsx`, `MediaBar.tsx`, `Settings.tsx`, `remote/PairingQR.tsx`, `LiveTV.tsx`, `InstallApps.tsx`, `StoreScreen.tsx`, `CreditStore.tsx`, `UserDashboard.tsx`, `Support.tsx`, `AIConversationSystem.tsx`, `SnowMailPanel.tsx`, `voice/VoiceCommandHost.tsx`, `SupportTicketSystem.tsx`, `SpeedTest.tsx`, `BufferingGuide.tsx`, `SupportVideos.tsx`, `MediaManager.tsx`, `profiles/ProfileScreens.tsx`;
  - `src/components/livetv/`: `CredentialsForm`, `LiveLayoutChooser`, `LiveSection`, `ReportChannelDialog`, `PlayerControlBar`, `RecordDialog`, `GuideSection`, `RecordingsScreen`, `GameDaySection`, `MultiScreenSection`, `BackupsSection`, `MoviesSection`, `SettingsHub`, `PlexAuthScreen`, `PlexSection`, `PlexLibraryRows`, `PlexDetail`, `PlexPlayerOverlay` (all `.tsx`).
- **B:** `src/components/howto/HowtoShot.tsx`, `src/components/howto/shotSource.ts` (new), `calloutLayout.ts` (new), `RemoteDiagram.tsx` (new), `RemoteHintChip.tsx` (new), `calloutLayout.test.ts` (new), `HowtoShot.test.tsx` (new), `chrome66.guard.test.ts` (new); `src/components/TutorialArt.tsx`; `src/data/tutorialShots.ts` (deleted).
- **C:** `src/data/tutorialContent.ts`, `src/data/tutorialContent.test.ts` (new), `src/components/HowToGuide.tsx`, `src/components/HowToGuide.kids.test.tsx`, `src/i18n/locales/{en,es,fr,de,ar}/guides.json`, `src/i18n/guard/covered/howto.txt` (new).
- **D:** `scripts/howto/capture.mjs`, `recipes.mjs`, `check.mjs`, `fixtures/**` (all new); `package.json` (2 scripts); `.gitignore`; `public/howto/{en,es,fr,de,ar}/*.webp` (new, generated); `src/data/howtoRects.json`; `src/data/howtoRects.test.ts` (new).
- **Orchestrator:** `android/app/build.gradle` (versionCode 55), `TRACKER.md`.
- Not touched: `src/components/games`, `src/components/kids`, `games.*` keys, `guides.buffering`, analytics names.

## Risks

- **Demo/web can't reach a state** (native player, recorder, Multi-Screen). Covered by the stage. The stage draws the real components, so a later redesign still shows up at the next capture. A stale picture is fixed by re-running the script, which is the point of it.
- **Pictures go stale after UI changes.** Re-run `npm run howto:capture`. The rect test fails when a hook is gone, so rings can't silently point at nothing.
- **Arabic and emoji fonts** in headless Linux: the Arabic font is injected and the contact sheet is checked. Noto Color Emoji is installed (for ⚠️).
- **APK size:** about 9 MB more. The test caps it at 10 MB.
- **Hidden demo gates:** `isHowtoCapture()` is `DEV`-only, so the APK and the marketing site can't show the extra Settings button, Updates tab and the like.
- **Game Day matcher** is complex. If the fixtures can't produce every state (picked, ⚠️, unconfirmed, both service tags), item A adds a Game Day variant to the stage rather than bending the matcher.

---

## Owner decisions

1. **Picture size in the APK.** 48 pictures × 5 languages at 1024×576 WebP ≈ 9 MB. *Recommended: yes.* Other choices: 896×504 (≈ 7 MB, slightly softer), or English pictures only with translated labels (≈ 1.8 MB).
2. **What the posters in the pictures show.** *Recommended: made-up titles with drawn artwork* in the Plex, VOD and Recommended pictures. Then no studio artwork ships inside our APK, and no real account data can leak. The other choice is the real demo catalog posters: they look richer, but the artwork belongs to the studios.
3. **In-app billing** ("My Account" in Live TV Settings, "Buy a plan"). *Recommended: leave it out of the guide this round* (the demo can't show it). Add a slide when billing is switched on for customers.
