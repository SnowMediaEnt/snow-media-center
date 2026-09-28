# Plan: port Live TV Rewind and Recording from OmniMax into SMC

## Plain-English summary

OmniMax has two features SMC doesn't:

- **Rewind live TV.** While a channel plays full screen, a second stream copies it onto the box's storage. You can pause live TV, go back and forward 10 s at a time, and jump back to live. Channels whose provider keeps an archive use that archive instead, and nothing is stored on the box.
- **Record now.** Hold OK on a channel, or press Record in the player bar, then pick where to save it (the box or a USB drive) and how long. The recording runs in the background with its own notification. A new Live TV › Recordings screen lets you play, rename, delete or stop recordings.

No Supabase or database work is involved: there are no migrations and no edge functions.

The native (Kotlin) part and the logic files can be brought over almost unchanged. The player-bar and Live TV screen changes can't be copied as patches. OmniMax redesigned its player bar before building these features, and SMC never got that redesign. So those changes have to be rebuilt on SMC's current bar, player and MPV code.

**The main SMC risk:** Rewind also opens an extra stream on the line all the time a channel is full screen, not only recording. OmniMax never checks how many connections the line allows, and it never tells the user that recording uses an extra stream. The plan adds that message, as you asked.

---

## 1. How it works in OmniMax

### Rewind (OmniMax item 58)

- **Where the buffer lives:** on the box's storage (the app's cache folder), never in RAM. The channel is saved as about 4-second pieces plus a small local playlist. Only about 128 KB is held in memory.
- **Size:** it grows until one of these limits, then drops the oldest part:
  - the box must keep at least 1 GB or 15% of the drive free, whichever is larger;
  - hard cap of 4 GB;
  - optional "Max rewind" of 10, 30 or 60 minutes. The default is Auto.

  This is the storage-based sizing you approved (roughly 5 to 30+ minutes).
- **When it's deleted:**
  - The previous channel's buffer is kept for 8 s after a channel change, so jumping straight back keeps its rewind.
  - It is wiped when you leave the player, press Home, close the app, sign out, or turn Rewind off.
- **How going back works:**
  - The picture keeps coming from the provider.
  - Back 10s, or a pause longer than 20 s, switches the player onto the local copy.
  - Forward past the end of the copy, or Go live, reloads the channel.
  - An error while playing the copy goes back to live.
- **Panel catch-up:** channels where the provider keeps an archive play the provider's archive address instead. Nothing is stored on the box and you can go back several days. The panel's clock offset is worked out from its sign-in answer.
- **Remote keys:**
  - Rewind and Fast-forward = 10 s back or forward. Held down, they repeat, and presses that arrive while one is running are added together.
  - Channel changes move to ▲▼, CH+/CH- (newly caught by the Android code) and Next/Previous.
  - Play/Pause pauses as it does now.
- **Screens:**
  - Bar buttons Back 10s, Forward 10s and Go live.
  - The LIVE badge becomes "-0:45" when you are behind.
  - A timeline row shows "-12:30 available".
  - Live TV › Settings › Rewind live TV has on/off, Max rewind and disk usage.
- **Only in:** native full-screen channels in the Live TV section. Not in Guide full screen, preview boxes, Multi-Screen or VOD.

### Recording (OmniMax item 59)

- **Record now only.** There is no scheduling from the Guide.
- **Starting a recording:** hold OK on a channel in the list, or press Record in the bar. The dialog offers:
  - Save to: This box / USB drive, each showing free space, with a warning below 2 GB.
  - Length: 30 min, 1 h, 2 h, 3 h, Custom (15 min to 12 h in 15-minute steps) or Until I stop it.
  - "More options…" opens the existing report menu.
  - If the channel is already recording, the dialog offers Stop instead.
- **Files:** the stream is saved as it arrives, with no re-encoding. It goes to the app's own `Download/Recordings` folder on the box or on a mounted USB drive, named `<Channel> – YYYY-MM-DD HH.MM.ts`. A small list of recording details sits in the app's private storage. The files are deleted if the app is uninstalled.
- **Length and stopping:**
  - Up to 12 h, or until stopped. The box is kept awake for up to 12 h.
  - It reconnects on its own if the stream drops.
  - It stops if less than 200 MB is free, the drive is removed, or the channel's format can't be saved (encrypted or fMP4 HLS).
  - There is no limit on how many channels record at once.
- **Playback and deleting:** Live TV › Recordings appears under Search once a recording exists. It shows size, length and free space per drive. OK opens Play, Rename, Delete (asks to confirm), or Stop. Recordings play on the native player: OK pauses, ◀ goes back 10 s, ▶ forward 30 s.
- **When the app is closed:** a foreground service keeps recording, with a notification ("Recording CNN, until 21:45") and a Stop button. It survives Home and leaving the app. It does not survive a force-stop or a reboot, and does not resume after either.
- **Permissions:** FOREGROUND_SERVICE and FOREGROUND_SERVICE_DATA_SYNC, both granted at install without a prompt. No storage permission is needed because the folders are the app's own.
- **Low-RAM boxes:** RAM use is tiny (one thread and about 128 KB per recording). The real costs are network (one extra stream per recording) and storage writes.
- **The extra-stream message:** OmniMax never tells the user that a recording uses an extra stream. SMC will add it (work item 7).

---

## 2. What to port, and what differs in SMC

**Where OmniMax came from.** OmniMax was remixed from SMC build 43 (SMC commit `c1bbd84d`, 26 Sep; the player plugin is identical to `a0fada82`). OmniMax's own git history starts at that remix.

**What changed since, on each side:**
- SMC since then (builds 44–47):
  - MPV as a second engine;
  - PlaybackScreen with the engine choice, stats and engine comparison;
  - the `engine` argument on useNativePlayer;
  - stats changes;
  - `playerSignOut`;
  - Home work.
