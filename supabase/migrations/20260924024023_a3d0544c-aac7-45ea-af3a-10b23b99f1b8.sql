-- Phone remote, take two: a phone gets the TV only when the TV says yes.
--
-- Before, anyone could call the phone-remote function's 'join' with 6-digit
-- guesses. Its only limit (15 tries per address) was keyed on the first
-- X-Forwarded-For entry, which the caller chooses, and was checked before
-- the try was written, so a burst went straight through. Every box that had
-- shown a text box in the last ten minutes had a live code, so guessing
-- across the fleet found one, and the answer was the box's secret: control
-- of that box's Snow Media Center until "Unpair all phones".
--
-- Now (with the new phone-remote function and the 1.7.8 app):
--   * codes are 8 letters (20 consonants, about 2.6e10 codes), are used up
--     by the first phone that enters them, and live only while the TV shows
--     them (the TV lets go of its code a minute after the QR goes away);
--   * a right code does not hand out the secret: it opens a join request
--     that the TV shows as "Allow this phone?", and the phone collects the
--     secret only after the TV's own remote pressed Allow;
--   * tries are counted per caller address (cf-connecting-ip, an IPv6 /64 as
--     one) and across all callers, in one locked step (remote_gate), so a
--     burst is counted in full;
--   * new pairings are limited per address, and pairings no phone was ever
--     allowed into are pruned after two quiet days.
--
-- Apply this BEFORE deploying the new phone-remote function. Service role
-- only, like the tables it builds on (20260928060000_phone_remote.sql).

-- Codes: 8 letters. The old 6-digit ones lived ten minutes; drop any left.
-- (The only check on remote_codes is the code's format, whatever name it
-- got when the table was made.)
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.remote_codes'::regclass and contype = 'c' loop
    execute format('alter table public.remote_codes drop constraint %I', c.conname);
  end loop;
end $$;
delete from public.remote_codes where code !~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$';
alter table public.remote_codes add constraint remote_codes_code_check check (code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{8}$');

-- When the TV last allowed a phone in. Pairings made before this (testing)
-- count as allowed, so no tester's box is pruned.
alter table public.remote_pairings add column if not exists approved_at timestamptz;
update public.remote_pairings set approved_at = created_at
  where approved_at is null and created_at < timestamptz '2026-09-30 08:00:00+00';
create index if not exists remote_pairings_unapproved_idx on public.remote_pairings (last_seen) where approved_at is null;

-- A phone that entered a right code, waiting for the TV. The phone holds
-- the token (only its hash is kept); the TV sees and answers the rid.
create table if not exists public.remote_join_requests (
  token_hash  text        primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  rid         text        not null unique check (rid ~ '^[0-9a-f]{16}$'),
  secret      text        not null references public.remote_pairings(secret) on delete cascade,
  device      text        not null,
  allowed     boolean,
  created_at  timestamptz not null default now(),
  notified_at timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists remote_join_requests_secret_idx on public.remote_join_requests (secret);
create index if not exists remote_join_requests_expires_idx on public.remote_join_requests (expires_at);
alter table public.remote_join_requests enable row level security;
revoke all on public.remote_join_requests from anon, authenticated;
grant all on public.remote_join_requests to service_role;

-- Tries: 'join' (a phone entering a code) or 'pair' (a new pairing).
alter table public.remote_join_attempts add column if not exists kind text not null default 'join';
create index if not exists remote_join_attempts_kind_idx on public.remote_join_attempts (kind, created_at desc);
drop index if exists public.remote_join_attempts_ip_idx;
create index if not exists remote_join_attempts_kind_ip_idx on public.remote_join_attempts (kind, ip_hash, created_at desc);
revoke all on public.remote_pairings from anon, authenticated;
revoke all on public.remote_codes from anon, authenticated;
revoke all on public.remote_join_attempts from anon, authenticated;

-- One try through the gate: 'ok' (and the try is written), 'too_many' (this
-- address used its tries in the window) or 'busy' (all callers together
-- did; p_all_max 0 means no fleet-wide cap). A lock per kind makes the
-- count-and-write one step, so a burst from anywhere is counted in full.
-- A refused try is not written: it neither extends the address's wait nor
-- uses up everyone's budget.
create or replace function public.remote_gate(
  p_kind text, p_ip_hash text,
  p_ip_max integer, p_ip_window_s integer,
  p_all_max integer, p_all_window_s integer
) returns text
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('smc-remote-gate:' || p_kind));
  select count(*) into n from public.remote_join_attempts
    where kind = p_kind and ip_hash = p_ip_hash and created_at > now() - make_interval(secs => p_ip_window_s);
  if n >= p_ip_max then return 'too_many'; end if;
  if p_all_max > 0 then
    select count(*) into n from public.remote_join_attempts
      where kind = p_kind and created_at > now() - make_interval(secs => p_all_window_s);
    if n >= p_all_max then return 'busy'; end if;
  end if;
  insert into public.remote_join_attempts (ip_hash, kind) values (p_ip_hash, p_kind);
  return 'ok';
end;
$$;

-- Only the phone-remote function (service role) calls it. New functions
-- here are granted to anon and authenticated by name, so take that back.
revoke execute on function public.remote_gate(text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.remote_gate(text, text, integer, integer, integer, integer) to service_role;