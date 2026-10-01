-- Snow Originals: the owner's own short videos, shown in Live TV.
--
-- Staff (the `admin` role, checked with public.has_role) upload from the Snow
-- Media Hub with their own signed-in session. There is no edge function:
-- these RLS and storage policies are the only gate. Safe to re-run.

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.snow_originals (
  -- The Hub sets the id itself so the file paths can start with it.
  id            uuid primary key default gen_random_uuid(),
  title         text not null
                  constraint snow_originals_title_len check (char_length(title) between 1 and 80),
  description   text
                  constraint snow_originals_description_len check (description is null or char_length(description) <= 500),
  -- Object paths inside the `snow-originals` bucket, e.g. '<id>/v-k8d2m1qz.mp4'.
  video_path    text not null,
  poster_path   text,   -- JPEG, long side <= 720 px
  backdrop_path text,   -- same frame, 32 px wide JPEG (the blurred side fill)
  -- DB ceiling only. The Hub enforces the owner's real limit (3 minutes).
  duration_sec  double precision not null
                  constraint snow_originals_duration_range check (duration_sec > 0 and duration_sec <= 900),
  -- Display size after rotation (what the browser's <video> reports).
  width         integer not null constraint snow_originals_width_pos check (width > 0),
  height        integer not null constraint snow_originals_height_pos check (height > 0),
  orientation   text generated always as (
                  case when height > width then 'portrait' else 'landscape' end
                ) stored,
  file_size     bigint not null constraint snow_originals_file_size_pos check (file_size > 0),
  video_codec   text,   -- e.g. 'avc1.640028'; for diagnosis only
  kid_friendly  boolean not null default false,
  published     boolean not null default false,
  -- Set by trigger the first time `published` turns true; drives the "New" badge.
  published_at  timestamptz,
  -- Lower first. The Hub gives a new upload min(sort) - 10 so it lands on top.
  sort          integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users(id) on delete set null
);

-- Viewer order is: sort asc, published_at desc nulls last, created_at desc.
create index if not exists idx_snow_originals_lookup
  on public.snow_originals (published, sort, published_at desc);

grant select on public.snow_originals to anon;
grant select, insert, update, delete on public.snow_originals to authenticated;
grant all on public.snow_originals to service_role;

alter table public.snow_originals enable row level security;

drop policy if exists "Anyone can view published snow originals" on public.snow_originals;
create policy "Anyone can view published snow originals"
  on public.snow_originals for select
  to anon, authenticated
  using (published = true);

drop policy if exists "Admins can view all snow originals" on public.snow_originals;
create policy "Admins can view all snow originals"
  on public.snow_originals for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can insert snow originals" on public.snow_originals;
create policy "Admins can insert snow originals"
  on public.snow_originals for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can update snow originals" on public.snow_originals;
create policy "Admins can update snow originals"
  on public.snow_originals for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can delete snow originals" on public.snow_originals;
create policy "Admins can delete snow originals"
  on public.snow_originals for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ── triggers ───────────────────────────────────────────────────────────────
drop trigger if exists update_snow_originals_updated_at on public.snow_originals;
create trigger update_snow_originals_updated_at
  before update on public.snow_originals
  for each row execute function public.update_updated_at_column();

-- Stamp published_at the first time a row is published. Never cleared, so
-- unpublishing and republishing does not make an old video "New" again.
create or replace function public.snow_originals_set_published_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.published and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists snow_originals_set_published_at on public.snow_originals;
create trigger snow_originals_set_published_at
  before insert or update on public.snow_originals
  for each row execute function public.snow_originals_set_published_at();

-- ── storage ────────────────────────────────────────────────────────────────
-- Deliberately NO anon/public SELECT policy on storage.objects: it is not
-- needed for public downloads, and it would let anyone list draft files.
-- The admin SELECT below is what list() and remove() need.
drop policy if exists "snow originals: admin select" on storage.objects;
create policy "snow originals: admin select"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'snow-originals' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "snow originals: admin insert" on storage.objects;
create policy "snow originals: admin insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'snow-originals' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "snow originals: admin update" on storage.objects;
create policy "snow originals: admin update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'snow-originals' and public.has_role(auth.uid(), 'admin'))
  with check (bucket_id = 'snow-originals' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "snow originals: admin delete" on storage.objects;
create policy "snow originals: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'snow-originals' and public.has_role(auth.uid(), 'admin'));
