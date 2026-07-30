create or replace function public.account_email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists(select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;

revoke all on function public.account_email_exists(text) from public;
revoke all on function public.account_email_exists(text) from anon;
revoke all on function public.account_email_exists(text) from authenticated;

create table if not exists public.email_check_throttle (
  ip_hash text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.email_check_throttle to service_role;

alter table public.email_check_throttle enable row level security;