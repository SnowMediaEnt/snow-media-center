-- MANUAL: run once in the Supabase SQL editor (Lovable Cloud → Database →
-- SQL), AFTER migration 20261006060000_app_reviews.sql. Safe to run twice.
--
-- Why this is not a migration: in this workspace Lovable's migrations can't
-- create storage buckets, and policies on storage.objects (a table owned by
-- the storage admin role, not by the migration role) can fail the same way.
-- The support-attachments bucket was set up by hand for the same reason.
-- Everything here only touches storage.*; the table, its RLS and its policies
-- are in the migration.
--
-- Voice reviews: private bucket `review-audio`, 10 MB per file, the same
-- audio types as `support-attachments`. Paths are '<user_id>/<review_id>.<ext>':
-- the first segment is the owner, and the insert policy checks it.
-- The box only uploads; the Hub (admin) plays files through signed URLs and
-- may delete them; review-transcribe reads them with the service role, which
-- needs no policy.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-audio',
  'review-audio',
  false,
  10485760,  -- 10 MB: a 60 s voice note is ~500 KB
  array['audio/mp4','audio/aac','audio/mpeg','audio/webm','audio/ogg']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

-- The owner may upload into their own folder, and nowhere else.
drop policy if exists "review audio: owner insert" on storage.objects;
create policy "review audio: owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'review-audio'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Admins read (signed URLs in the Hub) and delete.
drop policy if exists "review audio: admin read" on storage.objects;
create policy "review audio: admin read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'review-audio' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "review audio: admin delete" on storage.objects;
create policy "review audio: admin delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'review-audio' and public.has_role(auth.uid(), 'admin'));

-- Deliberately no update policy, and no select or delete for the owner: a
-- sent voice review is final, like a sent support voice note. No anon access.
