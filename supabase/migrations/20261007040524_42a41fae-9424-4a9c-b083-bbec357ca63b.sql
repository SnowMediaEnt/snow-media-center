-- Live TV reports, take four: a whole category reported down, and channels
-- reported buffering. Both ride on the channel-status edge function and the
-- same rules as a channel reported down (20260930061000):
--   * only a box we know counts (trusted: it signed a line in on that host,
--     or has been sending analytics for half an hour); other signals are
--     kept for the Hub and never reach the boxes;
--   * limits per device id AND per IP (in the function);
--   * one trusted report is enough; a viewer's "It's working now" (clear)
--     or an admin override in the Hub ends it for everyone.
--
-- Buffering (channel_signals.kind = 'buffering'): a viewer reported the
-- channel buffering. Every box shows an amber mark and asks before playing
-- it, for 2 hours (down: 3). Buffering is usually the provider's load at a
-- busy hour and passes sooner than an outage, and the channel still plays,
-- so an old report would mostly turn people off a channel that is fine
-- again; 2 hours still covers a game or an event. A box playing it fine for
-- a few seconds ('ok') does NOT end it: buffering shows later than that.
-- Only a viewer's clear or the admin does.
--
-- Category down (category_signals): a viewer reported a whole Live TV
-- category down. Every channel in it shows as down on every box (the box
-- knows which channels are in which category; the server only keeps the
-- category id), for 3 hours like a channel. A clear, or a box that played
-- one of its channels fine ('ok'), ends it: the category is not all down.
-- The admin can mark a category down or working from the Hub
-- (category_overrides, like channel_overrides).
--
-- Who reported (the owner asked for it on every report): a viewer's own
-- report (down, buffering, a category down) carries the Live TV line's
-- username and how many of its connections were in use / allowed when it was
-- sent (line_user, active_cons, max_cons; null when the panel did not say in
-- time). Never the password or the host address. Automatic signals and
-- clears carry none. Like every signal, deleted after two days.
--
-- Safe to run twice. Nothing existing is renamed or dropped: channel_signals
-- only gains a kind value and three nullable columns; channel_down_list and
-- channel_signal_summary are untouched. Apply BEFORE deploying the new channel-status function (it
-- degrades to down channels only while the new functions are missing).

-- 1. 'buffering' joins the signal kinds.
alter table public.channel_signals drop constraint if exists channel_signals_kind_check;
alter table public.channel_signals add constraint channel_signals_kind_check
  check (kind in ('down', 'fail', 'ok', 'clear', 'buffering'));

alter table public.channel_signals add column if not exists line_user text;
alter table public.channel_signals add column if not exists active_cons integer;
alter table public.channel_signals add column if not exists max_cons integer;
alter table public.channel_signals drop constraint if exists channel_signals_line_user_len;
alter table public.channel_signals add constraint channel_signals_line_user_len
  check (line_user is null or char_length(line_user) <= 100);

-- 2. Category signals and overrides. Service role only: RLS on, no policies.
create table if not exists public.category_signals (
  id            bigserial   primary key,
  host          text        not null check (char_length(host) between 1 and 120),
  category_id   text        not null check (char_length(category_id) between 1 and 64),
  category_name text        check (category_name is null or char_length(category_name) <= 200),
  kind          text        not null check (kind in ('down', 'clear', 'ok')),
  device_hash   text        not null,
  ip_hash       text,
  trusted       boolean     not null default false,
  line_user     text        check (line_user is null or char_length(line_user) <= 100),
  active_cons   integer,
  max_cons      integer,
  created_at    timestamptz not null default now()
);
-- A table made by an earlier run of this file before these columns existed.
alter table public.category_signals add column if not exists line_user text;
alter table public.category_signals add column if not exists active_cons integer;
alter table public.category_signals add column if not exists max_cons integer;
create index if not exists category_signals_recent_idx on public.category_signals (host, created_at desc);
create index if not exists category_signals_category_idx on public.category_signals (host, category_id, created_at desc);
create index if not exists category_signals_device_idx on public.category_signals (device_hash, created_at desc);
create index if not exists category_signals_ip_idx on public.category_signals (ip_hash, created_at desc) where ip_hash is not null;
alter table public.category_signals enable row level security;

create table if not exists public.category_overrides (
  host          text        not null,
  category_id   text        not null,
  category_name text,
  status        text        not null check (status in ('down', 'ok')),
  note          text,
  expires_at    timestamptz,
  set_by        uuid,
  updated_at    timestamptz not null default now(),
  primary key (host, category_id)
);
alter table public.category_overrides enable row level security;

grant all on public.category_signals to service_role;
grant usage, select on sequence public.category_signals_id_seq to service_role;
grant all on public.category_overrides to service_role;

-- 3. The channels reported buffering now on these hosts (trusted signals,
-- the last 2 hours, not cleared since, no admin override on the channel).
-- At most 500, the newest first.
create or replace function public.channel_buffering_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, since timestamptz, source text)
language sql stable security definer set search_path = public as $$
  with chans as (
    select s.host, s.stream_id,
           max(s.channel_name) filter (where s.kind = 'buffering') as channel_name,
           max(s.created_at) filter (where s.kind = 'buffering') as last_report,
           max(s.created_at) filter (where s.kind = 'clear') as last_clear
    from public.channel_signals s
    where s.host = any(p_hosts) and s.created_at > now() - interval '2 hours' and s.trusted
      and s.kind in ('buffering', 'clear')
    group by s.host, s.stream_id
  )
  select c.host, c.stream_id, c.channel_name, c.last_report, 'crowd'::text
  from chans c
  where c.last_report is not null and (c.last_clear is null or c.last_report > c.last_clear)
    and not exists (
      select 1 from public.channel_overrides v
      where v.host = c.host and v.stream_id = c.stream_id and (v.expires_at is null or v.expires_at > now())
    )
  order by c.last_report desc
  limit 500;
