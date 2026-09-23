-- Phone remote: a phone's browser (snowmediaent.com/remote) as the box's
-- remote control, paired with a code like Fire TV's.
--
-- A box that pairs gets a secret; the phone that enters the box's 6-digit
-- code (or scans its QR) within ten minutes gets the same secret, and both
-- talk over the Realtime broadcast channel named after it. The secret stays
-- with the box until "Unpair all phones" replaces it, so a paired phone
-- keeps working. Service role only (the phone-remote edge function).

create table if not exists public.remote_pairings (
  secret      text        primary key check (secret ~ '^[0-9a-f]{64}$'),
  device_hash text        not null,
  label       text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists remote_pairings_device_idx on public.remote_pairings (device_hash);

create table if not exists public.remote_codes (
  code       text        primary key check (code ~ '^[0-9]{6}$'),
  secret     text        not null references public.remote_pairings(secret) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists remote_codes_secret_idx on public.remote_codes (secret);

create table if not exists public.remote_join_attempts (
  id         bigserial   primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists remote_join_attempts_ip_idx on public.remote_join_attempts (ip_hash, created_at desc);

alter table public.remote_pairings enable row level security;
alter table public.remote_codes enable row level security;
alter table public.remote_join_attempts enable row level security;

grant all on public.remote_pairings to service_role;
grant all on public.remote_codes to service_role;
grant all on public.remote_join_attempts to service_role;
grant usage, select on sequence public.remote_join_attempts_id_seq to service_role;
