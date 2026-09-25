-- Reserve a wager before a client-simulated puck is released, then credit its
-- server-verified landing exactly once. An abandoned drop costs its wager;
-- reconnecting resumes the same pending drop instead of rerolling a seed.
create unique index if not exists game_rounds_one_pending_plinko_per_player
  on public.game_rounds (user_id)
  where game = 'plinko' and result->>'status' = 'pending';

create or replace function public.start_plinko_physics_round(
  p_user uuid, p_bet integer, p_risk text, p_board text, p_lane integer,
  p_seed text, p_seed_hash text, p_client_commit text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_round game_rounds%rowtype;
  v_balance integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 91225));
  select * into v_round from game_rounds
    where user_id = p_user and game = 'plinko' and result->>'status' = 'pending'
    order by id desc limit 1;
  if found then
    if v_round.result->>'clientCommit' <> p_client_commit then
      raise exception 'plinko_pending_on_another_device';
    end if;
    select balance into v_balance from play_chips where user_id = p_user;
    return jsonb_build_object('roundId', v_round.id, 'bet', v_round.bet,
      'risk', v_round.result->>'risk', 'board', v_round.result->>'board',
      'dropLane', (v_round.result->>'dropLane')::integer,
      'serverSeed', v_round.server_seed,
      'balance', v_balance, 'resumed', true);
  end if;
  if p_bet not in (10, 25, 50, 100) or p_risk not in ('chill', 'classic', 'wild')
     or p_board not in ('tower', 'wide') or p_lane not between 0 and 10
     or (p_board = 'tower' and p_lane <> 5)
     or p_seed !~ '^[0-9a-f]{64}$' or p_seed_hash !~ '^[0-9a-f]{64}$'
     or p_client_commit !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_plinko_round';
  end if;
  insert into game_rounds (user_id, game, bet, result, server_seed, server_seed_hash, nonce)
    values (p_user, 'plinko', p_bet,
      jsonb_build_object('status', 'pending', 'risk', p_risk, 'board', p_board,
        'dropLane', p_lane, 'clientCommit', p_client_commit,
        'physicsVersion', 1), p_seed, p_seed_hash, 0)
    returning * into v_round;
  v_balance := apply_chip_change(p_user, -p_bet, 'plinko_bet', v_round.id);
  return jsonb_build_object('roundId', v_round.id, 'bet', p_bet, 'risk', p_risk,
    'board', p_board, 'dropLane', p_lane,
    'serverSeed', p_seed,
    'balance', v_balance, 'resumed', false);
end;
$$;

create or replace function public.finish_plinko_physics_round(
  p_user uuid, p_round bigint, p_slot integer, p_x numeric,
  p_steps integer, p_collisions integer, p_multiplier numeric, p_payout integer,
  p_client_seed text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_round game_rounds%rowtype;
  v_balance integer;
begin
  select * into v_round from game_rounds
    where id = p_round and user_id = p_user and game = 'plinko' for update;
  if not found then raise exception 'plinko_round_not_found'; end if;
  if v_round.result->>'status' = 'settled' then
    select balance into v_balance from play_chips where user_id = p_user;
    return jsonb_build_object('balance', v_balance, 'payout', (v_round.result->>'payout')::integer,
      'slot', (v_round.result->>'slot')::integer, 'alreadySettled', true);
  end if;
  if v_round.result->>'status' <> 'pending' or p_slot not between 0 and 10
     or p_x not between 3.5 and 96.5 or p_steps not between 1 and 720
     or p_collisions < 0 or p_multiplier < 0 or p_payout < 0 or p_payout > 10000 then
    raise exception 'invalid_plinko_settlement';
  end if;
  update game_rounds set client_seed = p_client_seed,
    result = v_round.result || jsonb_build_object(
    'status', 'settled', 'slot', p_slot, 'landingX', p_x,
    'steps', p_steps, 'collisions', p_collisions,
    'multiplier', p_multiplier, 'payout', p_payout,
    'net', p_payout - v_round.bet)
    where id = p_round;
  v_balance := apply_chip_change(p_user, p_payout, 'plinko_payout', p_round);
  return jsonb_build_object('balance', v_balance, 'payout', p_payout,
    'slot', p_slot, 'alreadySettled', false);
end;
$$;

revoke all on function public.start_plinko_physics_round(uuid,integer,text,text,integer,text,text,text) from public, anon, authenticated;
revoke all on function public.finish_plinko_physics_round(uuid,bigint,integer,numeric,integer,integer,numeric,integer,text) from public, anon, authenticated;
grant execute on function public.start_plinko_physics_round(uuid,integer,text,text,integer,text,text,text) to service_role;
grant execute on function public.finish_plinko_physics_round(uuid,bigint,integer,numeric,integer,integer,numeric,integer,text) to service_role;
