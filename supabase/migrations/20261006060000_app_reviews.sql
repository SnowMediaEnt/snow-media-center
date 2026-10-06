-- "Rate Snow Media Center": in-app reviews from the TV app.
--
-- A signed-in box sends stars (required), an optional comment and an optional
-- voice note. The voice note lives in the private `review-audio` bucket under
-- '<user_id>/<review_id>.<ext>'; review-transcribe (edge function, service
-- role) turns it into text and fills `transcript` / `transcript_status`.
-- The Snow Media Hub reads everything here as an admin.
--
-- Safe to run twice.
--
-- NOT in this file: the `review-audio` bucket and its storage.objects
-- policies. This project's migrations can't create buckets (the owner ran the
-- support-attachments bucket SQL by hand), so they are in
-- supabase/sql/manual/20261006060100_review_audio_bucket.sql — run that once
-- in the SQL editor.

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.app_reviews (
  id                uuid primary key default gen_random_uuid(),
  -- auth.uid() of the sender. If the account is deleted the review stays and
  -- the link to the person goes.
  user_id           uuid references auth.users(id) on delete set null,
  rating            smallint not null
                      constraint app_reviews_rating_range check (rating between 1 and 5),
  comment           text
                      constraint app_reviews_comment_len check (comment is null or char_length(comment) <= 2000),
  -- Object path in the `review-audio` bucket: '<user_id>/<review_id>.<ext>'.
  audio_path        text
                      constraint app_reviews_audio_path_len check (audio_path is null or char_length(audio_path) <= 200),
  audio_ms          integer
                      constraint app_reviews_audio_ms_range check (audio_ms is null or (audio_ms >= 0 and audio_ms <= 120000)),
  transcript        text
                      constraint app_reviews_transcript_len check (transcript is null or char_length(transcript) <= 8000),
  transcript_status text not null default 'none'
                      constraint app_reviews_transcript_status_check
                      check (transcript_status in ('none', 'pending', 'done', 'failed')),
  app_version       text constraint app_reviews_app_version_len check (app_version is null or char_length(app_version) <= 32),
  build             integer,
  device_model      text constraint app_reviews_device_model_len check (device_model is null or char_length(device_model) <= 64),
  form_factor       text constraint app_reviews_form_factor_len check (form_factor is null or char_length(form_factor) <= 16),
  language          text constraint app_reviews_language_len check (language is null or char_length(language) <= 8),
  hours_used        numeric(8, 1),
  created_at        timestamptz not null default now()
);

-- The Hub lists newest first, filtered by stars; review-transcribe counts a
-- caller's transcriptions over the last day.
create index if not exists idx_app_reviews_created on public.app_reviews (created_at desc);
create index if not exists idx_app_reviews_rating_created on public.app_reviews (rating, created_at desc);
create index if not exists idx_app_reviews_user_created on public.app_reviews (user_id, created_at desc);

-- This project grants new tables to anon and authenticated by name. Take it
-- all back, then give authenticated only what the policies below allow.
revoke all on public.app_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.app_reviews to authenticated;
grant all on public.app_reviews to service_role;

alter table public.app_reviews enable row level security;

-- ── policies ───────────────────────────────────────────────────────────────
-- A signed-in viewer sends their own review. The transcript is the server's
-- to write, and a voice note must sit in the sender's own folder.
drop policy if exists "Users can insert their own app review" on public.app_reviews;
create policy "Users can insert their own app review"
  on public.app_reviews for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and transcript is null
    and transcript_status = 'none'
    and (audio_path is null or split_part(audio_path, '/', 1) = auth.uid()::text)
  );

drop policy if exists "Users can view their own app reviews" on public.app_reviews;
create policy "Users can view their own app reviews"
  on public.app_reviews for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins can view all app reviews" on public.app_reviews;
create policy "Admins can view all app reviews"
  on public.app_reviews for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can update app reviews" on public.app_reviews;
create policy "Admins can update app reviews"
  on public.app_reviews for update
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can delete app reviews" on public.app_reviews;
create policy "Admins can delete app reviews"
  on public.app_reviews for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- No anon policy: a signed-out caller can neither read nor write.
