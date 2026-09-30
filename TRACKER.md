# Tracker

Single source of truth. One line per item: name · type · status · rung (bugs).
Status: building · ready to test · still broken · done.

| # | Item | Type | Status | Rung |
|---|------|------|--------|------|
| 1 | Plex buffers at 1080p/4K (Plex app fine on same box) | bug | done (fixed at rung 3, 1.7.9) | 3 |
| 2 | Plex "Playback stats" panel (like the Plex app's stats) | feature | ready to test (1.7.9) | |
| 3 | Live TV Guide: Favorites first in the category row | feature | ready to test | |
| 4 | Back from Live TV / Plex goes Home; no flash of the old Player chooser | bug | done | direct |
| 5 | Continue Watching: extra hardening (saves without the server, survives sign-in, Up Next) | bug | ready to test | direct |
| 6 | Favorites kept when leaving Live TV while they sync from the account | bug | ready to test | direct |
| 7 | Volume past 100% (up to 150%) in the players | feature | ready to test | |
| 8 | AI assistant never reads out usernames/passwords; knows Main Apps moved to Support | feature | ready to test | |
| 9 | Plex 4K has trouble after 1.7.9 (1080p fine) | bug | done (fixed at rung 2, 1.8.0) | 2 |
| 10 | Some ISPs block Live TV lists (no VPN needed now) | bug | done (fixed at rung 2, 1.8.0) | 2 |
| 11 | Guide Favorites hint said "press F" (remotes have no letters) — now "hold OK… Add to Favorites" | bug | ready to test | direct |
| 12 | Green bar at the bottom during Plex "Getting ready…" — see bugs/plex-green-bar.md | bug | ready to test (1.8.0 build 44) | 2 |
| 13 | Show-password eye button on every password field (Live TV sign-in and everywhere) | feature | planned, waiting on owner's 4 answers | |
| 14 | Player corner shows a faint "Snow Media Ent." instead of the version number | feature | ready to test (build 44) | |
| 15 | Dashboard Sign Out signs out of both the Snow Media account and Live TV | feature | ready to test (build 44) | |
| 16 | MPV player as a second Live TV player, switchable in Live TV settings (ExoPlayer stays) | feature | ready to test (build 46; MPV test builds only, SMC_WITH_MPV=true) | |
| 17 | Game Day: link name shows "A&E" though it plays the right channel — see bugs/game-day-links.md | bug | ready to test (fixed at rung 1) | 1 |
| 18 | Game Day NFL: a game listed 4 links, 2 were NFL-zone channels — see bugs/game-day-links.md | bug | ready to test (fixed at rung 1) | 1 |
| 19 | MPV: black screen, "buffering", skips every half second; Compare memory shows 0 MB — see bugs/mpv-black-screen.md | bug | ready to test (build 47) | 2 |
| 20 | Settings → UI: removed the Profiles card (Profiles has its own menu item and Settings tab) | feature | ready to test | |
| 21 | Home content bar restyled like the clone's "Recommended" row (heading, bare posters, title under each, no band; arrows + page dots kept) | feature | ready to test | |
| 22 | Home top: date/time/buttons higher, full-colour "Snow Media Center" title, taller RSS strip under the title (not across it) | feature | ready to test | |
| 23 | Home: Plex card shows "(VOD)" under the name | feature | ready to test | |
| 24 | Home: bottom cards shorter, content bar bigger and centred evenly between the RSS strip and the cards; small "Recommended" | feature | ready to test | |
| 25 | Live TV recording + rewind + scheduled recording (port from OmniMax) — plan: .claude/plan-rewind-record.md. Rewind only when the line has a free stream | feature | ready to test (build 48) | |
| 25.1 | Rewind/record logic libraries (liveRewind, recording, skipQueue) | feature | ready to test (build 48) | |
| 25.2 | Native rewind (dvr/ timeshift + SnowPlayerPlugin hooks, ExoPlayer only) | feature | ready to test (build 48) | |
| 25.3 | Native recorder (foreground service, box/USB, 1 GB floor, FAT32 parts, 2 at once, CH+/CH-) | feature | ready to test (build 48) | |
| 25.4 | useLiveRewind hook (2+ stream gate, MPV off) + sign-out wipes/stops | feature | ready to test (build 48) | |
| 25.5 | Player bar: Back 10s / Go live / Record, timeline, -0:45 badge | feature | ready to test (build 48) | |
| 25.6 | Live TV wiring: rewind, catch-up, remote keys (Rew/FF = 10 s, ▲▼ CH+/CH- change channel) | feature | ready to test (build 48) | |
| 25.7 | Record dialog (hold OK / bar Record) with the extra-stream notice | feature | ready to test (build 48) | |
| 25.8 | Recordings screen (play, rename, delete, stop) | feature | ready to test (build 48) | |
| 25.9 | Rewind settings screen | feature | ready to test (build 48) | |
| 25.10 | Scheduling rules + shared tests (padding, conflicts, missed, re-arm, URL encoding) | feature | ready to test (build 48) | |
| 25.11 | Native scheduler (exact alarms, reboot re-arm, no credentials stored) | feature | ready to test (build 48) | |
| 25.12 | Guide: hold OK to schedule a programme, red dots | feature | ready to test (build 48) | |
| 25.13 | Recordings: Scheduled/Missed groups; Rewind & recording settings (padding) | feature | ready to test (build 48) | |
| 25.14 | Stream gate counts recordings; sign-out cancels schedules | feature | ready to test (build 48) | |
| 25.15 | Updater warns when a recording is running/soon; build 48 handover | feature | ready to test (build 48) | |

| 26 | Player bar: name of the highlighted button shows under it (small line) | feature | ready to test (build 48) | |
| 28 | Live TV sign-in: username capitals turned to lowercase (falls back to as-typed if the panel refuses) | feature | ready to test (build 48) | |
| 29 | Every screen changes language (es/fr/de/ar; English default; Arabic text, screens stay left-to-right; AI + Plex follow the language) — plan: .claude/plan-i18n.md | feature | ready to test (build 49) | |
| 30 | Game Day uses every signed-in Live TV line, with a service tag (DreamStreams/Vibez) on each link | feature | ready to test (build 50) | |
| 31 | Live TV hold-OK: short channel menu (Favorite, Report, Record…) instead of the full Record dialog | feature | ready to test (build 51) | |
| 32 | Game Day: hold OK on a link to report a channel down | feature | ready to test (build 51) | |
| 33 | Player bar: Report button while a live channel plays | feature | ready to test (build 51) | |
| 34 | Game Day applies the owner's channel picks from the admin app/Hub (add first + "Picked by Snow Media", hide, down ⚠️ last) | feature | ready to test (build 52) | |
| 35 | Game Day finds streaming feeds (Peacock 02 etc.) by guide; networks/team/zone channels only when the guide confirms (playoffs) | bug | ready to test (build 53) | direct |
| 27 | Canvas + All-Pro Streams: bring up to date with SMC (no MPV, each keeps its own brand). Canvas 2.3 build 15 ready to test (branch claude/canvas-2.3); APS waiting on GitHub access or Lovable | feature | Canvas ready to test; APS waiting | |

## Waiting on the owner
- Redeploy snow-media-ai (AI answers in the chosen language) and publish the phone remote page (web/phone-remote).
- APS: add SnowMediaEnt as collaborator on DJ341972/all-pro-streams, or we go through Lovable.
- Migration 20260930070000 + notify-ticket/telegram-notify deploy: held until you decide.
- snow-admin-app notify-admin header change: held until you decide.
- Quiet Live TV sign-in: should it switch away from a different account already signed in? (currently: no)

## Later
- Guide shows programme times in the box's time zone, not the panel's (found while planning 25; separate fix).
- MPV before customers: libmpv prints stream URLs (with line logins) to the box's log; needs a small native shim or local proxy first (see bugs/mpv-black-screen.md).
- SMC Updater helper app. Remote access "Connect" built into SMC + Hub.
