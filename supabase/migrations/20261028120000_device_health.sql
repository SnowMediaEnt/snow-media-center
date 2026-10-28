-- Device health: what goes wrong on a Snow Media Center box, as the box saw it.
--
-- Every box keeps a light log (only when something goes wrong: a stall, a
-- player error, a crash, the app killed, the panel refusing the line) and
-- sends it to the device-health edge function. An admin can switch a box to
-- a 7-day deep check (device_health_checks): the box then also sends an
-- app_start and periodic samples (memory, CPU, Wi-Fi, buffer, bitrate).
-- A customer can also run a 30-second check from Fix a problem / a channel
-- report (kind 'check', with per-second samples); at most 6 per box a day.
--
-- A box is the device-inbox key it already has: rows carry the key's sha256
-- (device_inbox.key_hash), never the key. The function refuses a key that is
-- not registered for the line the box names (unknown_key / other_line), as
-- device-inbox checkin does. Lines are named the way device_inbox names them
-- (host as capture-player-signin normalizes it, username lowercased).
--
-- No passwords, tokens, stream URLs or query strings are stored: the function
-- drops any string that looks like one before it writes a row.
--
-- Kept 90 days (daily pg_cron job below, like refresh-player-signins-daily).
--
-- Service role only: RLS on with no policies, and nothing granted to anon or
-- authenticated. Only the edge function reads or writes these.

