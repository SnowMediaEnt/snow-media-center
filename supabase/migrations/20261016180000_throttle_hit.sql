-- One atomic hit on a player_login_throttle counter.
--
-- The edge functions anyone can reach (report-channel, device-inbox,
-- player-login and the rest; see _shared/requestGuard.ts) used to read a
-- key's count and write count + 1 in a second call, so N requests arriving
-- together all read the same count and all passed. This does the read and
-- the write in one statement: the insert takes the row lock, concurrent hits
-- on the same key queue behind it, and each one gets its own count back.
--
-- A window older than p_window_ms starts again at 1 (now); otherwise the
-- count goes up by one and the window keeps its start. The caller compares
-- the returned count with its own limit. Strict: a null argument returns
-- null (the caller lets the call through) rather than a window that never
-- resets.
--
-- Service role only: the table is RLS-on with no policies, and nothing here
-- is granted to anon or authenticated.

create or replace function public.throttle_hit(p_key text, p_window_ms bigint)
returns integer
language sql
volatile
strict
security definer
set search_path = ''
as $$
  insert into public.player_login_throttle as t (ip_hash, window_start, count)
  values (p_key, now(), 1)
  on conflict (ip_hash) do update
    set count        = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then 1 else t.count + 1 end,
        window_start = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then now() else t.window_start end
  returning count;
$$;

revoke all on function public.throttle_hit(text, bigint) from public, anon, authenticated;
grant execute on function public.throttle_hit(text, bigint) to service_role;
