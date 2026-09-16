-- Snow Media Center — the questions this app's analytics can answer, and the
-- SQL that answers them. Paste any block into the Supabase SQL editor for the
-- SMC project. Every query is read-only.
--
-- Everything lands in one table:
--   analytics_events(device_id, session_id, user_id, event_name,
--                    event_category, properties jsonb, app_version,
--                    platform, occurred_at)
--
-- Counts come from *_play / *_click / *_open events. Time comes from the
-- *_dwell and *_watch events, which each carry properties->>'duration_seconds'
-- (and 'recovered' = true when the box was switched off mid-watch, so the
-- figure is the last heartbeat rather than a real stop).

-- ── The Player ──────────────────────────────────────────────────────────────

-- Who goes into the Player at all, by day.
select date_trunc('day', occurred_at)::date       as day,
       count(*)                                    as opens,
       count(distinct device_id)                   as boxes,
       count(*) filter (where (properties->>'has_creds')::boolean)          as signed_in,
       count(*) filter (where (properties->>'content_bar_used')::boolean)   as browsed_bar_first
from analytics_events
where event_name = 'player_open'
  and occurred_at > now() - interval '30 days'
group by 1 order by 1 desc;

-- Live TV vs Movies & Series vs Backups vs Guide vs Multi-Screen: how many
-- times each is entered, and by how many boxes.
select properties->>'mode'            as section,
       count(*)                       as entries,
       count(distinct device_id)      as boxes
from analytics_events
where event_name = 'mode_enter'
  and occurred_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- Time spent in each section of the Player.
select properties->>'mode'                                              as section,
       count(*)                                                          as visits,
       round(sum((properties->>'duration_seconds')::numeric) / 3600, 1)  as hours,
       round(avg((properties->>'duration_seconds')::numeric) / 60, 1)    as avg_minutes
from analytics_events
where event_name = 'mode_dwell'
  and occurred_at > now() - interval '30 days'
group by 1 order by 3 desc;

-- DreamStreams or VibezTV: which service the people using the Player are on.
select coalesce(properties->>'service', '(unknown)')  as service,
       count(*)                                        as player_opens,
       count(distinct device_id)                       as boxes
from analytics_events
where event_name = 'player_open'
  and occurred_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- Watch time, by what was being watched. channel_watch is Live TV,
-- plex_watch is Movies & Series, movie/series_watch are the panel's VOD,
-- backup_watch is the Backups section.
select event_name                                                        as kind,
       count(*)                                                          as sessions,
       round(sum((properties->>'duration_seconds')::numeric) / 3600, 1)  as hours,
       round(avg((properties->>'duration_seconds')::numeric) / 60, 1)    as avg_minutes,
       count(*) filter (where properties->>'recovered' = 'true')          as box_switched_off
from analytics_events
where event_name in ('channel_watch','plex_watch','movie_watch','series_watch','backup_watch')
  and occurred_at > now() - interval '30 days'
group by 1 order by 3 desc;

-- Live TV watch time split by service.
select coalesce(properties->>'service', '(unknown)')                     as service,
       count(*)                                                          as channel_sessions,
       round(sum((properties->>'duration_seconds')::numeric) / 3600, 1)  as hours,
       round(avg((properties->>'duration_seconds')::numeric) / 60, 1)    as avg_minutes
from analytics_events
where event_name = 'channel_watch'
  and occurred_at > now() - interval '30 days'
group by 1 order by 3 desc;

-- What is actually being watched in Movies & Series, by total time.
select properties->>'title'                                              as title,
       properties->>'type'                                               as type,
       count(*)                                                          as plays,
       round(sum((properties->>'duration_seconds')::numeric) / 60, 0)    as minutes
from analytics_events
where event_name = 'plex_watch'
  and occurred_at > now() - interval '30 days'
group by 1, 2 order by 4 desc nulls last limit 25;

-- ── Making an account on the TV ─────────────────────────────────────────────

-- The sign-up funnel, step by step. signup_open is reaching the screen,
-- then the service, then Trial or Buy a plan, then a line that really exists.
select event_name,
       count(*)                   as times,
       count(distinct device_id)  as boxes
from analytics_events
where event_category = 'signup'
  and occurred_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- Trial against paid, as a straight comparison.
select case event_name
         when 'signup_trial_click' then 'chose trial'
         when 'signup_paid_click'  then 'chose to buy'
         when 'signup_complete'    then 'finished with a line'
       end                        as step,
       count(*)                   as times,
       count(distinct device_id)  as boxes
