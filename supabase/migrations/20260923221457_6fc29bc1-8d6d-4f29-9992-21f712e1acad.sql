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