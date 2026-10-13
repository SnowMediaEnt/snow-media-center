-- The Parent PIN: one per account, apart from the profiles' own PINs
-- (viewer_profiles.pin_hash). It is the grown-ups' key to Profiles: once an
-- account has one, the app asks for it to add, edit or delete a profile and
-- to leave a Kids profile for a grown-up one, so a kid can't make an adult
-- profile and move over.
--
-- Like a profile's pin_hash it is a household lock, not a password: the app
-- hashes the 4 digits (sha256 with the account id and '__parent__') and
-- checks them on the box, so it works offline. No row = no Parent PIN;
-- turning it off deletes the row. A forgotten one is reset by the
-- profile-pin-reset edge function (profile_id '__parent__'), which writes
-- the new hash only once the emailed code is right.
--
-- Its own table rather than a column on viewer_profiles: it belongs to the
-- account, not to a profile row (the 'main' row may not be on the account
-- yet, and older app versions upsert whole profile rows), it has its own
-- "newest change wins" timestamp, and turning it off is a plain delete.

create table if not exists public.viewer_parent_pin (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  pin_hash   text        not null check (pin_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.viewer_parent_pin to authenticated;
grant all on public.viewer_parent_pin to service_role;

alter table public.viewer_parent_pin enable row level security;

drop policy if exists "Own parent PIN: read" on public.viewer_parent_pin;
create policy "Own parent PIN: read" on public.viewer_parent_pin
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Own parent PIN: add" on public.viewer_parent_pin;
create policy "Own parent PIN: add" on public.viewer_parent_pin
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Own parent PIN: change" on public.viewer_parent_pin;
create policy "Own parent PIN: change" on public.viewer_parent_pin
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Own parent PIN: remove" on public.viewer_parent_pin;
create policy "Own parent PIN: remove" on public.viewer_parent_pin
  for delete to authenticated using (auth.uid() = user_id);