create table if not exists public.device_health_events (
  id            uuid        primary key default gen_random_uuid(),
  key_hash      text        not null,
  host          text        not null,
  username      text        not null,
  customer_id   uuid        null,
  app_version   text        not null default '',
  version_code  integer     null,
  device_model  text        not null default '',
  os_version    text        not null default '',
  kind          text        not null check (kind in ('stall', 'player_error', 'crash', 'killed', 'auth_error', 'app_start', 'sample', 'check')),
  verdict       text        not null check (verdict in ('device_overload', 'internet', 'server', 'account', 'app_crash', 'unknown')),
  summary       text        not null default '' check (char_length(summary) <= 200),
  context       text        null check (context is null or context in ('live', 'vod', 'series', 'plex', 'catchup', 'app')),
  title         text        null check (title is null or char_length(title) <= 120),
  data          jsonb       not null default '{}'::jsonb,
  -- Only on a customer-run 30-second check (kind 'check'): up to 30 rows of
  -- up to 8 numbers, [t, bufferedAheadSec, arrivalKbps, droppedFrames, cpuPct, memAvailMb, stalled].
  samples       jsonb       null check (samples is null or (kind = 'check' and jsonb_typeof(samples) = 'array' and jsonb_array_length(samples) <= 30)),
  deep          boolean     not null default false,
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
-- A box's timeline, and its 24 h caps.
create index if not exists device_health_events_key_idx on public.device_health_events (key_hash, occurred_at desc);
-- A line's boxes (customer page, admin filters).
create index if not exists device_health_events_line_idx on public.device_health_events (host, username, occurred_at desc);
-- "Boxes that ran out of memory this week" and the like.
create index if not exists device_health_events_verdict_idx on public.device_health_events (verdict, occurred_at desc);
-- The 24 h caps count by arrival (created_at), so a box can't dodge them with old occurred_at stamps.
create index if not exists device_health_events_key_created_idx on public.device_health_events (key_hash, created_at desc);
-- The unfiltered summary (every box's last 30 days of problems) and the cleanup.
create index if not exists device_health_events_problems_idx on public.device_health_events (occurred_at desc) where kind not in ('app_start', 'sample');
create index if not exists device_health_events_created_idx on public.device_health_events (created_at);
create index if not exists device_health_events_customer_idx on public.device_health_events (customer_id, occurred_at desc) where customer_id is not null;

-- A deep check an admin switched on for one box, until deep_until.
create table if not exists public.device_health_checks (
  key_hash      text        primary key,
  deep_until    timestamptz not null,
  requested_by  uuid        null,
  requested_at  timestamptz not null default now()
);

alter table public.device_health_events enable row level security;
alter table public.device_health_checks enable row level security;

revoke all on public.device_health_events from public, anon, authenticated;
revoke all on public.device_health_checks from public, anon, authenticated;
grant all on public.device_health_events to service_role;
grant all on public.device_health_checks to service_role;

-- Per box over the last 30 days: its real stops (stall, player_error, crash,
-- killed, auth_error) by verdict, with its latest one; customer-run checks
-- and box restarts (a power cut / reboot while SMC was on screen) counted
-- apart, never as stops; deep-check readings (app_start / sample) left out.
-- Worst first. The admin "Device health" list and a customer's boxes
-- (device-health admin_devices). Filters are optional; a null one matches
-- everything. A customer is matched by the events' customer_id OR by its
-- boxes' key hashes (p_key_hashes), as admin_events does.
drop function if exists public.device_health_box_summary(text, text, uuid, integer);
create or replace function public.device_health_box_summary(
  p_host text default null,
  p_username text default null,
  p_customer_id uuid default null,
  p_limit integer default 200,
  p_key_hashes text[] default null
)
returns table (
  key_hash text, host text, username text, customer_id uuid, device_model text, app_version text,
  counts jsonb, problems_7d integer, problems_30d integer, checks_30d integer, restarts_30d integer,
  last_kind text, last_verdict text, last_summary text, last_title text, last_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select e.key_hash, e.host, e.username, e.customer_id, e.device_model, e.app_version,
           e.kind, e.verdict, e.summary, e.title, e.occurred_at,
           (e.kind = 'killed' and e.data->>'exitReason' = 'box_restarted') as restart,
           (e.kind <> 'check' and not (e.kind = 'killed' and coalesce(e.data->>'exitReason', '') = 'box_restarted')) as stop
    from public.device_health_events e
    where e.occurred_at >= now() - interval '30 days'
      and e.kind not in ('app_start', 'sample')
      and (p_host is null or e.host = p_host)
      and (p_username is null or e.username = p_username)
      and (p_customer_id is null or e.customer_id = p_customer_id or e.key_hash = any(coalesce(p_key_hashes, '{}'::text[])))
  ),
  agg as (
    select ev.key_hash,
           (count(*) filter (where ev.stop and ev.occurred_at >= now() - interval '7 days'))::integer as problems_7d,
           (count(*) filter (where ev.stop))::integer as problems_30d,
           (count(*) filter (where ev.kind = 'check'))::integer as checks_30d,
           (count(*) filter (where ev.restart))::integer as restarts_30d
    from ev group by ev.key_hash
  ),
  by_verdict as (
    select v.key_hash, jsonb_object_agg(v.verdict, v.n) as counts
    from (select ev.key_hash, ev.verdict, count(*)::integer as n from ev where ev.stop group by ev.key_hash, ev.verdict) v
    group by v.key_hash
  ),
  latest as (
    select distinct on (ev.key_hash) ev.key_hash, ev.kind, ev.verdict, ev.summary, ev.title, ev.occurred_at
    from ev where ev.stop order by ev.key_hash, ev.occurred_at desc
  ),
  info as (
    select distinct on (ev.key_hash) ev.key_hash, ev.host, ev.username, ev.customer_id, ev.device_model, ev.app_version, ev.occurred_at
    from ev order by ev.key_hash, ev.occurred_at desc
  )
  select a.key_hash, i.host, i.username, i.customer_id, i.device_model, i.app_version,
         coalesce(b.counts, '{}'::jsonb), a.problems_7d, a.problems_30d, a.checks_30d, a.restarts_30d,
         l.kind, l.verdict, l.summary, l.title, l.occurred_at
  from agg a
  join info i on i.key_hash = a.key_hash
  left join by_verdict b on b.key_hash = a.key_hash
  left join latest l on l.key_hash = a.key_hash
  order by a.problems_7d desc, a.problems_30d desc, coalesce(l.occurred_at, i.occurred_at) desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.device_health_box_summary(text, text, uuid, integer, text[]) from public, anon, authenticated;
grant execute on function public.device_health_box_summary(text, text, uuid, integer, text[]) to service_role;

-- 90-day cleanup: events older than 90 days, and deep checks that ended
-- more than 90 days ago.
create or replace function public.device_health_cleanup()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.device_health_events where created_at < now() - interval '90 days';
  delete from public.device_health_checks where deep_until < now() - interval '90 days';
$$;

revoke all on function public.device_health_cleanup() from public, anon, authenticated;
grant execute on function public.device_health_cleanup() to service_role;

-- Daily at 04:20 UTC. Idempotent: the DO block swallows 'job not found' on
-- the first run (as 20260803155815 does for refresh-player-signins-daily).
do $$
begin
  perform cron.unschedule('device-health-cleanup-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'device-health-cleanup-daily',
  '20 4 * * *',
  $$select public.device_health_cleanup()$$
);
