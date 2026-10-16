-- Messages to the TVs signed into a Live TV line.
--
-- A line's owner (or an admin) sees the Snow Media Center installs signed
-- into that line (name, app version, last opened, watching now) and sends
-- them a short message; each TV shows it as a popup.
--
-- Each install makes its own private inbox key and registers it with the
-- device-inbox edge function together with the line it is signed into. The
-- function first signs the line in to its panel (only a box that knows the
-- line's password can register) and keeps the key's sha256 here, never the
-- key itself. The box then checks in with its key now and then: that stamps
-- last_seen_at (and watching_at while something is playing) and hands it the
-- messages waiting for it. A key that registers again for another line moves
-- to that line (the upsert on key_hash updates panel_host/panel_username).
--
-- Lines are named the way player_signins names them (the host as
-- capture-player-signin normalizes it, the username lowercased), which is
-- how the function decides who owns a line.
--
-- A message is one row per TV, kept 24 hours unless the box picks it up.
-- The line is copied onto the message so a box that moved lines never gets
-- the old line's messages, and so the "20 an hour per line" limit is one
-- indexed count. Register attempts are limited in player_login_throttle (see
-- _shared/requestGuard.ts), like the other functions anyone can reach.
--
-- Service role only: RLS on with no policies, and nothing granted to anon or
-- authenticated. Only the edge function reads or writes these.

create table if not exists public.device_inbox (
  id             uuid        primary key default gen_random_uuid(),
  key_hash       text        unique not null,
  panel_host     text        not null,
  panel_username text        not null,
  device_label   text        not null default '',
  app_version    text        not null default '',
  registered_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  watching_at    timestamptz null
);
create index if not exists device_inbox_line_idx on public.device_inbox (panel_host, panel_username);

create table if not exists public.device_messages (
  id             uuid        primary key default gen_random_uuid(),
  device_id      uuid        not null references public.device_inbox(id) on delete cascade,
  panel_host     text        not null,
  panel_username text        not null,
  body           text        not null check (char_length(body) between 1 and 200),
  sender         text        not null check (sender in ('admin', 'owner')),
  created_by     uuid        null,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '24 hours',
  delivered_at   timestamptz null,
  dismissed_at   timestamptz null
);
create index if not exists device_messages_device_idx on public.device_messages (device_id, delivered_at);
create index if not exists device_messages_line_idx on public.device_messages (panel_host, panel_username, created_at);

alter table public.device_inbox enable row level security;
alter table public.device_messages enable row level security;

revoke all on public.device_inbox from public, anon, authenticated;
revoke all on public.device_messages from public, anon, authenticated;
grant all on public.device_inbox to service_role;
grant all on public.device_messages to service_role;
