create table if not exists public.viewer_profiles (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  id         text        not null check (id ~ '^[a-z0-9]{1,16}$'),
  name       text        not null check (char_length(name) between 1 and 24),
  avatar     text        not null default 'blue' check (char_length(avatar) <= 24),
  kids_level text        check (kids_level in ('little', 'kids', 'teen')),
  pin_hash   text        check (pin_hash is null or pin_hash ~ '^[0-9a-f]{64}$'),
  position   integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

grant select, insert, update, delete on public.viewer_profiles to authenticated;
grant all on public.viewer_profiles to service_role;

alter table public.viewer_profiles enable row level security;

drop policy if exists "Own profiles: read" on public.viewer_profiles;
create policy "Own profiles: read" on public.viewer_profiles
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own profiles: add" on public.viewer_profiles;
create policy "Own profiles: add" on public.viewer_profiles
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Own profiles: change" on public.viewer_profiles;
create policy "Own profiles: change" on public.viewer_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Own profiles: remove" on public.viewer_profiles;
create policy "Own profiles: remove" on public.viewer_profiles
  for delete to authenticated using (auth.uid() = user_id and id <> 'main');

create or replace function public.viewer_profiles_limit()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.viewer_profiles where user_id = new.user_id and id = new.id)
     and (select count(*) from public.viewer_profiles where user_id = new.user_id) >= 8 then
    raise exception 'profile limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists viewer_profiles_limit on public.viewer_profiles;
create trigger viewer_profiles_limit before insert on public.viewer_profiles
  for each row execute function public.viewer_profiles_limit();

create table if not exists public.profile_pin_resets (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  profile_id text        not null,
  code_hash  text        not null,
  attempts   integer     not null default 0,
  ticket_id  uuid,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
grant all on public.profile_pin_resets to service_role;
create index if not exists profile_pin_resets_user_idx on public.profile_pin_resets (user_id, created_at desc);
alter table public.profile_pin_resets enable row level security;