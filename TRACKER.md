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

## Waiting on the owner
- Migration 20260930070000 + notify-ticket/telegram-notify deploy: held until you decide.
- snow-admin-app notify-admin header change: held until you decide.
- Quiet Live TV sign-in: should it switch away from a different account already signed in? (currently: no)

## Later
- SMC Updater helper app. Remote access "Connect" built into SMC + Hub.
