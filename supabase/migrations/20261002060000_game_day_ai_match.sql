-- Game Day's daily channel scan (edge function game-day-match).
--
-- Once a day per provider host, the model links the provider's event channel
-- names ("#11 Boston vs Michigan" in "B1G+") to today's games. One row per
-- (host, day) holds the answer every box on that provider reads. Boxes can
-- send back what they watched, picked or reported as the wrong game; those
-- signals become crowd matches and learned categories.
--
--   game_day_ai_matches     the scan per (host, day): matches per game, the
--                           line-up it was made from, and the scan counter
--   game_day_ai_usage       scans, tokens and cost per day (the global cap)
--   game_day_match_signals  play | wrong | pick from boxes (hashed ids only)
--
-- Service role only: RLS on with no policies, everything revoked from PUBLIC,
-- anon and authenticated (this project grants new objects to them by name).
-- New tables only; existing tables are not changed. Safe to run twice.

CREATE TABLE IF NOT EXISTS public.game_day_ai_matches (
  host            text        NOT NULL,
  day             date        NOT NULL,
  lineup_hash     text,
  candidates_hash text,
  matches         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  learned         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  scanned_at      timestamptz,
  scans           integer     NOT NULL DEFAULT 0,
  scan_started_at timestamptz,
  games           integer     NOT NULL DEFAULT 0,
  candidates      integer     NOT NULL DEFAULT 0,
  model           text,
  tokens_in       integer     NOT NULL DEFAULT 0,
  tokens_out      integer     NOT NULL DEFAULT 0,
  cost_usd        numeric     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host, day)
);
CREATE INDEX IF NOT EXISTS game_day_ai_matches_day_idx ON public.game_day_ai_matches (day);
ALTER TABLE public.game_day_ai_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_day_ai_matches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.game_day_ai_matches TO service_role;

CREATE TABLE IF NOT EXISTS public.game_day_ai_usage (
  day        date        PRIMARY KEY,
  calls      integer     NOT NULL DEFAULT 0,
  tokens_in  bigint      NOT NULL DEFAULT 0,
  tokens_out bigint      NOT NULL DEFAULT 0,
  cost_usd   numeric     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.game_day_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_day_ai_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.game_day_ai_usage TO service_role;

CREATE TABLE IF NOT EXISTS public.game_day_match_signals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  host          text        NOT NULL,
  game_id       text        NOT NULL,
  league        text,
  stream_id     bigint      NOT NULL,
  channel_name  text,
  category_name text,
  source        text        NOT NULL CHECK (source IN ('play', 'wrong', 'pick')),
  device_hash   text        NOT NULL,
  ip_hash       text,
  trusted       boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_day_match_signals_game_idx ON public.game_day_match_signals (host, game_id);
CREATE INDEX IF NOT EXISTS game_day_match_signals_host_time_idx ON public.game_day_match_signals (host, created_at);
CREATE INDEX IF NOT EXISTS game_day_match_signals_time_idx ON public.game_day_match_signals (created_at);
ALTER TABLE public.game_day_match_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_day_match_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.game_day_match_signals TO service_role;

-- One more scan for this host today: 'ok', 'busy' (another scan for the host
-- started under two minutes ago and has not finished: a morning's first
-- boxes must not each start one) or 'limit' (p_cap scans today). One
-- statement, so two requests at once cannot both get through.
CREATE OR REPLACE FUNCTION public.game_day_ai_host_take(p_host text, p_day date, p_cap integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scans integer;
BEGIN
  IF p_host IS NULL OR p_day IS NULL THEN
    RETURN 'limit';
  END IF;

  INSERT INTO public.game_day_ai_matches AS m (host, day, scans, scan_started_at)
  VALUES (p_host, p_day, 1, now())
  ON CONFLICT (host, day) DO UPDATE
    SET scans = m.scans + 1, scan_started_at = now(), updated_at = now()
    WHERE m.scans < p_cap
      AND (m.scan_started_at IS NULL OR m.scan_started_at < now() - interval '2 minutes')
  RETURNING scans INTO v_scans;

  IF FOUND THEN
    RETURN 'ok';
  END IF;

  SELECT scans INTO v_scans FROM public.game_day_ai_matches WHERE host = p_host AND day = p_day;
  RETURN CASE WHEN coalesce(v_scans, 0) >= p_cap THEN 'limit' ELSE 'busy' END;
END
$function$;

-- One more scan today across every host, unless p_cap is reached (the day is
-- US Eastern, as Game Day's list). One statement, as above.
CREATE OR REPLACE FUNCTION public.game_day_ai_take(p_cap integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_calls integer;
BEGIN
  INSERT INTO public.game_day_ai_usage AS u (day, calls)
  VALUES ((now() AT TIME ZONE 'America/New_York')::date, 1)
  ON CONFLICT (day) DO UPDATE
    SET calls = u.calls + 1, updated_at = now()
    WHERE u.calls < p_cap
  RETURNING calls INTO v_calls;

  IF NOT FOUND OR v_calls > p_cap THEN
    RETURN false;
  END IF;

  IF random() < 0.01 THEN
    DELETE FROM public.game_day_ai_usage WHERE day < (now() AT TIME ZONE 'America/New_York')::date - 400;
  END IF;
  RETURN true;
END
$function$;

-- What a scan used, added to today's row.
CREATE OR REPLACE FUNCTION public.game_day_ai_add(p_tokens_in bigint, p_tokens_out bigint, p_cost numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.game_day_ai_usage AS u (day, tokens_in, tokens_out, cost_usd)
  VALUES ((now() AT TIME ZONE 'America/New_York')::date,
          greatest(coalesce(p_tokens_in, 0), 0), greatest(coalesce(p_tokens_out, 0), 0), greatest(coalesce(p_cost, 0), 0))
  ON CONFLICT (day) DO UPDATE
    SET tokens_in = u.tokens_in + EXCLUDED.tokens_in,
        tokens_out = u.tokens_out + EXCLUDED.tokens_out,
        cost_usd = u.cost_usd + EXCLUDED.cost_usd,
        updated_at = now();
END
$function$;

REVOKE EXECUTE ON FUNCTION public.game_day_ai_host_take(text, date, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.game_day_ai_take(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.game_day_ai_add(bigint, bigint, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.game_day_ai_host_take(text, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_day_ai_take(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.game_day_ai_add(bigint, bigint, numeric) TO service_role;

-- The kill switch, on at launch. Adds a row; the table is unchanged.
INSERT INTO public.feature_flags (key, enabled)
VALUES ('gameday_ai_match', true)
ON CONFLICT (key) DO NOTHING;
