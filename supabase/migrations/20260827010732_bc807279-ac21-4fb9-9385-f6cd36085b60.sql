-- Throttle table for the player-login bridge (line -> app-account session).
-- Same shape as player_signin_throttle; keys are hashed IPs or line:<host>:<user>.
CREATE TABLE IF NOT EXISTS public.player_login_throttle (
  ip_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);

GRANT ALL ON public.player_login_throttle TO service_role;

ALTER TABLE public.player_login_throttle ENABLE ROW LEVEL SECURITY;

-- Service-role only: no anon/authenticated policies on purpose. The edge
-- function is the sole reader/writer.