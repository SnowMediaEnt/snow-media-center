**Game Day matcher: diagnosis and fixes (plan only; no code or DB was changed)**

**In short:** Game Day finds a game's channels in two ways. It matches channel names, and when a game's list opens it reads the guide of a few likely channels. Peacock02 was never one of the channels it looked at, because the code assumes Peacock is only an app and never a channel. ESPN, the zone channels and the team channels were listed from their names alone. The guide check can add a channel or lower one's rank, but it can never take one away. The fix has three parts:
- Read the guide of numbered streaming feeds (Peacock 02, ESPN+ 07, Prime 03 and so on).
- List national networks only when the guide backs them up.
- In the playoffs, drop zone channels, and show team and regional channels only when their guide shows the game.

**Owner decisions (with my recommendation)**
1. **Channels the guide can't confirm.** These have no guide at all, or only a generic entry like "MLB Baseball". Show them at the bottom under "Not confirmed by the guide", or hide them? I recommend showing them at the bottom. A channel whose guide shows something else is always hidden either way.
2. **League channels renamed for a playoff game.** These are the league's own numbered channels, like "MLB 05: … @ White Sox" in the MLB ZONE category. Should they be listed in the playoffs only when their guide confirms the game? I recommend yes. They are usually MLB.tv / Extra Innings feeds, which don't carry playoff games, and the Hub can still add one by hand.

## 1. Diagnosis (`src/lib/gameDay.ts`)

**A. Why Peacock02 was missed**
- **Peacock is never matched as a channel.** `STREAMING_ONLY` includes Peacock, and `aliasList()` drops streaming names, so "Peacock" in the game's `networks` never matches a channel. The file header says so outright: "Streaming-only services … are never links: no line carries them as a channel." This provider does carry them, as numbered feeds.
- **The name doesn't help.** "US| PEACOCK 02" doesn't name the game, so `eventScore()` can't match it.
- **Its guide is never read.** `checkGuides()` only looks at:
  - networks and locals already found by name;
  - the league's numbered channels (`isNumberedEvent` needs an MLB word in the name or category);
  - league and team links;
  - channels named after the teams' cities.

  A Peacock feed is none of these.
- **It may not even be loaded.** `loadSportsChannels()` keeps a channel only if its category weighs more than 0 or its name has a sport or league word.
  - "US| PEACOCK" passes, but only because of the "US".
  - "PEACOCK", "PEACOCK TV" and "STREAMING" weigh 0.
  - On low-memory boxes, only the top 24 weighted categories are read.
- **The row misleads the viewer.** It says "Peacock (streaming only)", which tells them it isn't on their service.

**B. Why ESPN, zone and team channels were listed for a playoff game**
- **Zone and league channels.** `channelsForGame()` adds up to 4 of the league's own channels (score 30) to every game of that league, by name alone: "MLB Zone", "MLB Network" and so on. The fix for bug 18 only moved the zone ones into their own group. They are still listed for every MLB game, and none of them carries playoff games.
- **Team channels.** Any channel named after either team scores 60, for example "MLB: Chicago White Sox". These are the teams' local (regional network / MLB.tv) feeds. Playoff games are national-only, so those feeds show a studio show or a slate.
- **ESPN.** A network in the game's `networks` matches by name.
  - An exact match scores 70.
  - "ESPN 01", "ESPN EVENT 05" and "ESPN 8 The Ocho" also count as "a feed of ESPN" (scores 52 or 62).
  - I couldn't read today's ESPN data from here (the proxy blocks it), so I can't confirm ESPN is in this game's `networks`. One `game-day {op:'list'}` call would show it. The fix below works either way.
- **Nothing ever removes a name match.** `checkGuides()` either confirms a channel (score 95) or, only when the guide shows another game from the same league, lowers it to 20 with a note. It stays listed either way. "SportsCenter", a college football game, a pregame show or no guide at all leave the link as it was.
- **The row and "Remind me" never check the guide.** They use the name matches only (`rows` → `pick`). So the row can show ESPN or a team channel, and the reminder's Watch goes straight to it at kickoff.
- **Nothing knows it's the playoffs.** The `game-day` function doesn't pass on ESPN's season type.

## 2. Fixes

