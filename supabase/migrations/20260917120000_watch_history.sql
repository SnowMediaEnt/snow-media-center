-- Per-account watch history: what a viewer played in Live TV and Plex, so the
-- content bar can follow them across devices. One row per item per account;
-- the app upserts on every play and bumps the count.
create table if not exists public.watch_history (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('channel', 'plex')),
  item_key   text not null,
  title      text not null,
  subtitle   text,
  poster     text,
  payload    jsonb not null default '{}'::jsonb,
  watched_at timestamptz not null default now(),
  count      int not null default 1,
  primary key (user_id, kind, item_key)
);
create index if not exists watch_history_user_recent_idx on public.watch_history (user_id, watched_at desc);

alter table public.watch_history enable row level security;
drop policy if exists watch_history_select_own on public.watch_history;
create policy watch_history_select_own on public.watch_history
  for select using (auth.uid() = user_id);
drop policy if exists watch_history_write_own on public.watch_history;
create policy watch_history_write_own on public.watch_history
  for insert with check (auth.uid() = user_id);
drop policy if exists watch_history_update_own on public.watch_history;
create policy watch_history_update_own on public.watch_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists watch_history_delete_own on public.watch_history;
create policy watch_history_delete_own on public.watch_history
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.watch_history to authenticated;
grant all on public.watch_history to service_role;
