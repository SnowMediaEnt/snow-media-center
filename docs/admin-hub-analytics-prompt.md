# Prompt for the Snow Admin Hub (Lovable)

Paste everything below the line into the Snow Admin Hub project's chat. It is
written to be self-contained: event names, property names, the read path, and
the panels to build.

---

Read-only analytics work in this Hub only. Do NOT change the Snow Media Center
app, any Supabase edge function, any table, any RLS policy, or any migration.
Do not create SQL functions. You are adding pages and panels that read
`analytics_events` in the shared SMC project, the same way
`src/routes/_authenticated/player-analytics.tsx` already does.

## What changed in the TV app

Snow Media Center 1.7.2 added time tracking and a lot of new events. Every
"how long" event carries `properties->>'duration_seconds'` and
`properties->>'duration_minutes'` as numbers, plus `properties->>'recovered'`
= `true` when the box was switched off mid-activity (the figure is then the
last 30-second heartbeat, not a real stop). Older app versions send none of
this, so every new panel must render cleanly with zero rows and say the data
starts at app 1.7.2.

### Player (`event_category = 'player'`)

| event | properties |
| --- | --- |
| `player_open` | `has_creds` bool, `service` ("DreamStreams" / "VibezTV" / null), `content_bar_used` bool |
| `mode_enter` | `mode` (`live`, `plex`, `movies`, `series`, `guide`, `multi`, `backups`), `service` |
| `mode_dwell` | `mode`, `service`, `duration_seconds`, `duration_minutes`, `recovered?`, `ended_by?` |
| `channel_watch` | `channel`, `category`, `service`, `duration_seconds`, … |
| `plex_watch` | `title`, `type` (`movie` / `episode`), `duration_seconds`, … |
| `movie_watch` | `title`, `duration_seconds`, … |
| `series_watch` | `series`, `episode_index`, `duration_seconds`, … |
| `backup_watch` | `kind`, `title`, `duration_seconds`, … |
| `livetv_dwell` | `view`, `duration_seconds` — time inside the Player as a whole |

Already existing and already on the page: `channel_play`, `movie_play`,
`series_play`, `plex_play`, `backup_play`, `player_search`, `player_error`,
`livetv_signin`.

### Games (`event_category = 'games'`)

| event | properties |
| --- | --- |
| `games_open` | `signed_in` bool, `has_balance` bool or null |
| `game_open` | `game` (`slots`, `blackjack`, `video-poker`, `roulette`, `casino-holdem`, `daily-spin`) |
| `game_dwell` | `game`, `view`, `duration_seconds`, `duration_minutes`, `recovered?` |
| `games_dwell` | `view` = `games` — time on the hub screen itself, not in a game |
| `game_wager` | `game`, `coins` (what was put down), `balance_after`, and sometimes `action` (`double`, `ante`, `call`), `multiplier`, `wheel`, `bets` |
| `daily_spin_claim` | `coins` (given away), `balance_after` |

### Making an account on the TV (`event_category = 'signup'`)

`signup_open` → `signup_offers` (`dreamstreams` bool, `vibez` bool, `resumed`
bool) → `signup_service` (`service`) → `signup_trial_click` or
`signup_paid_click` (`service`) → `signup_vibez_plan` (`plan`) →
`signup_complete` (`service`, `host`). `signup_dwell` carries the time spent
in the flow.

### Home screen and the content bar (`event_category = 'navigation'`)

`content_bar_open`, `content_bar_dwell` (`duration_seconds`),
`content_bar_item` (`source`, `kind`, `title`), and a `<view>_dwell` for every
other screen (`home_dwell`, `support_dwell`, `store_dwell`, `games_dwell`, …)
with `view` and `duration_seconds`.

## How to read it

- Use the existing client: `supabase` from `@/integrations/supabase/db`, the
  same call shape as `player-analytics.tsx`. No new clients, no service-role
  key in the browser.
- Filter by `event_name in (...)` per panel rather than pulling a whole
  category. The dwell events are high volume and the old 10,000-row cap will
  silently truncate a 30-day window.
- For plain counts use `select("id", { count: "exact", head: true })`.
- When rows are genuinely needed, page with `.range(from, from + 999)` in a
  loop until a page returns fewer than 1000, like
  `src/lib/plex/plex-store.server.ts` does, so a total is never half a total.
- Numbers arrive as strings out of JSONB: `Number(props.duration_seconds)`,
  and drop anything non-finite.
- Keep the existing window selector (7 / 14 / 30 / 90 days) and the "last
  updated" line.

## What to build

### 1. Extend `/player-analytics`

Add to the summary row, respecting the selected window:

- **Watch time**, total hours across `channel_watch`, `plex_watch`,
  `movie_watch`, `series_watch`, `backup_watch`, with a sub-line giving the
  average session length in minutes.
- **Service split**: DreamStreams against VibezTV, counted from
  `player_open.service`, and a second figure for Live TV hours by service from
  `channel_watch`.
- **Straight to the Player**: the share of `player_open` events where
  `content_bar_used` is false, labelled so it reads as "skipped the content
  bar".

Add these panels:

- **Time by section** — bar chart of `mode_dwell` hours by `mode`, next to the
  existing mode_enter counts, so entries and time sit side by side.
- **Watch time by kind** — table: kind, sessions, hours, average minutes, and
  a column for how many ended because the box was switched off (`recovered`).
- **Most watched in Movies & Series** — from `plex_watch`, ranked by total
  minutes, not by play count, with plays as a second column.
- **Sign-up funnel** — a small funnel or ordered bar list: reached the screen,
  picked a service, chose Trial, chose Buy a plan, finished with a line.
  Show DreamStreams and VibezTV separately where the events carry a service,
  and put the trial-to-completion and paid-to-completion rates in plain
  percentages.

### 2. New page `/games-analytics`

Create `src/routes/_authenticated/games-analytics.tsx` and register it in the
`NAV` array in `src/routes/_authenticated.tsx` (label "Games Analytics", a
suitable lucide icon, next to Player Analytics).

- Summary: visits to the games hub, distinct boxes, share of visits that were
  signed in, total coins wagered, coins given away by the daily spin, total
  hours played.
- **Daily chart**: coins wagered per day, with a second line for distinct
  boxes playing.
- **By game**: table of game, opens, sessions, hours, average minutes, coins
  wagered, sorted by coins. Use `game_open` for opens, `game_dwell` for time,
  `game_wager` for coins.
- **Coins per sitting**: average, median and biggest, grouped by `session_id`
  from `game_wager`.
- **Daily spin**: claims per day and coins given away.

### 3. Content bar panel

On `/analytics` (or a card on the dashboard, whichever fits better): bar
opened, items opened from it, time spent in it, and the percentage of Player
opens that had browsed the bar first. One sentence under it saying plainly
whether people use the bar or walk past it.

## House rules

- Match the existing look: same `Card` / `SummaryCard` / `ScrollTable` /
  `EmptyHint` components, same recharts usage, same `var(--color-chart-N)`
  colours, no new chart library.
- Empty states everywhere, since these events only exist from app 1.7.2 and
  most boxes will take days to update.
- Round hours to one decimal, minutes to whole numbers, and use
  `toLocaleString()` for counts.
- Don't add write actions, exports or anything that mutates data.
