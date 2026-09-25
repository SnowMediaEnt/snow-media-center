# Tracker

Single source of truth. One line per item: name · type · status · rung (bugs).
Status: building · ready to test · still broken · done.

| # | Item | Type | Status | Rung |
|---|------|------|--------|------|
| 1 | Plex buffers at 1080p/4K (Plex app fine on same box) — see bugs/plex-buffering.md | bug | still broken (better: early stalls only) | 2 → 3 next |
| 2 | Plex "Playback stats" panel (like the Plex app's stats) | feature | ready to test (build 39) | |
| 3 | Live TV Guide: Favorites first in the category row | feature | ready to test | |
| 4 | Back from Live TV / Plex goes Home; no flash of the old Player chooser | bug | ready to test | direct |
| 5 | Continue Watching: extra hardening (saves without the server, survives sign-in, Up Next) | bug | ready to test | direct |
| 6 | Favorites kept when leaving Live TV while they sync from the account | bug | ready to test | direct |
| 7 | Volume past 100% (up to 150%) in the players | feature | ready to test | |
| 8 | AI assistant never reads out usernames/passwords; knows Main Apps moved to Support | feature | ready to test | |

## Waiting on the owner
- Migration 20260930070000 + notify-ticket/telegram-notify deploy: held until you decide.
- snow-admin-app notify-admin header change: held until you decide.
- Quiet Live TV sign-in: should it switch away from a different account already signed in? (currently: no)

## Later
- SMC Updater helper app. Remote access "Connect" built into SMC + Hub.
