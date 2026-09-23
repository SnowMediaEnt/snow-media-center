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