**F1. Find streaming-service feeds by their guide (`gameDay.ts`)**
1. **Tag feeds once per channel.** In `sportsChannel()`, set `service?: string` from the cleaned name when it looks like `<service> [event|sports|live|ppv|ch|channel|feed|premium] <1–3 digit number>`:
   - peacock
   - prime: "prime video", "amazon prime", "amazon", or "prime" only when followed by the number (so "Prime Ticket" isn't a feed)
   - espnplus: "espn+", "espn plus", or plain "espn" followed by a leading-zero number or an event word (see F2)
   - apple: "apple tv+", "apple tv", "apple"
   - netflix
   - max: "hbo max", or "max" only when followed by a number (so Cinemax and ActionMAX aren't feeds)
   - paramount: "paramount+", "paramount plus"
   - dazn, fubo, foxone, youtube, nflplus
   - league passes: mlb tv / extra innings, nba league pass, nhl center ice, mls season pass, sunday ticket
   - Never tag a name containing "24/7".
2. **Load the feeds.**
   - `categoryWeight()`: a category that names a service weighs 2. Apply this after `NOT_SPORTS`, so "NETFLIX MOVIES" stays 0.
   - `loadSportsChannels()`, whole line-up path: also keep any channel with a `service` tag, whatever its category.
3. **Add `gameServices(game)`.** It returns, in this order:
   - the game's own streaming services from `networks`;
   - then the streaming partners of its TV networks:
     - NBC, NBCSN, USA, Telemundo → peacock
     - ABC, ESPN, ESPN2, ESPNU, SECN, ACCN → espnplus
     - CBS, CBSSN → paramount
     - TNT, TBS, truTV → max
     - FOX, FS1, FS2, BTN → foxone
4. **Check the feeds' guides.** In `checkGuides()`, add a new candidate group after the numbered channels:
   - It covers feeds whose `service` is in `gameServices(game)`, in that order, up to `GUIDE_MAX.service = 8`.
   - These are taken whatever their category (the PPV rule doesn't apply to them).
   - If the guide has the game, return `{ via: 'game', score: 95, note }`, the same as a numbered league channel. Otherwise the feed is never listed.
5. **Update the header comment.** Remove "streaming-only … never links".

**F2. Numbered network feeds aren't the network**
- `networkScore()` returns 0 when the only thing after the network name is a leading-zero number, or an event word plus a number ("ESPN 01", "ESPN EVENT 05", "FOX EVENT 2").
- "FOX 32 Chicago", "FOX 5 New York" and "ESPN HD" are unchanged.
- Add the alias `nbcsn: ['nbcsn', 'nbc sports network']`.

**F3. Let the guide decide; don't list a channel on a guess**
1. **Give each checked link a verdict.** `GameChannel` gets `guide?: 'yes' | 'other' | 'none'`. `checkGuides()` returns a verdict for every name-matched link it reads (`cand.was`):
   - **'yes':** a listing around kickoff has this game. Score 95 plus the note, as now.
   - **'other':** there are listings around kickoff, none has this game, and they name another game (any league) or nothing of this game's league or sport. Examples: "SportsCenter", "College Football", a movie. This replaces the score-20 "another game" path.
   - **'none':** there is no listing around kickoff, the lookup failed, or the listing is a generic one for this league without teams ("MLB Baseball").
   - Numbered, service and city candidates still come back only on 'yes'.
2. **Add a pure function `arrangeLinks(game, links, scanning)`** that returns `{ main, unconfirmed, zone }`:
   - A link with `via: 'game'` or guide 'yes' goes in `main`.
   - Guide 'other' drops the link, whatever its kind.
   - A 'network' link without 'yes' is hidden while the guide is being checked, then goes in `unconfirmed` (or is dropped, if the owner answers "hide" to question 1).
   - 'team', 'local' and 'league' links without a verdict:
     - regular season: go in `main`, as today;
     - playoffs: hidden while checking, then dropped.
   - 'zone' links go in the `zone` group, but are dropped in the playoffs.
   - Playoffs, if the owner answers yes to question 2:
     - A 'game' link on a league feed without 'yes' is dropped. A league feed (`isLeagueFeed`) is an in-league channel whose name starts with a league word and a number, like "MLB 05".
     - `checkGuides()` sends these league feeds to the guide in the playoffs (up to 4).
3. **Build the channel list from the groups.** In `GameDaySection.tsx`, `pickItems` becomes:
   - `mergeLinks([extra, found])`, then `arrangeLinks(game, merged, picker.scanning)`;
   - then show `main`;
   - then a non-focusable "Not confirmed by the guide" heading and the `unconfirmed` group, done like the zone heading (`firstUnconfirmedIdx`);
   - then the zone heading and group;
   - then Browse.
   - Sorting inside each group stays as it is today.
4. **Rows and reminders.**
   - Each row's `pick` and `more` come from `arrangeLinks(g, found, false).main` only.
   - After a game's list has been opened, keep its guide answer (from `lay(extra, true)`) in a `guided` state map. Clear it with the 10-minute channel refresh. That way a confirmed network can become the row's channel.
   - `remind()` still stores the row's pick. So a reminder never stores a guessed network or team channel. With no pick, the reminder opens the game's list at kickoff, using the existing `openGameDayGame`.
5. **Row text when there's no pick.**
   - Something may still be waiting on the guide: a name-matched network, or a feed of one of `gameServices` on this box. For this, work out a set of the services on the box once per channel list. In that case, show the new `gameDay.checkOn` text instead of "not in your channels" or "(streaming only)".
   - "(streaming only)" stays for services the box has no feeds of.

**F4. Playoffs**
1. **Pass the season from ESPN.** In `supabase/functions/game-day/index.ts`, `fetchLeague()`:
   - add `postseason: true` when `e.season?.type === 3 || e.season?.slug === 'post-season'`;
   - add `round` from `comp.notes?.[0]?.headline` (for example "AL Wild Card - Game 1");
   - make both optional on the `Game` interfaces in the function and in `gameDay.ts`.
   - **The owner must redeploy `game-day`.** Until then, boxes use the regular-season rules, which still fix ESPN and Peacock02.
2. **Skip league-own channels.** In `channelsForGame()`, in the playoffs, skip the league-own / zone step (score 30) entirely. Team and local name matches still go to the guide.

**New text**
Add these to `gameDay.json` in en, es, fr, de and ar (the parity test checks this):
- `gameDay.unconfirmedHeading`: "Not confirmed by the guide — may not have this game"
- `gameDay.checkOn`: "{{networks}} — press Watch to check your guide"

**Must stay the same**
- **Remote:** headings are not focusable. Up/Down/OK, hold-OK to report, Back and Left work as now. The highlight stays on its channel when the guide reorders the list.
- **Kids:** Game Day stays hidden on Little and Kids profiles.
- **Unchanged areas:** demo mode, the PPV list, ⚠️ and reporting, and Live TV (not touched).
- **Chrome 66:** reuse the zone heading's classes.
- **Low-memory boxes:** the service tag is worked out once per channel. The change adds at most 8 more short guide lookups, only when a game's list opens, 4 at a time.

**Files that will change**
- `src/lib/gameDay.ts`
- `src/components/livetv/GameDaySection.tsx`
- `supabase/functions/game-day/index.ts`
- `src/i18n/locales/{en,es,fr,de,ar}/gameDay.json`
- `src/lib/gameDay.test.ts`
- `src/components/livetv/GameDaySection.test.tsx`
- `src/test/edge/gameDay.test.ts`
- `android/app/build.gradle` (versionCode 52 → 53)
- `TRACKER.md`

`GameDaySection.lines.test.tsx` and `GameDaySection.report.test.tsx` should pass unchanged, because they use a name-matched NFL game channel.

## Tests

**`src/lib/gameDay.test.ts` (add)**
- **Service feed tagging.**
  - Tagged as feeds: "US| PEACOCK 02", "PEACOCK EVENT 02", "ESPN+ 07", "ESPN PLUS 07", "US| ESPN 01", "PRIME VIDEO 03", "APPLE TV 01", "MAX 04", "PARAMOUNT+ 05", "NBA LEAGUE PASS 03".
  - Not feeds: "US| ActionMAX", "US| MAX", "FanDuel Sports Prime Ticket", "NETFLIX 24/7: Stranger Things", "US| ESPN HD".
- **Loading.** `categoryWeight` gives 2 for "PEACOCK" and "US| PEACOCK", and 0 for "NETFLIX MOVIES". `loadSportsChannels` keeps "PEACOCK 02" from a "STREAMING" category.
- **Peacock02 found by its guide.** White Sox game with networks ['Peacock']:
  - PEACOCK 01 shows another programme, PEACOCK 02's guide has the game, PEACOCK 03 has no guide.
  - Result: only 02, as `via: 'game'`, score 95, with its note.
  - Networks ['NBC'] gives the same result (Peacock is NBC's partner).
  - Networks ['FOX'] makes no Peacock lookups.
- **Numbered network feeds.** "ESPN 01" and "ESPN EVENT 05" don't count as ESPN. "FOX 32 Chicago" still counts as FOX.
- **Verdicts and `arrangeLinks`.**
  - ESPN showing SportsCenter is dropped.
  - "MLB Baseball" or no guide puts it under unconfirmed.
  - The game itself puts it in main with score 95.
  - While the guide is being checked, network links aren't shown.
- **Playoffs.** A playoff White Sox game with these channels:
  - MLB Zone
  - "MLB: Chicago White Sox" (no guide)
  - US| ESPN (SportsCenter)
  - US| PEACOCK 02 (guide has the game)
  - "EVENT 03: … White Sox" in a LIVE EVENTS category
  - "MLB 05: … White Sox" in MLB ZONE (no guide)

  Result: main is EVENT 03 and PEACOCK 02, and nothing else. MLB 05 is kept only if the owner answers no to question 2.
- **Same channels, regular season.** The team channel stays, MLB Zone goes in the zone group, ESPN is dropped, and Peacock02 is found.
- **Update "confirms the networks … flags one with another game".** FOX 25 Boston now gets 'other' and is dropped; there is no score-20 note any more.
- **nbcsn alias.**

**`src/test/edge/gameDay.test.ts` (add)**
- An MLB board with a playoff event:
  - `season: { type: 3, slug: 'post-season' }`
  - notes "AL Wild Card - Game 1"
  - NBC and Peacock

  The result has `postseason: true` and `round`. A regular-season event has neither.
- Update the `check` counts, since mlb is no longer 0.

**`GameDaySection.test.tsx` (update / add)**
- **Update "Watch lists…":**
  - FOX 5, matched by name only, isn't in the list while the guide is being checked.
  - After an empty guide answer, it appears under "Not confirmed by the guide".
  - OK still plays the picked channel.
- **Update "the guide's answer arriving later…"** for the new order.
- **Add: a Peacock-only game when the box has Peacock feeds.**
  - The row says "Peacock — press Watch to check your guide".
  - The list shows the confirmed PEACOCK 02, and OK plays it.
- **Add:** a playoff game lists no zone or team channel.
- **Add:** "Remind me" on a game whose only match is a name-matched network stores no channel.

## Risks
- **Fewer links for channels with poor or missing guides.** Question 1 softens this, and the Hub can add channels.
- **More lookups.** Up to 8 more guide lookups each time a game's list opens.
- **Playoff rules depend on the redeploy.** They only work after `game-day` is redeployed.
- **ESPN's names for 2026 playoff networks are unconfirmed here.** Check the White Sox game once in `game-day`'s list after the deploy.

**Note for the app-side spec of `game_day_channel_edits`**
- **Hosts don't line up as-is.** The table's `service` has no port, but the app's line and ⚠️ keys keep it (`normalizeHost` gives "dstreams.xyz:8080").
  - Compare hosts without the port.
  - That also covers dstreams on port 2083.
- **Admin-added links go in last.** Merge them after `arrangeLinks`, so no matcher rule can drop them.
- **Hide applies everywhere.** Apply 'hide' to the row's pick and to reminders as well.
---
# Owner decisions (adopted recommendations; owner may override)
1. Channels the guide can't confirm (no guide / generic "MLB Baseball"): SHOW them at the bottom under "Not confirmed by the guide". A channel whose guide shows something else is always hidden.
2. Playoffs: league feeds like "MLB 05: … @ White Sox" are listed only when their guide confirms the game (the Hub can still add one by hand).
- Owner channel edits (game_day_channel_edits, build 52) are applied LAST, after arrangeLinks, via applyChannelEdits(), so no matcher rule can drop an owner 'add'; 'hide' also applies to row pick and reminders.
- The game-day edge function redeploy (postseason/round fields) is done by the orchestrator through Lovable.
