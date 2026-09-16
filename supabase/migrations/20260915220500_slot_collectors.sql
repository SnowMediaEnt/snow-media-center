-- Snowfall Trio: honest, persistent progress for each slot bet level.
-- The matching game server is deployed only after this migration succeeds.

create table if not exists public.slot_collectors (
  user_id        uuid not null references auth.users(id) on delete cascade,
  bet            int not null check (bet > 0),
  red_progress   smallint not null default 0 check (red_progress >= 0 and red_progress < 15),
  blue_progress  smallint not null default 0 check (blue_progress >= 0 and blue_progress < 24),
  yellow_progress smallint not null default 0 check (yellow_progress >= 0 and yellow_progress < 34),
  updated_at     timestamptz not null default now(),
  primary key (user_id, bet)
);

alter table public.slot_collectors enable row level security;
drop policy if exists slot_collectors_select_own on public.slot_collectors;
create policy slot_collectors_select_own on public.slot_collectors
  for select using (auth.uid() = user_id);

-- Settle a slot spin as one transaction: verify/update the meter row, write
-- the auditable round, then move chips and append the ledger entry. A stale
-- expected meter raises collector_state_conflict and rolls everything back.
create or replace function public.settle_slots_spin(
  p_user uuid,
  p_round_bet int,
  p_progress_bet int,
  p_result jsonb,
  p_server_seed_hash text,
  p_server_seed text,
  p_client_seed text,
  p_nonce int,
  p_net int,
  p_reason text,
  p_update_collectors boolean,
  p_expected_red smallint,
  p_expected_blue smallint,
  p_expected_yellow smallint,
  p_next_red smallint,
  p_next_blue smallint,
  p_next_yellow smallint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_red smallint;
  v_blue smallint;
  v_yellow smallint;
  v_round_id bigint;
  v_balance int;
begin
  if p_progress_bet <= 0 then
    raise exception 'invalid_progress_bet' using errcode = 'check_violation';
  end if;

  insert into slot_collectors (user_id, bet)
  values (p_user, p_progress_bet)
  on conflict (user_id, bet) do nothing;

  select red_progress, blue_progress, yellow_progress
    into v_red, v_blue, v_yellow
    from slot_collectors
    where user_id = p_user and bet = p_progress_bet
    for update;

  if p_update_collectors then
    if v_red <> p_expected_red
      or v_blue <> p_expected_blue
      or v_yellow <> p_expected_yellow then
      raise exception 'collector_state_conflict' using errcode = 'serialization_failure';
    end if;

    update slot_collectors
      set red_progress = p_next_red,
          blue_progress = p_next_blue,
          yellow_progress = p_next_yellow,
          updated_at = now()
      where user_id = p_user and bet = p_progress_bet;
  end if;

  insert into game_rounds (
    user_id, game, bet, result, server_seed_hash, server_seed, client_seed, nonce
  ) values (
    p_user, 'slots', p_round_bet, p_result,
    p_server_seed_hash, p_server_seed, p_client_seed, p_nonce
  ) returning id into v_round_id;

  if p_net <> 0 then
    v_balance := apply_chip_change(p_user, p_net, p_reason, v_round_id);
  else
    select balance into v_balance from play_chips where user_id = p_user;
  end if;

  return jsonb_build_object('roundId', v_round_id, 'balance', v_balance);
end;
$$;

revoke all on function public.settle_slots_spin(
  uuid, int, int, jsonb, text, text, text, int, int, text, boolean,
  smallint, smallint, smallint, smallint, smallint, smallint
) from public, anon, authenticated;
grant execute on function public.settle_slots_spin(
  uuid, int, int, jsonb, text, text, text, int, int, text, boolean,
  smallint, smallint, smallint, smallint, smallint, smallint
) to service_role;
