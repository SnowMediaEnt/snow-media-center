-- Down channels: the ⚠️ on a Live TV channel that isn't working right now.
--
-- Boxes send small signals through the channel-status edge function:
--   down  a viewer reported "Channel down"
--   fail  the channel failed to start on a box
--   ok    a channel shown as down played fine on a box
-- A channel is down when, in the last 30 minutes, the signals add up to 3 or
-- more (a report counts 2, a failure 1, each box once) and no box has played
-- it since the last bad signal. An admin can also mark a channel down or
-- working for a while from the Hub (channel_overrides).
--
-- Service role only: RLS on, no policies. The function answers the app.

create table if not exists public.channel_signals (
  id           bigserial   primary key,
  host         text        not null check (char_length(host) between 1 and 120),
  stream_id    integer     not null,
  channel_name text        check (channel_name is null or char_length(channel_name) <= 200),
  kind         text        not null check (kind in ('down', 'fail', 'ok')),
  device_hash  text        not null,
  created_at   timestamptz not null default now()
);
create index if not exists channel_signals_recent_idx on public.channel_signals (host, created_at desc);
create index if not exists channel_signals_channel_idx on public.channel_signals (host, stream_id, created_at desc);
create index if not exists channel_signals_device_idx on public.channel_signals (device_hash, created_at desc);
alter table public.channel_signals enable row level security;

create table if not exists public.channel_overrides (
  host         text        not null,
  stream_id    integer     not null,
  channel_name text,
  status       text        not null check (status in ('down', 'ok')),
  note         text,
  expires_at   timestamptz,
  set_by       uuid,
  updated_at   timestamptz not null default now(),
  primary key (host, stream_id)
);
alter table public.channel_overrides enable row level security;

grant all on public.channel_signals to service_role;
grant usage, select on sequence public.channel_signals_id_seq to service_role;
grant all on public.channel_overrides to service_role;

-- The channels down right now on these hosts.
create or replace function public.channel_down_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, since timestamptz, source text)
language sql stable security definer set search_path = public as $$
  with recent as (
    select s.host, s.stream_id,
           max(s.channel_name) as channel_name,
           count(distinct s.device_hash) filter (where s.kind = 'down') as downs,
           count(distinct s.device_hash) filter (where s.kind = 'fail') as fails,
           min(s.created_at) filter (where s.kind in ('down', 'fail')) as first_bad,
           max(s.created_at) filter (where s.kind in ('down', 'fail')) as last_bad
    from public.channel_signals s
    where s.host = any(p_hosts) and s.created_at > now() - interval '30 minutes'
    group by s.host, s.stream_id
  ),
  live_overrides as (
    select * from public.channel_overrides v
    where v.host = any(p_hosts) and (v.expires_at is null or v.expires_at > now())
  )
  select r.host, r.stream_id, r.channel_name, r.first_bad, 'crowd'::text
  from recent r
  where (2 * r.downs + r.fails) >= 3
    and not exists (
      select 1 from public.channel_signals o
      where o.host = r.host and o.stream_id = r.stream_id and o.kind = 'ok' and o.created_at > r.last_bad
    )
    and not exists (select 1 from live_overrides v where v.host = r.host and v.stream_id = r.stream_id)
  union all
  select v.host, v.stream_id, v.channel_name, v.updated_at, 'admin'::text
  from live_overrides v
  where v.status = 'down';
$$;
revoke all on function public.channel_down_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_down_list(text[]) to service_role;

-- Down channels, take two: one viewer's word is enough.
--
--   down   a viewer reported "Channel down": the channel shows ⚠️ on every
--          box, for up to three hours, until someone clears it
--   clear  a viewer held OK on it and chose "It's working now": gone for
--          everyone (a box that plays it fine, 'ok', does the same)
--   fail   the channel failed to start on a box: two boxes in half an hour
--          mark it, the same way
-- Admin overrides (channel_overrides) still win over all of it.

alter table public.channel_signals drop constraint if exists channel_signals_kind_check;
alter table public.channel_signals add constraint channel_signals_kind_check
  check (kind in ('down', 'fail', 'ok', 'clear'));

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
    where s.host = any(p_hosts) and s.created_at > now() - interval '3 hours'
    group by s.host, s.stream_id
  ),
  live_overrides as (
    select * from public.channel_overrides v
    where v.host = any(p_hosts) and (v.expires_at is null or v.expires_at > now())
  )
  select c.host, c.stream_id, c.channel_name,
         case when c.last_report is not null and (c.last_good is null or c.last_report > c.last_good) then c.first_report else c.first_fail end,
         'crowd'::text
  from chans c
  where (
      (c.last_report is not null and (c.last_good is null or c.last_report > c.last_good))
      or (c.fails >= 2 and (c.last_good is null or c.last_fail > c.last_good))
    )
    and not exists (select 1 from live_overrides v where v.host = c.host and v.stream_id = c.stream_id)
  union all
  select v.host, v.stream_id, v.channel_name, v.updated_at, 'admin'::text
  from live_overrides v
  where v.status = 'down';
$$;
revoke all on function public.channel_down_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_down_list(text[]) to service_role;

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