-- One atomic hit on the email_check_throttle and player_signin_throttle
-- counters, the same way public.throttle_hit does it for
-- player_login_throttle (20261016180000_throttle_hit.sql).
--
-- check-account-email and capture-player-signin read a key's count and wrote
-- count + 1 in a second call, so N requests arriving together all read the
-- same count and all passed. Each function here does the read and the write
-- in one statement: the insert takes the row lock, concurrent hits on the
-- same key queue behind it, and each one gets its own count back.
--
-- Same window rules as before: a window_start older than p_window_ms starts
-- again at 1 (now); otherwise the count goes up by one and the window keeps
-- its start. email_check_throttle's updated_at moves on every hit, as the
-- function's own updates did. The caller compares the returned count with
-- its own limit. Strict: a null argument returns null (the caller lets the
-- call through) rather than a window that never resets.
--
-- Service role only: both tables are RLS-on with no policies, and nothing
-- here is granted to anon or authenticated.

create or replace function public.email_check_throttle_hit(p_key text, p_window_ms bigint)
returns integer
language sql
volatile
strict
security definer
set search_path = ''
as $$
  insert into public.email_check_throttle as t (ip_hash, window_start, count, updated_at)
  values (p_key, now(), 1, now())
  on conflict (ip_hash) do update
    set count        = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then 1 else t.count + 1 end,
        window_start = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then now() else t.window_start end,
        updated_at   = now()
  returning count;
$$;

revoke all on function public.email_check_throttle_hit(text, bigint) from public, anon, authenticated;
grant execute on function public.email_check_throttle_hit(text, bigint) to service_role;

create or replace function public.player_signin_throttle_hit(p_key text, p_window_ms bigint)
returns integer
language sql
volatile
strict
security definer
set search_path = ''
as $$
  insert into public.player_signin_throttle as t (ip_hash, window_start, count)
  values (p_key, now(), 1)
  on conflict (ip_hash) do update
    set count        = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then 1 else t.count + 1 end,
        window_start = case when t.window_start < now() - p_window_ms * interval '1 millisecond' then now() else t.window_start end
  returning count;
$$;

revoke all on function public.player_signin_throttle_hit(text, bigint) from public, anon, authenticated;
grant execute on function public.player_signin_throttle_hit(text, bigint) to service_role;
