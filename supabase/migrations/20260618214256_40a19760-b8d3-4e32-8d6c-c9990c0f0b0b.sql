-- SMC Game Room — Phase 0 schema (additive only).

create table if not exists public.play_chips (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    int  not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
GRANT SELECT, UPDATE ON public.play_chips TO authenticated;
GRANT ALL ON public.play_chips TO service_role;
alter table public.play_chips enable row level security;
drop policy if exists play_chips_select_own on public.play_chips;
create policy play_chips_select_own on public.play_chips
  for select using (auth.uid() = user_id);

create table if not exists public.chip_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  change        int  not null,
  reason        text not null,
  game_round_id bigint,
  created_at    timestamptz not null default now()
);
create index if not exists chip_ledger_user_idx on public.chip_ledger (user_id, created_at desc);
GRANT SELECT ON public.chip_ledger TO authenticated;
GRANT ALL ON public.chip_ledger TO service_role;
alter table public.chip_ledger enable row level security;
drop policy if exists chip_ledger_select_own on public.chip_ledger;
create policy chip_ledger_select_own on public.chip_ledger
  for select using (auth.uid() = user_id);

create table if not exists public.daily_claims (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  last_claim_at timestamptz
);
GRANT SELECT, UPDATE ON public.daily_claims TO authenticated;
GRANT ALL ON public.daily_claims TO service_role;
alter table public.daily_claims enable row level security;
drop policy if exists daily_claims_select_own on public.daily_claims;
create policy daily_claims_select_own on public.daily_claims
  for select using (auth.uid() = user_id);

create table if not exists public.game_rounds (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  game             text not null,
  bet              int  not null default 0,
  result           jsonb,
  server_seed_hash text,
  server_seed      text,
  client_seed      text,
  nonce            int,
  created_at       timestamptz not null default now()
);
create index if not exists game_rounds_user_idx on public.game_rounds (user_id, created_at desc);
GRANT SELECT ON public.game_rounds TO authenticated;
GRANT ALL ON public.game_rounds TO service_role;
alter table public.game_rounds enable row level security;
drop policy if exists game_rounds_select_own on public.game_rounds;
create policy game_rounds_select_own on public.game_rounds
  for select using (auth.uid() = user_id);

create table if not exists public.cosmetics (
  id                bigint generated always as identity primary key,
  type              text not null check (type in ('avatar', 'theme')),
  name              text not null,
  price_chips       int,
  price_money_cents int,
  asset_ref         text
);
GRANT SELECT ON public.cosmetics TO anon;
GRANT SELECT ON public.cosmetics TO authenticated;
GRANT ALL ON public.cosmetics TO service_role;
alter table public.cosmetics enable row level security;
drop policy if exists cosmetics_select_all on public.cosmetics;
create policy cosmetics_select_all on public.cosmetics
  for select using (true);

create table if not exists public.user_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cosmetic_id bigint not null references public.cosmetics(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  equipped    boolean not null default false,
  primary key (user_id, cosmetic_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_cosmetics TO authenticated;
GRANT ALL ON public.user_cosmetics TO service_role;
alter table public.user_cosmetics enable row level security;
drop policy if exists user_cosmetics_select_own on public.user_cosmetics;
create policy user_cosmetics_select_own on public.user_cosmetics
  for select using (auth.uid() = user_id);

create or replace function public.apply_chip_change(
  p_user   uuid,
  p_change int,
  p_reason text,
  p_round  bigint default null
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
begin
  insert into play_chips (user_id, balance, updated_at)
  values (p_user, 0, now())
  on conflict (user_id) do nothing;

  update play_chips
    set balance = balance + p_change, updated_at = now()
    where user_id = p_user
    returning balance into v_balance;

  if v_balance < 0 then
    raise exception 'insufficient_chips' using errcode = 'check_violation';
  end if;

  insert into chip_ledger (user_id, change, reason, game_round_id)
  values (p_user, p_change, p_reason, p_round);

  return v_balance;
end;
$$;

revoke all on function public.apply_chip_change(uuid, int, text, bigint) from public;
revoke all on function public.apply_chip_change(uuid, int, text, bigint) from anon, authenticated;