- OmniMax before the DVR work:
  - rebrand;
  - removed Plex and the Store;
  - `b5454e5`, a player menu redesign (new `playerBar.ts`, a channel list over the picture, bigger bar).

  The DVR UI was built on top of that redesign, so it has to be rebuilt on SMC's bar, not patched in.

### Commits

| Commit | What | Port? |
|---|---|---|
| `86fdc56` | Native rewind: `dvr/LiveSource, TsSegmenter, TimeshiftSession, TimeshiftManager, StorageBudget` + timeshift section in the player plugin | Yes. The dvr files move over with renames only. The plugin hooks are re-placed into SMC's plugin. |
| `2aa081b` | Native recorder: `RecordingService, RecordingStore, RecorderPlugin`, manifest, MainActivity | Yes, with renames and the SMC changes below |
| `7d69209` | `liveRewind.ts`, `useLiveRewind.ts`, `RewindSettingsScreen`, SettingsHub entry, bridge methods, bar buttons and timeline | Logic, hook and settings screen: yes. Bar changes: rebuild onto SMC's bar. |
| `832da55` | `OmniRecorder.ts`, `RecordDialog`, `RecordingsScreen`, `recording.ts`, LiveSection wiring, `dvrNative.test` | Yes. LiveSection wiring re-done by hand; the channel-overlay hold part is dropped (SMC has no overlay). |
| `b5ad2b9` | Remote Rewind/Fast-forward through rewind, `skipQueue.ts`, CH+/CH-, `skipKeys` | Live-channel part only. Leave out: the dealer Report rule; the VOD/Plex skip change from +30/-10 to 10/10 (SMC keeps +30/-10). |
| `8220066` (OmniMax MPV) | How rewind hands over between MPV and ExoPlayer | Reference only. OmniMax's MPV code (PlayerEngine/StreamProxy) is unrelated to SMC's SecondEngine. |
| Later OmniMax edits to these files | Renames and one comment | Nothing to port |

### Files: OmniMax source → SMC target, and what differs

**Renaming rules for every file:**