from analytics_events
where event_name in ('signup_trial_click','signup_paid_click','signup_complete')
  and occurred_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- ── Games ───────────────────────────────────────────────────────────────────

-- Does anyone go to the games, and do they have chips when they get there.
select date_trunc('day', occurred_at)::date  as day,
       count(*)                               as visits,
       count(distinct device_id)              as boxes,
       count(*) filter (where properties->>'signed_in' = 'true')   as signed_in
from analytics_events
where event_name = 'games_open'
  and occurred_at > now() - interval '30 days'
group by 1 order by 1 desc;

-- Which games get opened, and how long people stay in each one.
select coalesce(o.game, d.game)                       as game,
       o.opens,
       d.sessions,
       d.hours,
       d.avg_minutes
from (
  select properties->>'game' as game, count(*) as opens
  from analytics_events
  where event_name = 'game_open' and occurred_at > now() - interval '30 days'
  group by 1
) o
full join (
  select properties->>'game'                                             as game,
         count(*)                                                        as sessions,
         round(sum((properties->>'duration_seconds')::numeric)/3600, 1)  as hours,
         round(avg((properties->>'duration_seconds')::numeric)/60, 1)    as avg_minutes
  from analytics_events
  where event_name = 'game_dwell' and occurred_at > now() - interval '30 days'
  group by 1
) d on d.game = o.game
order by 2 desc nulls last;

-- Coins: how many are put down each day, and in which game.
select date_trunc('day', occurred_at)::date   as day,
       properties->>'game'                     as game,
       count(*)                                as wagers,
       sum((properties->>'coins')::numeric)    as coins,
       count(distinct device_id)               as boxes
from analytics_events
where event_name = 'game_wager'
  and occurred_at > now() - interval '30 days'
group by 1, 2 order by 1 desc, 4 desc;

-- Coins per sitting, so "a session" is a real number rather than a feeling.
select round(avg(coins), 0)                                as avg_coins_per_session,
       round(percentile_cont(0.5) within group (order by coins)::numeric, 0) as median,
       max(coins)                                          as biggest_session,
       count(*)                                            as sessions
from (
  select session_id, sum((properties->>'coins')::numeric) as coins
  from analytics_events
  where event_name = 'game_wager'
    and session_id is not null
    and occurred_at > now() - interval '30 days'
  group by 1
) s;

-- Free chips claimed from the daily spin.
select date_trunc('day', occurred_at)::date  as day,
       count(*)                               as claims,
       sum((properties->>'coins')::numeric)   as coins_given
from analytics_events
where event_name = 'daily_spin_claim'
  and occurred_at > now() - interval '30 days'
group by 1 order by 1 desc;

-- ── The content bar on the home screen ──────────────────────────────────────

-- Is it used at all, or does everyone walk straight past it into the Player.
select count(*) filter (where event_name = 'content_bar_open')   as bar_opened,
       count(*) filter (where event_name = 'content_bar_item')   as items_opened,
       count(*) filter (where event_name = 'player_open')        as player_opens,
       round(
         100.0 * count(*) filter (where event_name = 'player_open'
                                    and properties->>'content_bar_used' = 'true')
         / nullif(count(*) filter (where event_name = 'player_open'), 0), 1
       )                                                          as pct_browsed_bar_first
from analytics_events
where occurred_at > now() - interval '30 days';

-- Time spent in the bar, and what gets pressed in it.
select round(sum((properties->>'duration_seconds')::numeric)/60, 0)  as minutes_in_bar,
       round(avg((properties->>'duration_seconds')::numeric), 0)     as avg_seconds_per_visit,
       count(*)                                                       as visits
from analytics_events
where event_name = 'content_bar_dwell'
  and occurred_at > now() - interval '30 days';

select properties->>'source'  as source,
       properties->>'kind'    as kind,
       count(*)               as opened
from analytics_events
where event_name = 'content_bar_item'
  and occurred_at > now() - interval '30 days'
group by 1, 2 order by 3 desc;

-- ── Time spent on every screen, not just the Player ─────────────────────────

select event_name                                                        as screen,
       count(*)                                                          as visits,
       round(sum((properties->>'duration_seconds')::numeric) / 3600, 1)  as hours,
       round(avg((properties->>'duration_seconds')::numeric))            as avg_seconds
from analytics_events
where event_name like '%\_dwell' escape '\'
  and occurred_at > now() - interval '30 days'
group by 1 order by 3 desc;
