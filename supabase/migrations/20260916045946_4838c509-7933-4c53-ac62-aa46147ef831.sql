create table if not exists public.trivia_questions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  topic text not null check (topic in ('devices', 'service', 'app', 'history')),
  prompt text not null check (char_length(prompt) between 12 and 300),
  answers text[] not null check (cardinality(answers) = 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  fact text not null check (char_length(fact) between 8 and 500),
  points smallint not null default 100 check (points between 25 and 500),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trivia_questions_published_order_idx
  on public.trivia_questions (is_published, sort_order, published_at desc);

alter table public.trivia_questions enable row level security;

revoke all on table public.trivia_questions from anon, authenticated;
grant select, insert, update, delete on table public.trivia_questions to authenticated;
grant all on table public.trivia_questions to service_role;

drop policy if exists "admins manage trivia questions" on public.trivia_questions;
create policy "admins manage trivia questions"
  on public.trivia_questions
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

create or replace function public.set_trivia_question_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  if new.is_published and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_trivia_question_updated_at() from public, anon, authenticated;
grant execute on function public.set_trivia_question_updated_at() to service_role;

drop trigger if exists set_trivia_question_updated_at on public.trivia_questions;
create trigger set_trivia_question_updated_at
before insert or update on public.trivia_questions
for each row execute function public.set_trivia_question_updated_at();

insert into public.trivia_questions
  (slug, topic, prompt, answers, correct_index, fact, points, is_published, sort_order)
values
  (
    'snow-remote-select', 'devices',
    'Which Fire TV remote button opens the item highlighted on screen?',
    array['Menu', 'Back', 'OK / center', 'Volume up'], 2,
    'The D-pad moves the highlight, and the OK or center button activates it.',
    100, true, 10
  ),
  (
    'snow-reduced-fx', 'devices',
    'What does Reduced FX do in the Snow Media game lounge?',
    array['Raises the volume', 'Uses lighter visual effects', 'Changes the language', 'Signs out'], 1,
    'Reduced FX keeps gameplay clear while using simpler animation on lower-powered TV devices.',
    100, true, 20
  ),
  (
    'snow-four-k-speed', 'devices',
    'For consistent 4K streaming, what connection speed does the in-app test recommend?',
    array['At least 5 Mbps', 'At least 10 Mbps', 'At least 25 Mbps', 'At least 100 Mbps'], 2,
    'Snow Media Center recommends at least 25 Mbps for consistent 4K streaming.',
    100, true, 30
  ),
  (
    'snow-player-sections', 'service',
    'Which set names the main kinds of content available in the Snow Media Player?',
    array['Radio, podcasts, books', 'Live TV, movies, series', 'Photos, mail, maps', 'Shopping, banking, weather'], 1,
    'The Player brings Live TV, movies, and series together in one TV-friendly experience.',
    100, true, 40
  ),
  (
    'snow-account-difference', 'service',
    'Is a Snow Media website account the same thing as a streaming login?',
    array['Yes, always', 'Only on weekends', 'No, they serve different purposes', 'Only on Fire TV'], 2,
    'The website account and streaming login are separate, so changing one does not replace the other.',
    100, true, 50
  ),
  (
    'snow-support-speed-test', 'app',
    'What built-in Snow Media tool can help diagnose a buffering connection?',
    array['A stopwatch', 'The Internet Speed Test', 'A calculator', 'The game leaderboard'], 1,
    'The built-in Internet Speed Test measures the connection on the same device used for streaming.',
    100, true, 60
  ),
  (
    'snow-snow-ai', 'app',
    'Where would you go in Snow Media Center to ask the Snow Media AI for help?',
    array['Support', 'Game payout settings', 'TV input menu', 'Device wallpaper'], 0,
    'Snow Media AI lives with the other help tools in the Support experience.',
    100, true, 70
  ),
  (
    'snow-version-102', 'history',
    'Which tool was added in Snow Media Center version 1.0.2?',
    array['Internet Speed Test', 'A photo printer', 'A weather station', 'A web browser'], 0,
    'Version 1.0.2 added the built-in Speed Test and interactive Buffering Guide.',
    100, true, 80
  ),
  (
    'snow-version-151', 'history',
    'Which playful currencies arrived with the upgraded Game Room in version 1.5.1?',
    array['Stars and hearts', 'Snow Gems and Snow Coins', 'Tickets and tokens', 'Gold and silver bars'], 1,
    'Version 1.5.1 introduced Snow Gems, bonus Snow Coins, and a TV-fitted Game Room.',
    100, true, 90
  ),
  (
    'snow-version-160', 'history',
    'What did Multi-Screen add in version 1.6?',
    array['Two or four channels at once', 'A second billing account', 'Four trivia answers', 'A new remote battery'], 0,
    'Multi-Screen added layouts for watching two or four channels at the same time.',
    100, true, 100
  )
on conflict (slug) do nothing;