-- Down channels, take three: one real box's report still marks a channel
-- for every box, but a script can no longer do it for a whole line-up.
--
-- The signal needs no sign-in, and its only limit (40 an hour) was per
-- device id, which the caller makes up. A script sending a new id with every
-- request could put ⚠️ on every channel of a host for three hours, clear real
-- reports, and bury the Hub's Down Channels page under junk rows.
--
-- The channel-status edge function now also:
--   * counts signals per caller IP (ip_hash, a salted hash; an IPv6 /64
--     counts as one): at most 20 'down'/'clear' and 200 signals of any kind
--     an hour, next to the per-device 10 and 40;
--   * marks a signal trusted only when it comes from a box the service has
--     seen before: one that signed a verified line in on that host
--     (player_signins.device_id) or that has been sending analytics for
--     half an hour or more (analytics_sessions). Other signals are kept (the
--     Hub shows them as ignored) but never change what boxes see.
-- Here: the two columns, channel_down_list counting trusted signals only and
-- returning at most 500 channels, and channel_signal_summary for the Hub's
-- list (per-channel counts in SQL instead of the newest 2000 raw rows, which
-- a flood pushed real reports out of).
--
-- Rows written before this have no ip_hash and count as trusted, as they
-- always did. Apply this BEFORE deploying the new channel-status function:
-- it writes and counts the new columns.

alter table public.channel_signals add column if not exists ip_hash text;
alter table public.channel_signals add column if not exists trusted boolean not null default true;
create index if not exists channel_signals_ip_idx on public.channel_signals (ip_hash, created_at desc) where ip_hash is not null;
-- The "known box" lookup by device id.
create index if not exists player_signins_device_idx on public.player_signins (device_id) where device_id is not null;

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
    union all
    select v.host, v.stream_id, v.channel_name, v.updated_at, 'admin'::text
    from live_overrides v
    where v.status = 'down'
  )
  -- Every box downloads this list every two minutes and keeps it in memory:
  -- never more than 500, the admin's own marks first, then the newest.
  select d.host, d.stream_id, d.channel_name, d.since, d.source
  from down_now d
  order by (d.source = 'admin') desc, d.since desc nulls last
  limit 500;
$$;
revoke all on function public.channel_down_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_down_list(text[]) to service_role;

-- The Hub's Down Channels list: per channel, how many boxes reported it,
-- failed on it, played it and cleared it since p_since (trusted signals), and
-- how many signals were ignored. At most 1000 channels: those with a trusted
-- signal first, so a flood of untrusted ones cannot push them off, then the
-- most recently mentioned. The name comes from a trusted signal when there
-- is one, so an untrusted one cannot rename a real channel on the page.
create or replace function public.channel_signal_summary(p_since timestamptz)
returns table (
  host text, stream_id integer, channel_name text,
  reports bigint, failures bigint, working bigint, cleared bigint, ignored bigint,
  last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.host, s.stream_id,
         coalesce(max(s.channel_name) filter (where s.trusted), max(s.channel_name)),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'down'),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'fail'),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'ok'),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'clear'),
         count(*) filter (where not s.trusted),
         coalesce(max(s.created_at) filter (where s.trusted), max(s.created_at))
  from public.channel_signals s
  where s.created_at >= p_since
  group by s.host, s.stream_id
  order by bool_or(s.trusted) desc, max(s.created_at) desc
  limit 1000;
$$;
revoke all on function public.channel_signal_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.channel_signal_summary(timestamptz) to service_role;
