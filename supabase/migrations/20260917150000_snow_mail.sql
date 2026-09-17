-- Mail from Snow Media Entertainment, on the TV.
--
-- Every campaign the website sends by email is published here too (through
-- the mail-publish edge function), so the Support screen can list it, show
-- what has not been opened yet, and open it full screen. A campaign aimed at
-- everyone is visible to every box; one aimed at particular addresses is
-- visible only to an account signed in with one of them.
create table if not exists public.snow_mail (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      text not null unique,
  subject          text not null,
  preheader        text,
  blocks           jsonb not null default '[]'::jsonb,
  hero_image       text,
  audience_mode    text not null default 'all' check (audience_mode in ('all', 'targeted')),
  recipient_emails text[] not null default '{}',
  sent_at          timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists snow_mail_sent_idx on public.snow_mail (sent_at desc);

alter table public.snow_mail enable row level security;
drop policy if exists snow_mail_read on public.snow_mail;
create policy snow_mail_read on public.snow_mail
  for select to anon, authenticated
  using (
    audience_mode = 'all'
    or (auth.role() = 'authenticated' and lower(coalesce(auth.email(), '')) = any (recipient_emails))
  );
grant select on public.snow_mail to anon, authenticated;
grant all on public.snow_mail to service_role;

-- Which mails an account has opened, so the unread marker follows the
-- account to another box.
create table if not exists public.snow_mail_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  mail_id uuid not null references public.snow_mail(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, mail_id)
);
alter table public.snow_mail_reads enable row level security;
drop policy if exists snow_mail_reads_own on public.snow_mail_reads;
create policy snow_mail_reads_own on public.snow_mail_reads
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.snow_mail_reads to authenticated;
grant all on public.snow_mail_reads to service_role;

-- A running TV learns about new mail straight away.
do $$
begin
  alter publication supabase_realtime add table public.snow_mail;
exception when duplicate_object then null;
end $$;