$$;
revoke all on function public.channel_buffering_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_buffering_list(text[]) to service_role;

-- 4. The categories down now on these hosts: a trusted report in the last
-- 3 hours with no clear or 'ok' after it, or the admin's mark. At most 100,
-- the admin's own marks first, then the newest.
create or replace function public.category_down_list(p_hosts text[])
returns table (host text, category_id text, category_name text, since timestamptz, source text)
language sql stable security definer set search_path = public as $$
  with cats as (
    select s.host, s.category_id,
           coalesce(max(s.category_name) filter (where s.kind = 'down'), max(s.category_name)) as category_name,
           max(s.created_at) filter (where s.kind = 'down') as last_report,
           max(s.created_at) filter (where s.kind in ('ok', 'clear')) as last_good
    from public.category_signals s
    where s.host = any(p_hosts) and s.created_at > now() - interval '3 hours' and s.trusted
    group by s.host, s.category_id
  ),
  live_overrides as (
    select * from public.category_overrides v
    where v.host = any(p_hosts) and (v.expires_at is null or v.expires_at > now())
  ),
  down_now as (
    select c.host, c.category_id, c.category_name, c.last_report as since, 'crowd'::text as source
    from cats c
    where c.last_report is not null and (c.last_good is null or c.last_report > c.last_good)
      and not exists (select 1 from live_overrides v where v.host = c.host and v.category_id = c.category_id)
    union all
    select v.host, v.category_id, v.category_name, v.updated_at, 'admin'::text
    from live_overrides v
    where v.status = 'down'
  )
  select d.host, d.category_id, d.category_name, d.since, d.source
  from down_now d
  order by (d.source = 'admin') desc, d.since desc nulls last
  limit 100;
$$;
revoke all on function public.category_down_list(text[]) from public, anon, authenticated;
grant execute on function public.category_down_list(text[]) to service_role;

-- 5. For the Hub. Per channel: how many boxes reported it buffering since
-- p_since (trusted), next to channel_signal_summary's counts.
create or replace function public.channel_buffering_summary(p_since timestamptz)
returns table (host text, stream_id integer, channel_name text, buffering bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.host, s.stream_id,
         max(s.channel_name),
         count(distinct s.device_hash),
         max(s.created_at)
  from public.channel_signals s
  where s.created_at >= p_since and s.trusted and s.kind = 'buffering'
  group by s.host, s.stream_id
  order by max(s.created_at) desc
  limit 1000;
$$;
revoke all on function public.channel_buffering_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.channel_buffering_summary(timestamptz) to service_role;

-- Per category, the same shape as channel_signal_summary: reports, boxes
-- that played one of its channels fine, clears, and ignored (untrusted)
-- signals. Trusted ones first, so a flood cannot push them off.
create or replace function public.category_signal_summary(p_since timestamptz)
returns table (
  host text, category_id text, category_name text,
  reports bigint, working bigint, cleared bigint, ignored bigint,
  last_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select s.host, s.category_id,
         coalesce(max(s.category_name) filter (where s.trusted), max(s.category_name)),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'down'),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'ok'),
         count(distinct s.device_hash) filter (where s.trusted and s.kind = 'clear'),
         count(*) filter (where not s.trusted),
         coalesce(max(s.created_at) filter (where s.trusted), max(s.created_at))
  from public.category_signals s
  where s.created_at >= p_since
  group by s.host, s.category_id
  order by bool_or(s.trusted) desc, max(s.created_at) desc
  limit 300;
$$;
revoke all on function public.category_signal_summary(timestamptz) from public, anon, authenticated;
grant execute on function public.category_signal_summary(timestamptz) to service_role;

-- 6. For the Hub: who sent the reports since p_since (trusted ones with a
-- line): channel or category, the report kind, the line's username and its
-- connections at the time. Newest first, at most 500.
create or replace function public.report_lines(p_since timestamptz)
returns table (
  scope text, host text, stream_id integer, category_id text, kind text,
  line_user text, active_cons integer, max_cons integer, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'channel'::text, s.host, s.stream_id, null::text, s.kind, s.line_user, s.active_cons, s.max_cons, s.created_at
    from public.channel_signals s
    where s.created_at >= p_since and s.trusted and s.line_user is not null and s.kind in ('down', 'buffering')
    union all
    select 'category'::text, c.host, null::integer, c.category_id, c.kind, c.line_user, c.active_cons, c.max_cons, c.created_at
    from public.category_signals c
    where c.created_at >= p_since and c.trusted and c.line_user is not null and c.kind = 'down'
  ) r (scope, host, stream_id, category_id, kind, line_user, active_cons, max_cons, created_at)
  order by r.created_at desc
  limit 500;
$$;
revoke all on function public.report_lines(timestamptz) from public, anon, authenticated;
grant execute on function public.report_lines(timestamptz) to service_role;