-- "Recommended by viewers" in Plex (owner, 2026-10-12: "press and hold on a
-- movie or show and recommend it to others ... a bar strictly of movies and
-- shows others have seen and recommend others check out").
--
-- A signed-in viewer holds OK on a Plex movie or show (or presses Recommend
-- on its page) and the title is saved here, once per account. Discover then
-- shows the titles recommended on the server the box plays from, most
-- recommenders first (plex_recommended below).
--
-- A ratingKey only means something on one Plex server, so every row carries
-- the server's machineIdentifier (server_id) and the list is only ever read
-- for one server. Title, year, thumb and certificate are kept for the Hub's
-- moderation and as the list's display text; the app reads each title from
-- its own server again before showing it, so a title that is gone is dropped
-- and the server's own name and certificate are the ones on screen.
--
-- Who can see what:
--   - a signed-in viewer adds and removes their own rows, and reads only
--     their own (to show "Recommended ✓" on titles they recommended);
--   - nobody reads anyone else's rows; the list comes from plex_recommended,
--     which returns titles and counts, never who recommended them;
--   - admins (has_role 'admin') read and delete every row, for moderation.
--
-- Abuse limit: 50 recommendations per account per day (trigger below).
--
-- Safe to run twice.

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.plex_recommendations (
  id             uuid primary key default gen_random_uuid(),
  -- auth.uid() of the viewer. Their recommendations go with the account.
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The Plex server's machineIdentifier (40 hex characters on a real server).
  server_id      text not null
                   constraint plex_recommendations_server_len check (char_length(server_id) between 1 and 100),
  rating_key     text not null
                   constraint plex_recommendations_rating_key_format check (rating_key ~ '^[0-9]{1,12}$'),
  type           text not null
                   constraint plex_recommendations_type_check check (type in ('movie', 'show')),
  title          text not null
                   constraint plex_recommendations_title_len check (char_length(title) between 1 and 300),
  year           smallint
                   constraint plex_recommendations_year_range check (year is null or year between 1870 and 2100),
  -- The poster's path on the server ('/library/metadata/123/thumb/1700000000').
  -- Never a full address and never anything with a query string: the app adds
  -- the server and its token itself, so a token can't end up in this table.
  thumb          text
                   constraint plex_recommendations_thumb_path check (
                     thumb is null or (
                       char_length(thumb) <= 300
                       and left(thumb, 1) = '/'
                       and position('?' in thumb) = 0
                       and position('://' in thumb) = 0
                       and thumb !~* 'token'
                     )
                   ),
  content_rating text
                   constraint plex_recommendations_content_rating_len check (content_rating is null or char_length(content_rating) <= 20),
  created_at     timestamptz not null default now(),
  constraint plex_recommendations_one_per_title unique (user_id, server_id, rating_key)
);

-- The list reads one server's last ninety days; the daily limit counts one
-- account's last day.
create index if not exists idx_plex_recommendations_server_created
  on public.plex_recommendations (server_id, created_at desc);
create index if not exists idx_plex_recommendations_user_created
  on public.plex_recommendations (user_id, created_at desc);

-- This project grants new tables to anon and authenticated by name. Take it
-- all back, then give authenticated only what the policies below allow (no
-- update: a recommendation is added or removed, never edited).
revoke all on public.plex_recommendations from public, anon, authenticated;
grant select, insert, delete on public.plex_recommendations to authenticated;
grant all on public.plex_recommendations to service_role;

alter table public.plex_recommendations enable row level security;

-- ── policies ───────────────────────────────────────────────────────────────
drop policy if exists "Users can recommend Plex titles as themselves" on public.plex_recommendations;
create policy "Users can recommend Plex titles as themselves"
  on public.plex_recommendations for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users can view their own Plex recommendations" on public.plex_recommendations;
create policy "Users can view their own Plex recommendations"
  on public.plex_recommendations for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can remove their own Plex recommendations" on public.plex_recommendations;
create policy "Users can remove their own Plex recommendations"
  on public.plex_recommendations for delete
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Admins can view all Plex recommendations" on public.plex_recommendations;
create policy "Admins can view all Plex recommendations"
  on public.plex_recommendations for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can delete Plex recommendations" on public.plex_recommendations;
create policy "Admins can delete Plex recommendations"
  on public.plex_recommendations for delete
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- No anon policy: a signed-out caller can neither read nor write the table.

-- ── daily limit, and the time is the server's ─────────────────────────────
-- created_at decides the ninety-day window and the list's order, so a client
-- can't set it. The limit counts the account's rows made in the last day: an
-- account can never have more than 50 titles in the list that it added in
-- the last 24 hours, and each title counts once per account however often it
-- is removed and added again.
create or replace function public.plex_recommendations_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  new.created_at := now();
  select count(*) into recent
    from public.plex_recommendations
    where user_id = new.user_id
      and created_at > now() - interval '1 day';
  if recent >= 50 then
    raise exception 'plex_recommend_daily_limit'
      using errcode = 'P0001', hint = 'At most 50 Plex recommendations per account per day.';
  end if;
  return new;
end;
$$;

revoke all on function public.plex_recommendations_before_insert() from public, anon, authenticated;

drop trigger if exists plex_recommendations_before_insert on public.plex_recommendations;
create trigger plex_recommendations_before_insert
  before insert on public.plex_recommendations
  for each row execute function public.plex_recommendations_before_insert();

-- ── the list: what Discover's "Recommended by viewers" shows ───────────────
-- One server's titles recommended in the last ninety days: per title its
-- display fields (from the newest recommendation of it), how many viewers
-- recommended it and when it was last recommended. Most recommenders first,
-- then the most recent. Never a user id.
--
-- Granted to anon as well as authenticated: a box that is not signed in to a
-- Snow Media account still sees the row (it only can't add to it). Nothing in
-- the answer says who recommended anything, and the titles are ones the
-- server shows any of its viewers anyway.
create or replace function public.plex_recommended(p_server text, p_limit int default 24)
returns table(
  rating_key text,
  type text,
  title text,
  year smallint,
  thumb text,
  content_rating text,
  recommenders bigint,
  last_recommended_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select r.rating_key, r.type, r.title, r.year, r.thumb, r.content_rating, r.created_at
    from public.plex_recommendations r
    where r.server_id = p_server
      and r.created_at > now() - interval '90 days'
  ),
  counted as (
    select rc.rating_key, count(*) as recommenders, max(rc.created_at) as last_at
    from recent rc
    group by rc.rating_key
  ),
  newest as (
    select distinct on (rn.rating_key) rn.rating_key, rn.type, rn.title, rn.year, rn.thumb, rn.content_rating
    from recent rn
    order by rn.rating_key, rn.created_at desc
  )
  select n.rating_key, n.type, n.title, n.year, n.thumb, n.content_rating, c.recommenders, c.last_at
  from newest n
  join counted c on c.rating_key = n.rating_key
  order by c.recommenders desc, c.last_at desc, n.rating_key
  limit greatest(1, least(coalesce(p_limit, 24), 50));
$$;

revoke all on function public.plex_recommended(text, int) from public;
grant execute on function public.plex_recommended(text, int) to anon, authenticated;
