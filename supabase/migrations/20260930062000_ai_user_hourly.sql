-- An hourly allowance per signed-in account for Snow AI (snow-media-ai).
--
-- The free tier is free to a signed-in caller on the server, so a script on
-- one free account could send requests without end: each one carries the
-- whole system prompt and knowledge files, and enough of them push the
-- platform-wide token total over ai_safety_state.token_threshold_per_hour,
-- which pauses AI for every customer. The edge function now takes one call
-- from this counter before asking the model and adds the tokens it used
-- after (see _shared/ai-guard.ts takeUserHourly / addUserHourlyTokens).
--
-- Service role only: RLS on with no policies, and both functions revoked
-- from PUBLIC, anon and authenticated (this project grants new functions to
-- anon and authenticated by name). Rows older than two days are dropped now
-- and then.

CREATE TABLE IF NOT EXISTS public.ai_user_hourly (
  user_id     uuid        NOT NULL,
  hour_bucket timestamptz NOT NULL,
  calls       integer     NOT NULL DEFAULT 0,
  tokens      bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, hour_bucket)
);
CREATE INDEX IF NOT EXISTS ai_user_hourly_bucket_idx ON public.ai_user_hourly (hour_bucket);
ALTER TABLE public.ai_user_hourly ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_user_hourly FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_user_hourly TO service_role;

-- One more call this hour, unless the account is already at either limit.
-- The insert/update is a single statement, so two requests at once cannot
-- both slip under the limit.
CREATE OR REPLACE FUNCTION public.ai_user_hourly_take(p_user_id uuid, p_max_calls integer, p_max_tokens bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket timestamptz := date_trunc('hour', now());
  v_calls integer;
  v_tokens bigint;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_user');
  END IF;

  INSERT INTO public.ai_user_hourly AS h (user_id, hour_bucket, calls)
  VALUES (p_user_id, v_bucket, 1)
  ON CONFLICT (user_id, hour_bucket) DO UPDATE
    SET calls = h.calls + 1
    WHERE h.calls < p_max_calls AND h.tokens < p_max_tokens
  RETURNING calls, tokens INTO v_calls, v_tokens;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'hourly_limit');
  END IF;

  IF random() < 0.01 THEN
    DELETE FROM public.ai_user_hourly WHERE hour_bucket < now() - interval '2 days';
  END IF;

  RETURN jsonb_build_object('allowed', true, 'calls', v_calls, 'tokens', v_tokens);
END
$function$;

-- The tokens a call used, added to the account's current hour.
CREATE OR REPLACE FUNCTION public.ai_user_hourly_add(p_user_id uuid, p_tokens bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_tokens IS NULL OR p_tokens <= 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.ai_user_hourly AS h (user_id, hour_bucket, tokens)
  VALUES (p_user_id, date_trunc('hour', now()), p_tokens)
  ON CONFLICT (user_id, hour_bucket) DO UPDATE SET tokens = h.tokens + EXCLUDED.tokens;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.ai_user_hourly_take(uuid, integer, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ai_user_hourly_add(uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_user_hourly_take(uuid, integer, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_user_hourly_add(uuid, bigint) TO service_role;
