-- Live TV reports, take five: a channel OFF THE AIR, told by the boxes that
-- tried it. The owner (2026-10-20): "all down channels like this make it
-- known to all users on that service ... immediately and it's there until
-- turned off or starts streaming again".
--
-- 'offair' (channel_signals.kind): a box asked for the channel's stream and
-- the provider answered with a definite "not here" before any picture: HTTP
-- 404 / 410 for the stream address itself, or a 5xx again and again (the
-- native player's give-up, the app's isOffAirAnswer). The status goes in
-- http_status (404, 410, 500, 502, 503 or 504 only); never the address. The
-- box sends one only when it is itself healthy: a channel on that service
-- played 10 s or more on it in the last two hours, and this is not its 3rd
-- different channel failing to start in 10 minutes (else a plain 'fail').
--
-- Who counts (line_verified, set by the channel-status function):
--   * a box that signed a VERIFIED line in on that host (player_signins):
--     line_verified, its word counts on its own (below);
--   * a box known only by its analytics (the other half of knownBox,
--     20260930061000): trusted, but its offair counts like a 'fail' (two
--     boxes in 30 minutes mark the channel "Reported down", as ever);
--   * any other box, or one past the burst limit: untrusted, kept for the
--     Hub, never listed.
--
-- The rule (channel_offair_list, below), per channel, from trusted offair
-- signals newer than the channel's newest trusted 'ok' (a box played it fine
-- for 12 s) or 'clear' (a viewer chose "It's working now"):
--   * 404 / 410 from a line-verified box: ONE marks it "Off the air" for
--     every box on that host at once.
--   * 5xx: never one box alone. Two line-verified boxes (different devices
--     AND different IP addresses) within 30 minutes mark it. A 5xx on its
--     own counts like a 'fail'.
--   * Provider outage breaker: when 10 or more different channels on one
--     host get an offair within 10 minutes, that window's 5xx signals are not
--     listed at all (the provider is down, not the channels). 404 / 410 still
--     follow the first rule.
--   * The admin ends it from the Hub with "working" (admin_set status ok:
--     the channel's offair signals are deleted); an admin override covers it
--     while the override lasts.
--   * THE ONE DEVIATION from "until it streams again": the mark slides from
--     the NEWEST signal of it, 24 hours for 404 / 410 and 3 hours for 5xx.
--     A channel still dead is marked again the next time a box tries it
--     (404 / 410 at once, 5xx when two boxes agree); one that came back
--     clears on the first 12 s play. The rows themselves are kept 8 days,
--     for the Hub's history only. To change the windows: the intervals in
--     channel_offair_rows / channel_offair_list here.
-- Limits (channel_offair_signal, atomic per IP and device): one device marks
-- at most 20 different channels an hour; one IP 10 an hour and 30 a day; a
-- device or IP with 3 different channels marked in 15 minutes has the
-- further ones stored untrusted. The function's usual hourly limits apply
-- on top.
--
-- What boxes get: channel_down_list includes the channels off the air
-- (source 'offair'), so every app version shows them as down; the function
-- hands newer apps the `offair` keys so they say "Off the air". The Hub's
-- admin_list shows each one with its status code and since when.
--
-- Retention: offair, ok and clear rows (they never carry a line's username)
-- are kept 8 days, every other signal still 2 days (the reports that carry
-- a username, 20261007060000, still go after two days).
--
-- Safe to run twice. Nothing is renamed or dropped: channel_signals gains a
-- kind value and two columns; channel_down_list keeps its shape and, with no
-- offair signals, answers exactly as before.
-- Apply BEFORE deploying the new channel-status function: it calls
-- channel_offair_signal and writes kind 'offair', which this adds.

set lock_timeout = '3s';

-- 1. The kind, the status and who sent it.
alter table public.channel_signals drop constraint if exists channel_signals_kind_check;
alter table public.channel_signals add constraint channel_signals_kind_check
  check (kind in ('down', 'fail', 'ok', 'clear', 'buffering', 'offair'));

alter table public.channel_signals add column if not exists http_status smallint;
alter table public.channel_signals drop constraint if exists channel_signals_http_status_check;
alter table public.channel_signals add constraint channel_signals_http_status_check
  check (http_status is null or http_status in (404, 410, 500, 502, 503, 504));
alter table public.channel_signals add column if not exists line_verified boolean not null default false;

-- The offair signals by host and time (the lists, the outage breaker), and
-- each channel's newest ok / clear (one index lookup per channel).
create index if not exists channel_signals_offair_host_idx on public.channel_signals (host, created_at desc)
  where kind = 'offair';
create index if not exists channel_signals_good_idx on public.channel_signals (host, stream_id, created_at desc)
  where kind in ('ok', 'clear');
-- The per-device and per-IP offair counts.
create index if not exists channel_signals_offair_device_idx on public.channel_signals (device_hash, created_at desc)
  where kind = 'offair';
create index if not exists channel_signals_offair_ip_idx on public.channel_signals (ip_hash, created_at desc)
  where kind = 'offair' and ip_hash is not null;

-- 2. Store one offair signal, the limits counted and the row written under
-- one lock per IP and per device, so a burst of parallel requests cannot all
-- slip under them. Returns 'stored', 'stored_untrusted' (past the burst
-- limit) or 'rate_limited' / 'bad_request' (nothing stored).
create or replace function public.channel_offair_signal(
  p_host text, p_stream_id integer, p_name text, p_http_status smallint,
  p_device_hash text, p_ip_hash text, p_trusted boolean, p_line_verified boolean
)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  dev_hour integer; dev_burst integer;
  ip_hour integer := 0; ip_day integer := 0; ip_burst integer := 0;
  keep_trusted boolean := coalesce(p_trusted, false);
begin
  if p_http_status is null or p_http_status not in (404, 410, 500, 502, 503, 504)
     or p_host is null or p_stream_id is null or p_stream_id <= 0 or p_device_hash is null then
    return 'bad_request';
  end if;
  -- Always the IP first, then the device: never two requests waiting on each other.
  if p_ip_hash is not null then perform pg_advisory_xact_lock(hashtext('smc-offair-ip:' || p_ip_hash)); end if;
  perform pg_advisory_xact_lock(hashtext('smc-offair-device:' || p_device_hash));

  -- Different channels marked, not counting this one (a repeat is not another).
  select count(distinct (s.host, s.stream_id)),
         count(distinct (s.host, s.stream_id)) filter (where s.created_at > now() - interval '15 minutes')
    into dev_hour, dev_burst
    from public.channel_signals s
   where s.kind = 'offair' and s.device_hash = p_device_hash and s.created_at > now() - interval '1 hour'
     and not (s.host = p_host and s.stream_id = p_stream_id);
  if p_ip_hash is not null then
    select count(distinct (s.host, s.stream_id)) filter (where s.created_at > now() - interval '1 hour'),
           count(distinct (s.host, s.stream_id)),
           count(distinct (s.host, s.stream_id)) filter (where s.created_at > now() - interval '15 minutes')
      into ip_hour, ip_day, ip_burst
      from public.channel_signals s
     where s.kind = 'offair' and s.ip_hash = p_ip_hash and s.created_at > now() - interval '24 hours'
       and not (s.host = p_host and s.stream_id = p_stream_id);
  end if;
  if dev_hour >= 20 or ip_hour >= 10 or ip_day >= 30 then return 'rate_limited'; end if;
  -- A box (or a home) finding channel after channel off the air is more
  -- likely broken itself: its 4th and further in 15 minutes count for nothing.
  if dev_burst >= 3 or ip_burst >= 3 then keep_trusted := false; end if;

  insert into public.channel_signals (host, stream_id, channel_name, kind, device_hash, ip_hash, trusted, http_status, line_verified)
  values (p_host, p_stream_id, left(p_name, 200), 'offair', p_device_hash, p_ip_hash, keep_trusted, p_http_status,
          keep_trusted and coalesce(p_line_verified, false));
  return case when keep_trusted then 'stored' else 'stored_untrusted' end;
end;
$$;
revoke all on function public.channel_offair_signal(text, integer, text, smallint, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.channel_offair_signal(text, integer, text, smallint, text, text, boolean, boolean) to service_role;

-- 3. The trusted offair signals of the last 24 hours (the longest a mark
-- lasts) on these hosts (null: every host with one, for the Hub), each with:
--   strong  404 / 410 from a line-verified box (marks on its own);
--   outage  a 5xx in a 10-minute window in which 10 or more different
--           channels on its host got an offair (not listed at all).
create or replace function public.channel_offair_rows(p_hosts text[])
returns table (
  id bigint, host text, stream_id integer, channel_name text, http_status smallint,
  device_hash text, ip_hash text, line_verified boolean, created_at timestamptz,
  strong boolean, outage boolean
)
language sql stable security definer set search_path = public as $$
  with off as (
    select s.id, s.host, s.stream_id, s.channel_name, s.http_status, s.device_hash, s.ip_hash, s.line_verified, s.created_at
    from public.channel_signals s
    where s.kind = 'offair' and s.trusted and s.created_at > now() - interval '24 hours'
      and s.host = any(coalesce(p_hosts, array(
            select distinct x.host from public.channel_signals x
            where x.kind = 'offair' and x.trusted and x.created_at > now() - interval '24 hours')))
  )
  select o.id, o.host, o.stream_id, o.channel_name, o.http_status, o.device_hash, o.ip_hash, o.line_verified, o.created_at,
         (o.line_verified and o.http_status in (404, 410)) as strong,
         -- The 10 minutes up to it, or from it (index lookups on
         -- channel_signals_offair_host_idx, a handful of rows each).
         (o.http_status >= 500 and (
            (select count(distinct b.stream_id) from public.channel_signals b
              where b.kind = 'offair' and b.trusted and b.host = o.host
                and b.created_at between o.created_at - interval '10 minutes' and o.created_at) >= 10
            or (select count(distinct b.stream_id) from public.channel_signals b
              where b.kind = 'offair' and b.trusted and b.host = o.host
                and b.created_at between o.created_at and o.created_at + interval '10 minutes') >= 10
         )) as outage
  from off o;
$$;
revoke all on function public.channel_offair_rows(text[]) from public, anon, authenticated;
grant execute on function public.channel_offair_rows(text[]) to service_role;

-- 4. The channels off the air now on these hosts (null: every host, for the
-- Hub). From the line-verified signals newer than the channel's newest
-- trusted ok / clear (outage 5xx left out):
--   * a signal qualifies when it is strong, or a second line-verified box
--     (another device AND another IP address) sent one within 30 minutes of
--     it;
--   * signals follow one another into one mark while each comes before the
--     mark so far runs out (24 h after a 404 / 410, 3 h after a 5xx): the
--     mark slides from the newest;
--   * the channel is off the air when its latest run holds a qualifying
--     signal and has not run out, and no live admin override is on it.
-- `since` is the run's first qualifying signal, `last_at` its newest; the
-- name and status are the newest signal's. At most 500, the newest first.
create or replace function public.channel_offair_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, http_status smallint, since timestamptz, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with r as (
    select * from public.channel_offair_rows(p_hosts) o where o.line_verified and not o.outage
  ),
  goods as (
    select c.host, c.stream_id,
           (select g.created_at from public.channel_signals g
             where g.host = c.host and g.stream_id = c.stream_id and g.kind in ('ok', 'clear') and g.trusted
             order by g.created_at desc limit 1) as last_good
    from (select distinct r.host, r.stream_id from r) c
  ),
  ev as (
    select r.*, r.created_at + case when r.http_status in (404, 410) then interval '24 hours' else interval '3 hours' end as until_at
    from r join goods g on g.host = r.host and g.stream_id = r.stream_id
    where g.last_good is null or r.created_at > g.last_good
  ),
  scored as (
    select e.*,
           e.strong or exists (
             select 1 from ev b
             where b.host = e.host and b.stream_id = e.stream_id
               and b.device_hash <> e.device_hash and b.ip_hash <> e.ip_hash
               and b.created_at between e.created_at - interval '30 minutes' and e.created_at + interval '30 minutes'
           ) as qualifies
    from ev e
  ),
  runs as (
    select s.*,
           max(s.until_at) over (partition by s.host, s.stream_id order by s.created_at, s.id
                                 rows between unbounded preceding and 1 preceding) as prev_until
    from scored s
  ),
  numbered as (
    select r.*,
           sum(case when r.prev_until is null or r.created_at > r.prev_until then 1 else 0 end)
             over (partition by r.host, r.stream_id order by r.created_at, r.id) as run
    from runs r
  ),
  marks as (
    select n.host, n.stream_id, n.run,
           bool_or(n.qualifies) as qualifies,
           max(n.until_at) as until_at,
           min(n.created_at) filter (where n.qualifies) as since,
           max(n.created_at) as last_at,
           (array_agg(n.http_status order by n.created_at desc))[1] as http_status,
           (array_agg(n.channel_name order by n.created_at desc) filter (where n.channel_name is not null))[1] as channel_name
    from numbered n
    group by n.host, n.stream_id, n.run
  ),
  latest as (
    select distinct on (m.host, m.stream_id) m.*
    from marks m
    order by m.host, m.stream_id, m.run desc
  )
  select l.host, l.stream_id, l.channel_name, l.http_status, l.since, l.last_at
  from latest l
  where l.qualifies and l.until_at > now()
    and not exists (
      select 1 from public.channel_overrides v
      where v.host = l.host and v.stream_id = l.stream_id and (v.expires_at is null or v.expires_at > now())
    )
  order by l.last_at desc
  limit 500;
$$;
revoke all on function public.channel_offair_list(text[]) from public, anon, authenticated;
grant execute on function public.channel_offair_list(text[]) to service_role;

-- 5. channel_down_list: as in 20260930061000, plus
--   * the channels off the air (source 'offair'; one row per channel: off
--     the air wins over a viewer's report or the boxes' failures);
--   * an offair that marks nothing on its own (a 5xx, or one from a box
--     known only by its analytics) counts like a 'fail' (two boxes in 30
--     minutes), except a 5xx in an outage window.
-- Same shape, same cap; with no offair signals, exactly as before.
create or replace function public.channel_down_list(p_hosts text[])
returns table (host text, stream_id integer, channel_name text, since timestamptz, source text)
language sql stable security definer set search_path = public as $$
  with chans as (
    select s.host, s.stream_id,
           max(s.channel_name) as channel_name,
           max(s.created_at) filter (where s.kind = 'down') as last_report,
           min(s.created_at) filter (where s.kind = 'down') as first_report,
           max(s.created_at) filter (where s.kind in ('ok', 'clear')) as last_good
    from public.channel_signals s
    where s.host = any(p_hosts) and s.created_at > now() - interval '3 hours' and s.trusted
    group by s.host, s.stream_id
  ),
  fails as (
    select s.host, s.stream_id, s.device_hash, s.created_at
    from public.channel_signals s
    where s.host = any(p_hosts) and s.kind = 'fail' and s.trusted and s.created_at > now() - interval '30 minutes'
    union all
    select o.host, o.stream_id, o.device_hash, o.created_at
    from public.channel_offair_rows(p_hosts) o
    where not o.strong and not o.outage and o.created_at > now() - interval '30 minutes'
  ),
  fail_counts as (
    select f.host, f.stream_id,
           count(distinct f.device_hash) as fails,
           max(f.created_at) as last_fail,
           min(f.created_at) as first_fail
    from fails f
    group by f.host, f.stream_id
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
           case when c.last_report is not null and (c.last_good is null or c.last_report > c.last_good) then c.first_report else f.first_fail end as since,
           'crowd'::text as source
    from chans c
    left join fail_counts f on f.host = c.host and f.stream_id = c.stream_id
    where (
        (c.last_report is not null and (c.last_good is null or c.last_report > c.last_good))
        or (coalesce(f.fails, 0) >= 2 and (c.last_good is null or f.last_fail > c.last_good))
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

reset lock_timeout;
