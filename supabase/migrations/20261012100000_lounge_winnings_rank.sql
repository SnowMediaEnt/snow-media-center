-- Public rankings celebrate credited winnings; personal net remains visible
-- in each game. Exclude signup/admin grants by selecting only game reasons.
create or replace function public.get_lounge_coin_leaders()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with mapped as (
    select l.user_id, l.change, l.created_at,
      case when l.reason in ('plinko_arcade', 'trivia_arcade', 'dice_arcade')
        then greatest(0, coalesce((r.result->>'payout')::integer, 0))
        else greatest(l.change, 0) end as win_credit,
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
    left join public.game_rounds r on r.id = l.game_round_id
      and l.reason in ('plinko_arcade', 'trivia_arcade', 'dice_arcade')
    where l.reason in (
      'daily_wheel', 'slots_bet', 'slots_win', 'blackjack_bet', 'blackjack_settle',
      'video_poker_bet', 'video_poker_win', 'video_poker_loss', 'roulette_bet',
      'roulette_win', 'casino_holdem_ante', 'casino_holdem_call', 'casino_holdem_settle',
      'plinko_arcade', 'plinko_bet', 'plinko_payout', 'trivia_arcade', 'dice_arcade'
    )
  ), named as (
    select m.user_id, p.game_name, m.game, m.change, m.win_credit, m.created_at
    from mapped m join public.game_profiles p on p.user_id = m.user_id
  ), expanded as (
    select n.user_id, n.game_name, n.game, n.change, n.win_credit, n.created_at from named n
    union all
    select n.user_id, n.game_name, 'overall'::text, n.change, n.win_credit, n.created_at from named n
  ), grouped as (
    select period, game, user_id, game_name,
      sum(win_credit)::bigint as won_coins,
      sum(change)::bigint as net_coins
    from (
      select 'all-time'::text as period, * from expanded
      union all
      select 'today'::text as period, * from expanded
      where created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    ) periods
    group by period, game, user_id, game_name
  ), ranked as (
    select period, game, game_name, won_coins, net_coins,
      row_number() over (partition by period, game order by won_coins desc, net_coins desc, game_name) as rank
    from grouped
    where won_coins > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period', period, 'game', game, 'game_name', game_name,
    'won_coins', won_coins, 'net_coins', net_coins, 'rank', rank
  ) order by period, game, rank) filter (where rank <= 5), '[]'::jsonb)
  from ranked;
$$;
revoke all on function public.get_lounge_coin_leaders() from public, anon, authenticated;
grant execute on function public.get_lounge_coin_leaders() to service_role;