| OmniMax | SMC |
|---|---|
| `OmniPlayer` | `SnowPlayer` |
| `OmniRecorder` | `SnowRecorder` (plugin name `"SnowRecorder"`) |
| package `com.omnimax.tv.dvr` | `com.snowmedia.dvr` (matches SMC's `com.snowmedia.<area>` layout; `internal` still works inside one module) |
| `com.omnimax.tv.R` | `com.snowmedia.R` |
| icon `ic_stat_omnimax` | `ic_stat_snow` |
| `omni-*` storage keys | `smc-*` (e.g. `smc-live-rewind-v1`) |
| `omni-recordings:changed` | `smc-recordings:changed` |
| thread names, wake-lock tags, notification channel | `smc-…`, `SMC:record`, `smc_recordings` |
| "OmniMax TV app" text | "Snow Media Center app" |
| `omni-player-fullscreen` class | `snowplayer-fullscreen` |

| OmniMax file | SMC target | What differs in SMC / what to do |
|---|---|---|
| `android/.../dvr/*.kt` (8 files) | `android/app/src/main/java/com/snowmedia/dvr/` **(new)** | Renames. Recorder changes for SMC: (a) stop at 1 GB free on the box's own storage, 200 MB on USB; (b) roll over to "… (part 2).ts" at about 3.9 GB, because FAT32 USB sticks can't hold a larger file; (c) at most 2 recordings at once, then reject with a message. |
| `OmniPlayerPlugin.kt` timeshift section | `com/snowmedia/player/SnowPlayerPlugin.kt` | Add the timeshift section as a block. See the hook details below the table. |
| `MainActivity.kt` | `com/snowmedia/MainActivity.kt` | `registerPlugin(RecorderPlugin)`. Add `KEYCODE_CHANNEL_UP/DOWN` → `chup`/`chdown` on SMC's `smc:mediakey` event, no repeat when held. |
| `AndroidManifest.xml` | same | Add the two FOREGROUND_SERVICE permissions and the `com.snowmedia.dvr.RecordingService` entry (not exported, `dataSync` type). POST_NOTIFICATIONS is already there. |
| `src/capacitor/OmniPlayer.ts` (timeshift part) | `src/capacitor/SnowPlayer.ts` | Add `TimeshiftStatus`, `timeshiftOff` and the 7 methods, plus web fallbacks. |
| `src/capacitor/OmniRecorder.ts` | `src/capacitor/SnowRecorder.ts` **(new)** | Renames. Add `maxSimultaneous` to the reject message. |
| `src/lib/liveRewind.ts`, `recording.ts`, `skipQueue.ts` | same paths **(new)** | Renames only. `recording.ts` also gets `listWindow` (SMC has no `playerBar.ts`) and a new `extraStreamNote(maxConnections)`. |
| `src/hooks/useLiveRewind.ts` | same **(new)** | Sign-out comes through `playerSignOut.ts`, not `VIEWER_EVENT` (SMC has none). New args `engine` (off when `'mpv'`) and `maxConnections` (on-box buffer only when 2 or more, see Q1). |
| `src/lib/mediaKeys.ts` | same | Add `chup`/`chdown` and `ChannelUp`/`ChannelDown`. |
| `src/hooks/useNativePlayer.ts` | same | Add `skipKeys = true`, needed because a catch-up plays with `live:false`. Keep SMC's `engine` argument and SMC's +30/-10 skips. |
| `playerBar.ts` (OmniMax redesign) | `src/components/livetv/liveBar.ts` **(new)** | A small `liveBarOrder({seekable, rewind, record})` and a label helper for SMC's own ids. It replaces the hard-coded list at `LiveSection.tsx:1672` and the `controls` array in `PlayerControlBar`, so the two can't drift apart. |
| `PlayerControlBar.tsx` | same | Keep SMC's look (w-12 buttons, w-16 Play, Stats last). Add ids `golive` and `rec`. Add props `rewind` (thin timeline row and "-0:45" badge instead of LIVE) and `recording` (REC badge). Rewind order: `prev rew play fwd golive next rec cc audio vol stats`; 11 buttons, about 680 px, fits 960. |
| `LiveSection.tsx` | same | Rebuilt by hand; see work item 6. |
| `RecordDialog.tsx` | same **(new)** | Renames. Add the extra-stream line (item 7). |
| `RecordingsScreen.tsx` | same **(new)** | Renames. Drop `engineChoice:false` (SMC's default engine is already ExoPlayer). Rename field: SMC keyboard path (OK on the field → `Keyboard.show()`), not autofocus. Use the `snowplayer-fullscreen` class. |
| `RewindSettingsScreen.tsx` | same **(new)** | Renames. Add "Uses one extra stream on your line" and, on a 1-connection line, "Your plan allows 1 stream, so rewind works only on channels with catch-up". |
| `SettingsHub.tsx` | same | SMC's menu has billing and playback; add `rewind` between Appearance and Playback, allowed in demo like Playback. PlaybackScreen itself is unchanged. |
| `src/lib/playerSignOut.ts` | same | Also call `SnowPlayer.timeshiftWipe()` and `SnowRecorder.stop()` (stops all recordings; see "My defaults"). |
| `GuideSection.tsx`, `PlayerStatsPanel.tsx`, `PlaybackScreen.tsx`, `VideoPlayer.tsx` | — | **No change.** Guide full screen has no bar, the same as OmniMax. |

**SnowPlayerPlugin.kt hooks.** Put the one-line hooks only on the ExoPlayer path:
- `load`: `tsReset()` on MAIN in the ExoPlayer branch.
- `play` and `pause`: SMC's MPV branches return early, so leave them as they are.
- The start of `onPlaybackStateChanged` (the ENDED case) and of `onPlayerError`.
- `stopSlot`.
- A new `handleOnStop` override, and the existing `handleOnDestroy`.

Two SMC rules on top of that:
- `timeshiftStart` does nothing when `slots[MAIN].engine == MPV`, so the buffer is ExoPlayer only.
- Call `s.loadControl?.beginStream(film=false)` before playing the buffer (SMC's own buffer rule).

**Tests.**
- Port with renames: `liveRewind.test.ts`, `recording.test.ts`, `skipQueue.test.ts`, `RecordDialog.test.tsx` (plus an extra-stream assertion), `useLiveRewind.test.tsx` (sign-out goes through `playerSignOut`; add MPV-off and 1-connection cases), `dvrNative.test.ts` (paths `com/snowmedia/...`; add the MPV guard, the FAT32 roll-over and the 1 GB box floor).
- Adapt: `LiveSection.mediaKeys.test.tsx`, cutting the dealer and Report cases. SMC has no LiveSection test to copy from; `LiveTV.kids.test.tsx` shows how SMC sets up its mocks.
- New: `liveBar.test.ts` (replaces `playerBar.test.ts`).
- Don't port: `PlayerMenu.live.test.tsx`; it tests OmniMax's redesigned bar.
- Update: `playerSignOut.test.ts`.

---

## 3. Risks for SMC

1. **Extra streams on the line.** The rewind buffer adds one stream the whole time a channel is full screen, and each recording adds another. On a 1-connection line the provider may refuse the second stream or drop the picture you're watching. SMC already reads `maxConnections` for Multi-Screen, so the rewind buffer can be gated on it (Q1). The recording dialog says it plainly; see item 7.
2. **Double bandwidth.** Watching live with rewind uses twice the data. Weak Wi-Fi boxes could start buffering. Test on the slowest box; the Settings switch turns it off.
3. **Storage on cheap boxes.**
   - A stick with about 1.5 GB free gets only a few minutes of rewind, or "Not enough free space".
   - OmniMax lets a recording fill the box down to 200 MB, which is too low for app updates and the WebView cache. SMC stops at 1 GB on the box's own storage.
   - FAT32 USB sticks can't hold a file over 4 GB, which is about 1 to 2 hours of HD. The plan splits into parts.
   - Rewind writes to storage the whole time you watch full screen, which wears cheap storage chips over years. The Settings off switch covers this.
4. **ExoPlayer vs MPV.** SMC's MPV (SecondEngine, owner test builds only) is not OmniMax's MPV. Rewind stays ExoPlayer only and the buffer doesn't start when MPV is picked. Catch-up plays with `live:false`, which always goes to ExoPlayer, but it gets SMC's film pre-buffer, so the picture can take a few seconds longer to start. Recordings play on ExoPlayer.
5. **Two video paths.** This is native only. Web VOD (HTML5) and the web fallback are unaffected; Record is hidden when the recorder plugin is missing.
6. **Chrome 66.** The new screens use only margins and `space-y`; I checked and found no gap above `gap-4`, no `inset`, no `aspect-ratio` and no `:is()`. The bar fits at 960×540.
7. **White flashes.** The Recording player must use `snowplayer-fullscreen` and a transparent background. The dialogs are dim overlays, not full-screen solid layers.
8. **Keyboard.** Rename must use the 1.6.x path (focus the field, OK calls `Keyboard.show()`, Enter saves). OmniMax autofocuses the field, which is the pattern that looped Fire TV boxes.
9. **Android versions (minSdk 24, target 34).** All newer APIs are guarded. If SMC later targets API 35, Android 15 limits data-sync services to 6 hours, which would cut long "until stopped" recordings. Note it for then.
10. **Scoped storage.** The app's own folders need no permission. The catch: on Android 11+, on-box file managers can't see the files, they're deleted on uninstall, and a USB drive shows them on a computer.
11. **Credentials.**
    - Already safe in OmniMax, and pinned by `dvrNative.test`: nothing logs a URL, and connection errors keep only the HTTP status or the error type. File names use the channel name only. The recordings list and the notification carry no URL. The URL goes only in an in-app Intent to a service that isn't exported, never in a PendingIntent, and the service doesn't ask Android to re-deliver it.
    - To watch in SMC: the catch-up address carries the username and password in its path. It goes only to `SnowPlayer.load`, like live channels, and must never be logged, put in analytics or put in reports. The buffer key is `host|stream_id`, with no credentials.
12. **Hold OK changes.** Today it opens Report. Afterwards it opens Record, with Report under "More options".
13. **Kids profiles and demo mode.** Kids must not see recordings of adult channels (see "My defaults"). Demo mode already disables both features.
14. **Unverified Kotlin.** It can't compile here; your Mac build is the first compile, so expect one fix round. Keeping the hooks to single guarded lines limits what can break for normal playback.
15. **Minor.** The in-app "clear own cache" in `AppManagerPlugin` also clears the timeshift folder. That's harmless because it only runs outside the player.

---

## 4. Questions for the owner

Your earlier answers are applied: storage-based buffer size, recording on its own stream with a plain notice, live channels only.

1. **Rewind uses an extra stream too.** Do Snow Media lines allow 2 or more connections? **Recommended:** run the on-box buffer only when the line allows 2 or more. On 1-connection lines, rewind works only on channels with provider catch-up, and Settings says why. Rewind stays on by default for lines that qualify.
2. **Remote Rewind and Fast-forward keys.** Today in SMC Live TV they change channel. OmniMax made them 10 s back and forward, with channel change on ▲▼, CH+/CH- and Next/Prev. **Recommended:** do it the OmniMax way.
3. **Scheduled recordings from the Guide.** OmniMax doesn't have them. **Recommended:** leave them out of this port and plan them later as a separate feature. They need alarms, surviving a reboot and a box that may be asleep.

**My defaults (I won't ask unless you disagree):**
- Kids profiles get Rewind but no Record and no Recordings list.
- Signing out of the Player stops any recordings.
- At most 2 recordings at once.
- Recordings can go to the box or a USB drive, chosen each time, with the box as the default.

---

## 5. Work items (tracker 25.1 to 25.9, in order)

1. **25.1 Logic libraries.** Port `liveRewind.ts`, `recording.ts` (with `listWindow` and `extraStreamNote`) and `skipQueue.ts`, with their tests. *Check:* vitest.
2. **25.2 Native rewind.**
   - New `com/snowmedia/dvr/{LiveSource,TsSegmenter,TimeshiftSession,TimeshiftManager,StorageBudget}.kt`.
   - Add the timeshift block and guarded hooks to `SnowPlayerPlugin.kt`, with the MPV guard and `beginStream(false)`.
   - Add the bridge methods to `SnowPlayer.ts`.
   - Port the rewind half of `dvrNative.test.ts`.
   - *Check:* vitest; the Mac build compiles.
3. **25.3 Native recorder.**
   - New `RecordingService`, `RecordingStore` and `RecorderPlugin`, with the 1 GB box floor, the 3.9 GB part roll-over and the 2-at-once cap.
   - Manifest entries and MainActivity registration, plus CH+/CH- keys.
   - `SnowRecorder.ts`.
   - Port the recording half of `dvrNative.test`.
4. **25.4 useLiveRewind.** The hook with the `engine` and `maxConnections` gates. Hook the wipe (and stopping all recordings) into `playerSignOut.ts`. Port `useLiveRewind.test` and update `playerSignOut.test`.
5. **25.5 Player bar.** New `liveBar.ts` and `liveBar.test.ts`. `PlayerControlBar.tsx` gets `golive`, `rec`, the timeline row and the badges. Stats stays last.
6. **25.6 LiveSection rewind wiring.**
   - `useLiveRewind` and the catch-up URL, passing `live:!catchupUrl`, `onEnded` and `skipKeys:false`.
   - Sync the paused state.
   - Bar actions use `liveBarOrder`.
   - Media keys go through `createSkipQueue`; CH+/CH- and Next/Prev change channel.
   - `mediaKeys.ts` and `useNativePlayer.ts` get `skipKeys`.
   - Adapt `LiveSection.mediaKeys.test`.
7. **25.7 Record dialog.**
   - `RecordDialog.tsx` with the extra-stream line above Start. It reads: "Recording uses one more stream on your line (your plan allows N at once)."
   - The same wording goes in the start toast, and in the error when the provider refuses.
   - Both start points (hold OK in the channel list, and Record in the bar) open this dialog, so every start shows the notice.
   - Kids and demo hide Record.
   - Port `RecordDialog.test` and add a test for the notice.
8. **25.8 Recordings screen.** `RecordingsScreen.tsx`, the sidebar entry under Search, the SMC keyboard path for rename, and the `snowplayer-fullscreen` class. Hidden in Kids profiles. *Check:* D-pad, and one Back = one step.
9. **25.9 Settings and build handover.** `RewindSettingsScreen.tsx` and its SettingsHub entry. Update TRACKER, bump `versionCode` to 48, and run the full checks: tsc, eslint on changed files, vitest.

### Ready to test (build 48)

- **Pause live:** play a channel full screen and pause for 1 minute, then press Play. It should carry on from where you paused, with the bar showing "-1:00".
- **Rewind:** press the remote's Rewind a few times, or Back 10s in the bar. The picture should jump back, the timeline should show how much is available, and the badge shows how far behind you are. Fast-forward, or Go live, should return to "LIVE".
- **Hold Rewind:** hold the Rewind key. It should keep going back smoothly without freezing.
- **Change channel:** use ▲▼ or CH+/CH-. The channel should change, and Rewind/Fast-forward should no longer change channel.
- **Leaving:** press Home, come back, and rewind. The rewind should start fresh, with nothing kept from before.
- **Settings:** open Live TV › Settings › Rewind live TV, turn it off and play a channel. There should be no rewind buttons. Turn it back on.
- **Catch-up channel** (if the provider has one): rewind. It should go back through the provider's archive.
- **Record:** hold OK on a channel, or press Record in the bar. The dialog should say that recording uses one more stream. Choose 30 min on This box, then leave the app. A notification should show with a Stop button, and the recording should carry on.
- **USB:** plug in a USB stick and record to it. "USB drive" should appear with its free space, and the file should be on the stick in Android/data/…/Download/Recordings.
- **Recordings screen:** open Live TV › Recordings, then play, rename (the keyboard should open on OK), delete and stop a recording. All should work, and Back goes back one step each time.
- **Kids profile:** there should be no Record option and no Recordings list.
- **1-connection line** (if you have one): rewind should say it only works on catch-up channels.
- **Low-storage box:** Record should warn below 2 GB, and a recording should stop by itself before the box has less than 1 GB free.

---

# Owner decisions (final)
- Rewind buffer: storage-based sizing (as OmniMax). On-box buffer only when the line allows 2+ connections (addendum: streams − active recordings ≥ 2).
- Recording uses an extra stream: tell the user plainly on every start (dialog, toast, provider-refused error, notification).
- Live channels only; no VOD recording.
- Remote keys the OmniMax way: Rewind/FF = 10 s; ▲▼, CH+/CH-, Next/Prev change channel.
- Scheduled recordings from the Guide: INCLUDED (single programmes; no "every episode").
- Architect defaults accepted: Kids get Rewind but no Record/Recordings/Guide hold; sign-out stops recordings and cancels schedules; max 2 at once; box is default drive.

# Addendum: scheduled recordings from the Guide (work items 25.10 to 25.15)

## Plain-English summary

- **Scheduling a programme:** in the Guide, hold OK on a channel. The Record dialog lists that channel's programmes. Pick one and choose "Record this programme". Picking the one on now starts recording at once; picking a later one schedules it.
- **Timing:** it starts 2 minutes early and runs 5 minutes late by default. Both can be changed in Live TV › Settings.
- **Where schedules show:** at the top of Live TV › Recordings, where you can cancel them. Scheduled programmes also get a small red dot in the Guide.
- **When it fires:** the box wakes up and records even if the app is closed or the box is asleep.
  - After a reboot, schedules are set again automatically.
  - If the box was off at the start time but the programme is still on, it starts late.
  - If the programme is already over, it is marked "Missed" and you get a notification.
- **Passwords:** a schedule never stores the stream address, username or password. At the start time, the Android code rebuilds the address from the Player login SMC already has saved. If the Player was signed out, or switched to another line, the recording doesn't start and you're told why.
- **"Record every episode" should wait.** Panel guides only look a day or two ahead, programme names vary, and there are no series IDs. It would also need the box to wake up and check the guide in the background, which weak boxes don't handle well. Single programmes first.
- **Main risk:** if someone force-stops the app (Settings › Apps › Force stop, or a "cleaner" app), Android deletes every scheduled alarm until SMC is opened again. SMC re-arms them each time it starts.

---

## 1. How you schedule (UX)

**Guide (GuideSection).** Today the Guide highlights a channel row, not a single programme: ◀▶ moves the time window and OK plays.
- **Press OK:** still plays. It now acts when you let go of OK, so that a hold can be told apart from a press.
- **Hold OK (600 ms, the same as Live TV):** opens the Record dialog in programme mode:
  - **"What" row, first:** up to 6 programmes for that channel, taken from the listings the Guide already has, starting from the programme under the left edge of the current time window. Each shows its title and time, e.g. "20:00–21:00 The News".
  - **"Save to" row:** the same as the Record-now dialog, with the box as the default.
  - **"Record this programme" button:** shows the padded times, e.g. "19:58 → 21:05".
  - **The extra-stream line**, the same wording as Record now: *"Recording uses one more stream on your line (your plan allows N at once)."* On a 1-stream plan it adds: *"While it records, watching TV may stop the picture or the recording."*
  - **Warnings:** "Not enough free space for about 1 h 07" (estimated at 2.5 GB per hour) and conflict messages (section 5).
- **Red dot:** programmes that are scheduled show a red dot in the Guide cell, matched by stream id and start time.
- **Kids profiles:** no hold menu. **Demo mode:** off.

**Live TV bar (small addition to 25.7).** When the current programme's end time is known, the Record-now dialog's length row gets one more chip: "This programme (until 21:05)". Same component, no new screen.

**Recordings screen (additions to 25.8).**
- **"Scheduled" group at the top:** day and time, channel, programme, drive. OK offers **Cancel schedule** (asks to confirm, like Delete) or **Back**. There is no "edit"; you cancel and schedule again.
- **"Missed / didn't start" rows:** the reason in plain words and **Dismiss**. They stay 7 days, then drop off.
- **Warning banner** when the box refuses exact alarms: "This box may start scheduled recordings late. [Open settings]". On Android 12, OK opens the system "Alarms & reminders" page.
- The Recordings entry under Search also appears when there are schedules but no files yet.

**Settings.** The "Rewind live TV" entry becomes **"Rewind & recording"** in the same screen, with two new rows:
- **Start early:** 0, **2**, 5 or 10 min.
- **End late:** 0, **5**, 10, 15 or 30 min.

A schedule keeps the padding it was made with, so changing the setting later doesn't move schedules that already exist.

## 2. Timing

- **Programme times:** use the listing's `start_timestamp` and `stop_timestamp` when present. They are true UTC seconds.
- **When those are missing:**
  - The `start`/`end` text is the **panel's local time**. SMC's `parseEpgTime` reads it as the box's local time, which is wrong whenever the panel and the box are in different time zones.
  - For scheduling, read the text as UTC, then subtract the panel's offset (`serverUtcOffsetMinutes` from `liveRewind.ts`, cached per host). If the panel doesn't report one, fall back to the box's offset.
  - The Guide's own displayed times have the same bug. That's outside this work, but worth noting.
- **Stored times:** the programme's UTC start and end, plus its padding minutes. The recording runs from start minus the early padding to end plus the late padding, capped at 12 h.
  - Because the times are in UTC, daylight-saving and time-zone changes don't move them.
  - A box clock change (it syncs at boot) triggers a re-arm.
- **Programme already on:** it records now, until its end plus the late padding. This goes through the normal Record-now path with that end time.
- **Back-to-back on the same channel and line:** when the padded times touch or overlap, the recordings are merged into one continuous job instead of opening a second stream. The file is named after the first programme and the index lists both titles.
- **Not handled:** a programme that moves after it was scheduled (the listing is not re-read). The padding is the safety margin.

## 3. Android: firing reliably on Android 7 to 14

| Option | Exact? | Wakes a sleeping box? | Lets a background foreground service start (Android 12+)? | Notes |
|---|---|---|---|---|
| **`setAlarmClock`** | Yes | Yes, highest priority | Yes (exact-alarm exemption) | Best choice. On phones it shows an alarm icon; TV boxes have no status bar. |
| `setExactAndAllowWhileIdle` | Yes | Yes, but may be rationed in deep idle (roughly one per 9 min per app) | Yes | Fine as a second choice. |
| `setAndAllowWhileIdle` / `setWindow` (inexact) | No, can be minutes late | Mostly | **No.** `startForegroundService` throws on Android 12+. | Only a last resort (see below). |
| WorkManager | No, batched, deferred in Doze | Delayed | Only through expedited or `setForeground` workarounds, which are unreliable | Not for timed starts. SMC already uses it for the alert poll; keep it out of this. |

**Permissions.**
- `USE_EXACT_ALARM`: Android 13+, granted automatically. Google Play restricts it to alarm and calendar apps, but SMC isn't on Play (its own updater and billing, QUERY_ALL_PACKAGES), so that's fine. **Flag:** revisit if SMC ever goes on Play.
- `SCHEDULE_EXACT_ALARM` with `maxSdkVersion="32"`: covers Android 12 and 12L, where it's granted by default but the user can revoke it.
- Android 7 to 11 need nothing.

**When exact alarms are refused** (Android 12/12L with the permission revoked, or an odd OEM box):
- `canScheduleExactAlarms()` returns false, so the app falls back to an **inexact alarm 5 minutes early**.
- When it fires:
  - If the app process is in the foreground, start the service.
  - Otherwise, try `startForegroundService`. If Android refuses, mark the schedule failed with the reason "The box blocked a timed start. Allow Alarms & reminders for SMC."
- The Recordings banner says so and opens the setting.
- Listen for `ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` and re-arm when the permission is granted.

**Re-arming** (new `RecordRearmReceiver`; SMC's `notify/BootReceiver` is not touched). It runs on:
- `BOOT_COMPLETED` and `QUICKBOOT_POWERON` (Fire TV);
- `MY_PACKAGE_REPLACED` (the in-app updater);
- `TIME_SET` and `TIMEZONE_CHANGED`;
- the exact-alarm permission change;
- every app start (when RecorderPlugin loads).

Each re-arm runs the pure `rearmPlan(schedules, now)`:
- **Future:** arm it, one alarm per schedule, keyed by its id.
- **In progress** (padded start ≤ now < padded end): start now through an exact alarm set a few seconds ahead, not directly from the boot receiver. Starting a data-sync foreground service from `BOOT_COMPLETED` is banned when targeting Android 15, and going through the alarm is safe on every version. Notify "Started late".
- **Over** (now ≥ padded end): mark it missed and notify once.
- **Done, missed or failed entries older than 7 days:** removed.

**When the alarm fires** (`ScheduleAlarmReceiver`, not exported; its PendingIntent carries **only the schedule id**):
1. Load the schedule.
2. Check the conflicts and storage (section 5).
3. Rebuild the URL (section 4).
4. Start `RecordingService` with the schedule id, programme title and padded end.
5. The service updates the schedule to recording, then done or failed.

Because the service lives in the app process, it runs without the WebView or Capacitor. The existing wake lock and Wi-Fi lock cover a box that has just woken up. The 2-minute early start gives the network time to come back, and the recorder's reconnect loop covers the rest.

## 4. Credentials (checked in SMC)

**Where SMC keeps the Player login today.**
- `src/lib/xtream.ts` `saveCreds()` writes `{host, username, password, output, serverLabel}` as JSON under `snow-livetv-creds-v1` in Capacitor Preferences. On Android that is the SharedPreferences file **`CapacitorStorage`**. It also keeps a copy in the WebView's localStorage.
- A second copy is `snow-player-account-v1`, which holds `host`, `username`, `password` and `maxConnections`. `loadCreds()` falls back to it.
- `clearCreds()` and `clearPlayerAccount()` remove both.
- **Native code can already read these:** `SmcNewsWidget.kt` reads `CapacitorStorage` / `snow-player-account-v1`.

**The scheduler design.**
- **Stored in the schedule** (`filesDir/record-schedules.json`, private to the app): `id, streamId, host, userTag, channelName, programmeTitle, startUtcMs, endUtcMs, padBeforeMin, padAfterMin, volumeId, maxConnectionsAtSchedule, status, reason, recordingId`.
  - `userTag` is the first 16 hex characters of SHA-256(host + "|" + username). It lets the app notice a switched account without storing the username.
  - No URL, username or password.
- **At fire time**, `LineCreds.kt` (new, the one place native reads the login) does this:
  1. Read `snow-livetv-creds-v1`, falling back to `snow-player-account-v1`.
  2. Check that the host and `userTag` match.
  3. Build `{host}/live/{enc(user)}/{enc(pass)}/{streamId}.ts`, the same address as `buildNativeLiveUrl`.
  4. Hand it straight to the service in-process. It is never stored, logged or put in a PendingIntent.

**Issues to flag.**
1. **Password stored as plain text** in SharedPreferences and localStorage. This isn't new; native reading it adds no new copy. OmniMax later moved its login to Keystore encryption (its commit `848325a`). If SMC does the same, only `LineCreds.kt` has to change.
2. **Encoding must match exactly.** Kotlin's `URLEncoder` is not `encodeURIComponent`: it turns a space into `+` and escapes `~ ! * ' ( )` differently. A password with those characters would give a different address and the provider would refuse it. `LineCreds.kt` needs its own helper that matches `encodeURIComponent`, pinned by shared test vectors.
3. **Duplicated key names.** The JS key names are private constants; native repeats them. A test reads `xtream.ts` and `LineCreds.kt` as raw text and checks the strings match.
4. **Only the main Player line can be scheduled.** LiveSection can show several lines, but the Guide uses the main `creds`, so that's correct today. If the Guide later shows other lines, the scheduler needs the saved-accounts store instead.
5. **No leaks elsewhere.** Notifications and the index carry the channel name and programme title only. The `dvrNative` test is extended to cover `ScheduleStore`, `LineCreds`, `RecordScheduler` and both receivers: no `url`, `password` or `username` in any log line or stored field.

## 5. Conflicts and failures (checked when you schedule and again when it fires)

**Stream limit.** Allowed at once = min(2, the plan's connections), counting manual and scheduled recordings together.
- **When scheduling:** if the padded times would overlap more recordings than allowed (after merging same-channel back-to-back ones), refuse: "You already have 2 recordings at 20:00. Cancel one first." On a 1-stream plan the limit is 1.
- **When it fires:** if the limit is already reached (manual recordings started meanwhile), mark it failed: "2 recordings were already running."

**Rewind + recording (this also applies to 25.4 and 25.7).**
- The rewind buffer is itself a stream. Change the gate from "the plan allows 2 or more" to **plan streams − active recordings ≥ 2**.
- When a recording starts on a 2-stream plan while you watch with rewind on, the buffer stops and the picture goes back to live, with a toast: "Rewind paused while recording (your plan's streams are in use)."
- This needs a native `recordingsChanged` event from RecorderPlugin, so the app hears about a scheduled start while it's open.

**1-stream line.** Scheduling is allowed, with the extra warning line (section 1). If the app is open and playing when the recording starts, it shows a toast; the notification says the same.

**Low storage when it fires.**
- The chosen drive is missing (USB unplugged): fall back to the box if it has at least 1 GB free plus 15 minutes' worth, and say so in the notification. Otherwise mark it failed ("The USB drive wasn't connected").
- The box is below 1 GB free: mark it failed ("Not enough free space").
- Mid-recording, the existing stop rules apply (1 GB floor on the box, 200 MB on USB, roll-over into parts on FAT32).

**Player signed out.** Sign-out now also **cancels all schedules** (added to `playerSignOut.ts` in 25.4, alongside stopping recordings), so this is rare. If there's no login at fire time anyway: failed, "Sign in to Live TV to record."

**Different line.** The login's host or `userTag` doesn't match: failed, "Live TV is signed in to a different line." Schedules aren't carried across accounts.

**Channel can't be recorded** (encrypted or fMP4 streams): failed, using the recorder's existing reason.

## 6. Notifications

All on the existing `smc_recordings` channel. On Android 13+ they only show if notifications are allowed. Whatever the notifications do, the Recordings screen always shows the status and reason.

- **Started:** the existing ongoing notification: "Recording The News (CNN) · until 21:05 · uses 1 stream on your line", with a [Stop] button.
- **Started late:** "Started late: The News (CNN). The box was off at 19:58. Recording until 21:05."
- **Failed:** "Scheduled recording didn't start: The News (CNN)", followed by the reason from section 5.
- **Missed:** "Missed recording: The News (CNN), 20:00–21:00. The box was off or SMC was force-stopped."
- **Stopped early** (drive full or removed): the existing recorder text.

## 7. Work items (after 25.9)

**25.10 Scheduling rules and tests** (no Android code, no UI)
- New `android/app/src/main/java/com/snowmedia/dvr/ScheduleRules.kt` (pure Kotlin, no Android imports):
  - `paddedWindow` (padding and the 12 h cap);
  - `mergeAdjacent` (same channel and line);
  - `conflicts(existing, candidate, cap)`;
  - `planAtFire` (start / start late / missed);
  - `rearmPlan(list, now)` (arm / start now / mark missed / purge after 7 days).
- New `LineCreds.kt` with `encodeUriComponent` and `buildLiveTsUrl`.
- New `src/lib/recordSchedule.ts`: programme UTC times from the listing, with the panel offset; padding settings (`smc-record-padding-v1`); the conflict preview and space estimate for the dialog.
- Shared vectors in `src/lib/recordSchedule.vectors.json`: padding, merges, conflicts, the missed policy, the re-arm list, and URL-encoding cases with space, `+ ~ ! * ' ( ) # % & /` and non-ASCII.
- Tests:
  - Kotlin JVM: `android/app/src/test/java/com/snowmedia/dvr/ScheduleRulesTest.kt` and `LineCreds` test, run on the Mac with `./gradlew :app:testDebugUnitTest`, like `EngineChoiceTest`.
  - vitest: `recordSchedule.test.ts`, reading the same vectors file, including an `encodeURIComponent` parity check.

**25.11 Native scheduler**
- New `ScheduleStore.kt`, `RecordScheduler.kt` (setAlarmClock, exact check, inexact fallback), `ScheduleAlarmReceiver.kt` and `RecordRearmReceiver.kt`.
- `RecordingService.kt` takes a schedule id, the padded end and a title, and updates the schedule's status. It sends the `recordingsChanged` event.
- New `RecorderPlugin` methods: `schedule`, `cancelSchedule`, `listSchedules`, `exactAlarmStatus`, `openExactAlarmSettings`. Re-arm when the plugin loads.
- Manifest:
  - `USE_EXACT_ALARM`;
  - `SCHEDULE_EXACT_ALARM` with `maxSdkVersion="32"`;
  - both receivers, not exported, except that the re-arm receiver must be exported for the system boot action, like the existing BootReceiver;
  - their actions.
- `SnowRecorder.ts` gets the new methods.
- `dvrNative.test.ts` additions: nothing stores a URL or password; the alarm PendingIntent carries only the id; the receivers are declared; `LineCreds.kt` key names match `xtream.ts`.

**25.12 Guide scheduling UI**
- `GuideSection.tsx`: hold OK (OK acts on release), the Record dialog in programme mode with the programme list, and red dots on scheduled programmes.
- `RecordDialog.tsx`: an optional "What" row, the padded-times label, the 1-stream warning, the space estimate and the conflict message.
- Kids and demo: off.
- Tests: `RecordDialog.test` (programme mode, the extra-stream line, a conflict refusal), and a new `GuideSection.record.test.tsx` (hold opens the dialog, a press plays, Kids gets no dialog).

**25.13 Recordings screen, settings and the Live bar chip**
- `RecordingsScreen.tsx`: the Scheduled group with Cancel, the missed/failed rows with Dismiss, and the exact-alarm banner.
- `RewindSettingsScreen.tsx` becomes "Rewind & recording", with the two padding rows; the `SettingsHub.tsx` label changes to match.
- The 25.7 dialog gets the "This programme (until …)" chip.

**25.14 Stream gate and sign-out**
- `useLiveRewind.ts`: the gate becomes streams − active recordings ≥ 2, reacting to `recordingsChanged`.
- `playerSignOut.ts`: also cancel all schedules. Update the `useLiveRewind` and `playerSignOut` tests.

**25.15 Updater guard and handover**
- `AppUpdater.tsx` / `AutoUpdatePrompt.tsx`: when a recording is running or one starts within 30 minutes, the prompt says "A recording is running/scheduled. Updating now will stop it", with Later as the default. Installing an update kills the app process, including the recording service.
- Update TRACKER, bump `versionCode`, run the full checks and the Mac unit tests.

## 8. Risks specific to scheduling

- **Force-stop deletes all alarms** and blocks the boot message until SMC is opened again. SMC can't detect it. The mitigation is re-arming at every app start; after a force-stop, the missed rows explain what happened.
- **A box that's truly powered off** (not in standby) can't record. That programme becomes "Missed" at the next boot.
- **Network after waking:** some Fire TV boxes take a while to reconnect after deep sleep. The 2-minute early start and the reconnect loop cover most cases. Needs a real standby test.
- **The listing is wrong or changes:** covered only by the padding. The panel time-zone fix applies only to scheduling, not to the Guide's displayed times.
- **Future targetSdk 35:** Android 15 caps data-sync foreground services at 6 hours per day and bans starting them from the boot receiver. The design already goes through an alarm; the daily cap would need a new service type then.
- **Google Play:** if SMC ever goes on Play, `USE_EXACT_ALARM` must be justified or dropped, and the refused-exact-alarm path becomes the normal one on Android 13+.
- **Password in plain text**, as described in section 4. Nothing new is added, but moving the login to Keystore should also update `LineCreds.kt`.
- **Kotlin can't be compiled or unit-tested here.** The Mac build and `testDebugUnitTest` are the first real run.

## Additions to the Ready to test checklist

- **Schedule from the Guide:** hold OK on a Guide channel, pick a programme starting in about 5 minutes, and choose Record this programme. The dialog should show the padded times and the extra-stream line, a red dot should appear in the Guide, and it should be listed under Recordings › Scheduled.
- **Box asleep:** schedule a programme, press Home, and let the box go to sleep. The recording should start by itself about 2 minutes before the programme, with a notification, and the file should be in Recordings afterwards.
- **Reboot:** schedule something 15 minutes ahead, then unplug and replug the box without opening SMC. It should still record.
- **Missed and late:** schedule a programme, unplug the box from before it starts until after it ends, and power back on. You should get a "Missed" notification and a Missed row. Then try powering back on halfway through a programme: it should start late, with a "Started late" notification.
- **Stream limit:** try to schedule 3 recordings at the same time. The third should be refused with a clear message.
- **Rewind vs recording on a 2-stream line:** watch with rewind while a scheduled recording starts. Rewind should pause with a toast and the picture should stay on.
- **Cancel:** cancel a schedule in Recordings. It should disappear and nothing should record.
- **Sign out:** sign out of Live TV. All schedules and running recordings should be gone.
- **Special-character password** (if you have such a line): a line whose password contains characters like `!`, `+` or a space should still record on schedule.
- **Settings:** change Start early and End late. New schedules should use the new times; existing ones should not change.
- **Kids profile:** holding OK in the Guide should do nothing.