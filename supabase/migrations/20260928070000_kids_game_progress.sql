-- Private, per-child progress. No public names, scores or leaderboard.
create table if not exists public.kids_game_progress (
  user_id uuid not null,
  profile_id text not null,
  game_id text not null check (game_id in (
    'snowball-splash', 'penguin-path', 'sled-dash',
    'winter-match', 'snow-world', 'beat-blizzard'
  )),
  plays integer not null default 0 check (plays between 0 and 100000000),
  best_score integer not null default 0 check (best_score between 0 and 100000000),
  stars integer not null default 0 check (stars between 0 and 100000000),
  level integer not null default 1 check (level between 1 and 10000),
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id, game_id),
  foreign key (user_id, profile_id)
    references public.viewer_profiles (user_id, id) on delete cascade
);

alter table public.kids_game_progress enable row level security;
grant select, insert, update, delete on public.kids_game_progress to authenticated;

drop policy if exists "Child progress: read own" on public.kids_game_progress;
create policy "Child progress: read own" on public.kids_game_progress
  for select to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid() and p.id = profile_id and p.kids_level is not null
    )
  );
drop policy if exists "Child progress: insert own" on public.kids_game_progress;
create policy "Child progress: insert own" on public.kids_game_progress
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid() and p.id = profile_id and p.kids_level is not null
    )
  );
drop policy if exists "Child progress: update own" on public.kids_game_progress;
create policy "Child progress: update own" on public.kids_game_progress
  for update to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid() and p.id = profile_id and p.kids_level is not null
    )
  ) with check (
    user_id = auth.uid() and exists (
      select 1 from public.viewer_profiles p
      where p.user_id = auth.uid() and p.id = profile_id and p.kids_level is not null
    )
  );
drop policy if exists "Child progress: delete own" on public.kids_game_progress;
create policy "Child progress: delete own" on public.kids_game_progress
  for delete to authenticated using (user_id = auth.uid());
