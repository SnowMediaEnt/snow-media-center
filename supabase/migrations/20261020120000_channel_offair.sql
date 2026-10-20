-- Live TV reports, take five: a channel OFF THE AIR, told by the box that
-- tried it. The owner (2026-10-20): "all down channels like this make it known
-- to all users on that service ... immediately and it's there until turned off
-- or starts streaming again".
--
-- 'offair' (channel_signals.kind): a box asked for the channel's stream and
-- the provider answered with a definite "not here" before any picture: HTTP
-- 404 / 410 for the stream address itself, or a 5xx again and again (the
-- native player's give-up, the app's isOffAirAnswer). The status number goes
-- in http_status (400-599); never the address.
--
-- The rule (channel_offair_list, below):
--   * ONE trusted offair signal marks the channel down for every box on that
--     host at once. Trusted is the same rule as every signal (20260930061000):
--     a box that signed a line in on that host, or has been sending analytics
--     for half an hour. Untrusted ones are kept for the Hub, never listed.
--   * It stays until a trusted 'ok' (a box played it fine for 12 s) or
--     'clear' (a viewer chose "It's working now") comes after it, or the admin
--     clears it from the Hub (admin_set with status ok or none deletes the
--     channel's offair signals), or an admin override covers it while that
--     override lasts.
--   * No three-hour expiry like a viewer's report.
--   * THE ONE DEVIATION from "until it streams again": a safety cap of 7 days.
--     An offair signal older than 7 days no longer counts, so a mark cannot
--     live forever on a channel nobody ever tries again (the next box that
--     tries it and gets the same answer marks it again at once). To change
--     it: every '7 days' in channel_offair_list here, and OFFAIR_KEEP_MS in
--     the channel-status function, which keeps offair / ok / clear rows that
--     long (every other signal still goes after two days).
-- Limits (in the function): the same per-device / per-IP hourly caps as every
-- other signal, and one device can mark at most 20 different channels off
-- the air in an hour (one IP 60), so a single broken box cannot blank a
-- line-up.
--
-- What boxes get: channel_down_list now includes these (source 'offair'), so
-- every app version shows them as down; the function also hands newer apps an
-- `offair` list so they can say "Off the air" instead of "Reported down". The
-- Hub's admin_list shows each one with its status code and when.
--
-- Safe to run twice. Nothing is renamed or dropped: channel_signals gains a
-- kind value and a nullable column; channel_down_list keeps its shape.
-- Apply BEFORE deploying the new channel-status function: it writes kind
-- 'offair' and http_status, which this adds.

-- 1. The kind and the status number.
alter table public.channel_signals drop constraint if exists channel_signals_kind_check;
alter table public.channel_signals add constraint channel_signals_kind_check
  check (kind in ('down', 'fail', 'ok', 'clear', 'buffering', 'offair'));

alter table public.channel_signals add column if not exists http_status smallint;
alter table public.channel_signals drop constraint if exists channel_signals_http_status_check;
alter table public.channel_signals add constraint channel_signals_http_status_check
  check (http_status is null or http_status between 400 and 599);

-- What channel_offair_list reads: a week of offair / ok / clear per host.
create index if not exists channel_signals_offair_idx on public.channel_signals (host, stream_id, created_at desc)
  where kind in ('offair', 'ok', 'clear');

-- 2. The channels off the air now on these hosts (null: every host with one,
-- for the Hub). Per channel: the newest trusted offair in the last 7 days is
-- newer than the newest trusted ok / clear, and no live admin override is on
-- it. `since` is the first offair after the last good word, `last_at` the
-- newest; the name and status code are the newest offair's. At most 500,
-- the newest first.
create or replace function public.channel_offair_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, http_status smallint, since timestamptz, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with chans as (
    select s.host, s.stream_id,
           max(s.created_at) filter (where s.kind = 'offair') as last_off,
           max(s.created_at) filter (where s.kind in ('ok', 'clear')) as last_good
    from public.channel_signals s
    where s.host = any(coalesce(p_hosts, array(
            select distinct x.host from public.channel_signals x
            where x.kind = 'offair' and x.trusted and x.created_at > now() - interval '7 days')))
      and s.created_at > now() - interval '7 days' and s.trusted
      and s.kind in ('offair', 'ok', 'clear')
    group by s.host, s.stream_id
  ),
  marked as (
    select c.host, c.stream_id, c.last_off, c.last_good
    from chans c
    where c.last_off is not null and (c.last_good is null or c.last_off > c.last_good)
      and not exists (
        select 1 from public.channel_overrides v
        where v.host = c.host and v.stream_id = c.stream_id and (v.expires_at is null or v.expires_at > now())
      )
    order by c.last_off desc
    limit 500
  )
  select m.host, m.stream_id, d.channel_name, d.http_status, d.since, m.last_off
  from marked m
  cross join lateral (
    select (array_agg(s.channel_name order by s.created_at desc) filter (where s.channel_name is not null))[1] as channel_name,
           (array_agg(s.http_status order by s.created_at desc))[1] as http_status,
           min(s.created_at) as since
    from public.channel_signals s
    where s.host = m.host and s.stream_id = m.stream_id and s.kind = 'offair' and s.trusted
      and s.created_at > now() - interval '7 days' and (m.last_good is null or s.created_at > m.last_good)
  ) d
  order by m.last_off desc;
$$;
revoke all on function public.channel_offair_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_offair_list(text[]) to service_role;

-- 3. channel_down_list: as in 20260930061000, plus the channels off the air
-- (source 'offair'; one row per channel: off the air wins over a viewer's
-- report or two boxes' failures on the same channel). Same shape, same cap.
create or replace function public.channel_down_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, since timestamptz, source text)
language sql stable security definer set search_path = public as $$
  with chans as (
    select s.host, s.stream_id,
           max(s.channel_name) as channel_name,
           max(s.created_at) filter (where s.kind = 'down') as last_report,
           min(s.created_at) filter (where s.kind = 'down') as first_report,
           count(distinct s.device_hash) filter (where s.kind = 'fail' and s.created_at > now() - interval '30 minutes') as fails,
           max(s.created_at) filter (where s.kind = 'fail' and s.created_at > now() - interval '30 minutes') as last_fail,
           min(s.created_at) filter (where s.kind = 'fail' and s.created_at > now() - interval '30 minutes') as first_fail,
           max(s.created_at) filter (where s.kind in ('ok', 'clear')) as last_good
    from public.channel_signals s
    where s.host = any(p_hosts) and s.created_at > now() - interval '3 hours' and s.trusted
    group by s.host, s.stream_id
  ),
  live_overrides as (
    select * from public.channel_overrides v
    where v.host = any(p_hosts) and (v.expires_at is null or v.expires_at > now())
  ),
  off_air as (
    select o.host, o.stream_id, o.channel_name, o.since, 'offair'::text as source
    from public.channel_offair_list(p_hosts) o
  ),
  down_now as (
    select c.host, c.stream_id, c.channel_name,
           case when c.last_report is not null and (c.last_good is null or c.last_report > c.last_good) then c.first_report else c.first_fail end as since,
           'crowd'::text as source
    from chans c
    where (
        (c.last_report is not null and (c.last_good is null or c.last_report > c.last_good))
        or (c.fails >= 2 and (c.last_good is null or c.last_fail > c.last_good))
      )
      and not exists (select 1 from live_overrides v where v.host = c.host and v.stream_id = c.stream_id)
      and not exists (select 1 from off_air o where o.host = c.host and o.stream_id = c.stream_id)
    union all
    select o.host, o.stream_id, o.channel_name, o.since, o.source
    from off_air o
    union all
    select v.host, v.stream_id, v.channel_name, v.updated_at, 'admin'::text
    from live_overrides v
    where v.status = 'down'
  )
  -- Every box downloads this list every minute or two and keeps it in
  -- memory: never more than 500, the admin's own marks first, then the newest.
  select d.host, d.stream_id, d.channel_name, d.since, d.source
  from down_now d
  order by (d.source = 'admin') desc, d.since desc nulls last
  limit 500;
$$;
revoke all on function public.channel_down_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_down_list(text[]) to service_role;
