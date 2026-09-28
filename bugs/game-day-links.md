# Game Day: wrong link names and extra links (NFL)

## What's broken
1. In Game Day (e.g. NFL), a game's channel link takes you to the RIGHT channel, but the link's name
   still shows "A&E" instead of that channel's name.
2. For one NFL game (the 5 PM game, 2026-09-27), Game Day listed 4 links under "NFL teams", but only 2
   were real team channels; the other 2 came from the "NFL zone" (e.g. NFL RedZone-type) channels.
   Other games that day were correct.

## How the owner reproduces it
Live TV → Game Day → NFL → pick a game → Watch. Look at the link names and how many links show.

## Tried

### Rung 1 (fixed)

**1. Wrong link name.** `GameDaySection`'s channel picker builds its list from
two sources: the plain matches (`channelsForGame`) and the guide's confirmed
matches (`checkGuides`, run once when the picker opens). The guide-confirmed
entries were placed first in the dedupe, so if the *same* channel also sits
in the plain list with a name that changed after the guide check ran (a
provider reuses/renames an event channel for the day's games — `CHANNELS_TTL_MS`
itself says this can happen within the ten minutes a stale list is still
served), the picker kept showing the name from the moment the guide checked it,
not the box's current name for that channel. The `stream_id` never changes,
so pressing it always played the right channel — only the label was stale.
Fixed with a new `mergeLinks()` (`src/lib/gameDay.ts`): it still prefers the
guide-confirmed score/via/note, but always takes the channel's *current* name
from the live channel list. `GameDaySection.tsx`'s `pickItems` now calls it
instead of doing its own dedupe.

**2. Extra "NFL zone" links on one game.** `checkGuides` re-checks a game's
league/team-kind links against their own EPG guide, to confirm or demote them.
A whip-around channel like "NFL RedZone" or "NFL Zone" was being fed into that
same re-check (it had `via: 'league'`, same as "NFL Network"). Its guide
listing legitimately names *every* game airing at that moment, so whenever a
kickoff's window happened to be the one such a listing was describing, the
zone channel's guide text matched that one game's teams and got promoted to a
95-score "confirmed" link — for that game only, never the others (their
kickoff windows didn't line up with what RedZone's listing happened to say).
Fixed in `src/lib/gameDay.ts`: added a `'zone'` link kind, separate from
`'league'` (`ZONE_CHANNEL` regex catches "zone"/"redzone" by name); a channel
actually renamed for a specific game — "NBA ZONE 3: Lakers @ Celtics" — still
matches as `'game'` first, unaffected. `checkGuides`'s league/team re-check
loop only takes `'league'`/`'team'`, so `'zone'` channels are never confirmed
or promoted from guide text anymore. In `GameDaySection.tsx`, zone links are
sorted after everything else and shown under their own "Zone channels — every
game of the league, not just this one" heading, badged "Zone channel" —
never "Team channel".

Files changed: `src/lib/gameDay.ts`, `src/components/livetv/GameDaySection.tsx`.
Tests added: `src/lib/gameDay.test.ts` (`mergeLinks` describe block; the zone
classification test; the "never confirms a zone channel from its guide" test
in the `checkGuides` describe block — each written to fail before the fix and
verified to do so), `src/components/livetv/GameDaySection.test.tsx` ("shows a
whip-around zone channel (RedZone) in its own section, never as a team link").
`tsc`, `eslint` on the changed files, the full `vitest run` (145 files / 1182
tests) and `npm run build` all pass.
