-- A server-authoritative lounge leaderboard. Only opted-in game names appear;
-- balances and user IDs are never returned to the TV client.
create index if not exists chip_ledger_lounge_period_idx
  on public.chip_ledger (created_at, user_id) include (reason, change);

create or replace function public.get_lounge_coin_leaders()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with mapped as (
    select l.user_id, l.change, l.created_at,
      case
        when l.reason = 'daily_wheel' then 'daily-spin'
        when l.reason in ('slots_bet', 'slots_win') then 'slots'
        when l.reason in ('blackjack_bet', 'blackjack_settle') then 'blackjack'
        when l.reason in ('video_poker_bet', 'video_poker_win', 'video_poker_loss') then 'video-poker'
        when l.reason in ('roulette_bet', 'roulette_win') then 'roulette'
        when l.reason in ('casino_holdem_ante', 'casino_holdem_call', 'casino_holdem_settle') then 'casino-holdem'
        when l.reason in ('plinko_arcade', 'plinko_bet', 'plinko_payout') then 'plinko'
        when l.reason = 'trivia_arcade' then 'tv-trivia'
        when l.reason = 'dice_arcade' then 'dice-lounge'
      end as game
    from public.chip_ledger l
    where l.reason in (
      'daily_wheel', 'slots_bet', 'slots_win', 'blackjack_bet', 'blackjack_settle',
      'video_poker_bet', 'video_poker_win', 'video_poker_loss', 'roulette_bet',
      'roulette_win', 'casino_holdem_ante', 'casino_holdem_call', 'casino_holdem_settle',
      'plinko_arcade', 'plinko_bet', 'plinko_payout', 'trivia_arcade', 'dice_arcade'
    )
  ), named as (
    select m.user_id, p.game_name, m.game, m.change, m.created_at
    from mapped m join public.game_profiles p on p.user_id = m.user_id
  ), expanded as (
    select n.user_id, n.game_name, n.game, n.change, n.created_at from named n
    union all
    select n.user_id, n.game_name, 'overall'::text, n.change, n.created_at from named n
  ), grouped as (
    select period, game, user_id, game_name, sum(change)::bigint as net_coins
    from (
      select 'all-time'::text as period, * from expanded
      union all
      select 'today'::text as period, * from expanded
      where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    ) periods
    group by period, game, user_id, game_name
  ), ranked as (
    select period, game, game_name, net_coins,
      row_number() over (partition by period, game order by net_coins desc, game_name) as rank
    from grouped
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', period, 'game', game, 'game_name', game_name,
    'net_coins', net_coins, 'rank', rank
  ) order by period, game, rank) filter (where rank <= 5), '[]'::jsonb)
  from ranked;
$$;
revoke all on function public.get_lounge_coin_leaders() from public, anon, authenticated;
grant execute on function public.get_lounge_coin_leaders() to service_role;

-- New nine-argument overload retains the old start RPC for older APKs. It
-- records the displayed layout in the same transaction as the reserved bet.
create or replace function public.start_plinko_physics_round(
  p_user uuid, p_bet integer, p_risk text, p_board text, p_lane integer,
  p_seed text, p_seed_hash text, p_client_commit text, p_layout integer
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_start jsonb;
begin
  if p_layout is null or p_layout not between 0 and 10 then
    raise exception 'invalid_plinko_layout';
  end if;
  v_start := public.start_plinko_physics_round(
    p_user, p_bet, p_risk, p_board, p_lane, p_seed, p_seed_hash, p_client_commit
  );
  if (v_start->>'resumed')::boolean then
    return v_start || jsonb_build_object('layout', coalesce((
      select (result->>'layout')::integer from public.game_rounds
      where id = (v_start->>'roundId')::bigint and user_id = p_user
    ), 0));
  end if;
  update public.game_rounds
    set result = result || jsonb_build_object('layout', p_layout)
    where id = (v_start->>'roundId')::bigint and user_id = p_user and game = 'plinko';
  return v_start || jsonb_build_object('layout', p_layout);
end;
$$;
revoke all on function public.start_plinko_physics_round(uuid,integer,text,text,integer,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.start_plinko_physics_round(uuid,integer,text,text,integer,text,text,text,integer) to service_role;
