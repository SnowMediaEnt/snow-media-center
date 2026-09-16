create table if not exists public.game_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_profiles_name_format check (game_name ~ '^[A-Za-z0-9 _-]{3,18}$')
);
create unique index if not exists game_profiles_name_unique on public.game_profiles (lower(game_name));
alter table public.game_profiles enable row level security;
grant select, insert, update on public.game_profiles to authenticated;
grant all on public.game_profiles to service_role;
drop policy if exists game_profiles_select_own on public.game_profiles;
create policy game_profiles_select_own on public.game_profiles for select using (auth.uid() = user_id);
drop policy if exists game_profiles_write_own on public.game_profiles;
create policy game_profiles_write_own on public.game_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.game_leaderboard (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_name text not null,
  game text not null check (game in ('plinko','dice','trivia')),
  mode text not null default 'classic',
  best_score int not null default 0 check (best_score >= 0),
  wins int not null default 0 check (wins >= 0),
  plays int not null default 0 check (plays >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game, mode)
);
create index if not exists game_leaderboard_rank on public.game_leaderboard (game, best_score desc, updated_at asc);
alter table public.game_leaderboard enable row level security;
grant select on public.game_leaderboard to anon, authenticated;
grant all on public.game_leaderboard to service_role;
drop policy if exists game_leaderboard_public_read on public.game_leaderboard;
create policy game_leaderboard_public_read on public.game_leaderboard for select using (true);

create or replace function public.record_game_score(
  p_user uuid, p_game text, p_mode text, p_score int, p_win boolean default false
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_name text;
begin
  select game_name into v_name from game_profiles where user_id = p_user;
  if v_name is null then v_name := 'SnowPlayer-' || upper(substr(replace(p_user::text, '-', ''), 1, 5)); end if;
  insert into game_leaderboard (user_id, game_name, game, mode, best_score, wins, plays, updated_at)
  values (p_user, v_name, p_game, left(coalesce(p_mode, 'classic'), 40), greatest(0, p_score), case when p_win then 1 else 0 end, 1, now())
  on conflict (user_id, game, mode) do update set
    game_name = excluded.game_name,
    best_score = greatest(game_leaderboard.best_score, excluded.best_score),
    wins = game_leaderboard.wins + excluded.wins,
    plays = game_leaderboard.plays + 1,
    updated_at = now();
end;
$$;
revoke all on function public.record_game_score(uuid,text,text,int,boolean) from public, anon, authenticated;
grant execute on function public.record_game_score(uuid,text,text,int,boolean) to service_role;