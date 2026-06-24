
-- 1) Add global per-hour caps + counters to ai_free_config
ALTER TABLE public.ai_free_config
  ADD COLUMN IF NOT EXISTS global_calls_per_hour int NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS global_images_per_hour int NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS global_hour_bucket timestamptz,
  ADD COLUMN IF NOT EXISTS global_calls_this_hour int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS global_images_this_hour int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ip_chat_per_hour_usd numeric NOT NULL DEFAULT 0.50,
  ADD COLUMN IF NOT EXISTS ip_images_per_hour int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS ip_calls_per_hour int NOT NULL DEFAULT 20;

-- 2) Drop the public read policy that leaked spend counters
DROP POLICY IF EXISTS "Public read free ai config" ON public.ai_free_config;
REVOKE SELECT ON public.ai_free_config FROM anon;
REVOKE SELECT ON public.ai_free_config FROM authenticated;

-- 3) Per-IP per-hour ledger
CREATE TABLE IF NOT EXISTS public.ai_ip_usage (
  ip_hash text PRIMARY KEY,
  calls_this_hour int NOT NULL DEFAULT 0,
  images_this_hour int NOT NULL DEFAULT 0,
  chat_cost_usd numeric NOT NULL DEFAULT 0,
  hour_bucket timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ai_ip_usage TO service_role;
ALTER TABLE public.ai_ip_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read ip usage" ON public.ai_ip_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Lightweight public function: only a boolean, never the counters
CREATE OR REPLACE FUNCTION public.free_ai_available()
RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_paused boolean;
  v_paused_until timestamptz;
  v_cfg public.ai_free_config%ROWTYPE;
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', now());
  v_available boolean := false;
BEGIN
  SELECT enabled INTO v_flag FROM public.feature_flags WHERE key = 'free_ai_enabled';
  IF NOT COALESCE(v_flag, false) THEN
    RETURN json_build_object('enabled', false, 'available', false);
  END IF;

  SELECT paused, paused_until INTO v_paused, v_paused_until
    FROM public.ai_safety_state WHERE id = 1;
  IF COALESCE(v_paused, false) AND (v_paused_until IS NULL OR v_paused_until > v_now) THEN
    RETURN json_build_object('enabled', true, 'available', false);
  END IF;

  SELECT * INTO v_cfg FROM public.ai_free_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN json_build_object('enabled', true, 'available', false);
  END IF;

  v_available := (v_cfg.chat_spent_usd < v_cfg.chat_total_limit_usd)
              OR (v_cfg.images_used < v_cfg.images_total_limit);

  RETURN json_build_object('enabled', true, 'available', v_available);
END;
$$;
GRANT EXECUTE ON FUNCTION public.free_ai_available() TO anon, authenticated;

-- 5) Atomic reserve: row-lock config, check all caps, increment global/device/IP counters in one tx.
CREATE OR REPLACE FUNCTION public.reserve_free_ai(
  p_device_id text,
  p_ip_hash text,
  p_feature text,
  p_est_cost numeric,
  p_est_images int
) RETURNS json
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_paused boolean;
  v_paused_until timestamptz;
  v_cfg public.ai_free_config%ROWTYPE;
  v_dev public.ai_anon_usage%ROWTYPE;
  v_ip public.ai_ip_usage%ROWTYPE;
  v_dev_found boolean := false;
  v_ip_found boolean := false;
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', now());
  v_dev_calls_hour int := 0;
  v_g_calls int := 0;
  v_g_images int := 0;
  v_ip_calls int := 0;
  v_ip_images int := 0;
  v_ip_chat_cost numeric := 0;
  v_est_cost numeric := COALESCE(p_est_cost, 0);
  v_est_images int := COALESCE(p_est_images, 0);
BEGIN
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;
  IF p_feature NOT IN ('chat','image') THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT enabled INTO v_flag FROM public.feature_flags WHERE key = 'free_ai_enabled';
  IF NOT COALESCE(v_flag, false) THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT paused, paused_until INTO v_paused, v_paused_until
    FROM public.ai_safety_state WHERE id = 1;
  IF COALESCE(v_paused, false) AND (v_paused_until IS NULL OR v_paused_until > v_now) THEN
    RETURN json_build_object('allowed', false, 'reason', 'paused');
  END IF;

  -- Serialize on the singleton config row. All concurrent reservations queue here.
  SELECT * INTO v_cfg FROM public.ai_free_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  -- Reset global hour bucket if rolled over
  IF v_cfg.global_hour_bucket IS DISTINCT FROM v_hour THEN
    v_cfg.global_hour_bucket := v_hour;
    v_cfg.global_calls_this_hour := 0;
    v_cfg.global_images_this_hour := 0;
  END IF;
  v_g_calls := v_cfg.global_calls_this_hour;
  v_g_images := v_cfg.global_images_this_hour;

  -- Device + IP rows (no separate lock needed; serialized via config FOR UPDATE)
  SELECT * INTO v_dev FROM public.ai_anon_usage WHERE device_id = p_device_id;
  v_dev_found := FOUND;
  IF v_dev_found AND v_dev.hour_bucket = v_hour THEN
    v_dev_calls_hour := v_dev.calls_this_hour;
  END IF;

  IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0 THEN
    SELECT * INTO v_ip FROM public.ai_ip_usage WHERE ip_hash = p_ip_hash;
    v_ip_found := FOUND;
    IF v_ip_found AND v_ip.hour_bucket = v_hour THEN
      v_ip_calls := v_ip.calls_this_hour;
      v_ip_images := v_ip.images_this_hour;
      v_ip_chat_cost := v_ip.chat_cost_usd;
    END IF;
  END IF;

  -- Global per-hour velocity cap
  IF v_g_calls + 1 > v_cfg.global_calls_per_hour THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  -- Device per-hour rate limit
  IF v_dev_calls_hour + 1 > v_cfg.rate_limit_per_hour THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  -- IP per-hour caps
  IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0 THEN
    IF v_ip_calls + 1 > v_cfg.ip_calls_per_hour THEN
      RETURN json_build_object('allowed', false, 'reason', 'ip_rate_limited');
    END IF;
  END IF;

  IF p_feature = 'chat' THEN
    IF v_cfg.chat_spent_usd + v_est_cost > v_cfg.chat_total_limit_usd THEN
      RETURN json_build_object('allowed', false, 'reason', 'total_cap');
    END IF;
    IF v_dev_found AND v_dev.chat_cost_usd + v_est_cost > v_cfg.chat_per_device_limit_usd THEN
      RETURN json_build_object('allowed', false, 'reason', 'device_cap');
    END IF;
    IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0
       AND v_ip_chat_cost + v_est_cost > v_cfg.ip_chat_per_hour_usd THEN
      RETURN json_build_object('allowed', false, 'reason', 'ip_cap');
    END IF;
  ELSE -- image
    IF v_g_images + v_est_images > v_cfg.global_images_per_hour THEN
      RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
    END IF;
    IF v_cfg.images_used + v_est_images > v_cfg.images_total_limit THEN
      RETURN json_build_object('allowed', false, 'reason', 'total_cap');
    END IF;
    IF v_dev_found AND v_dev.images_used + v_est_images > v_cfg.images_per_device_limit THEN
      RETURN json_build_object('allowed', false, 'reason', 'device_cap');
    END IF;
    IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0
       AND v_ip_images + v_est_images > v_cfg.ip_images_per_hour THEN
      RETURN json_build_object('allowed', false, 'reason', 'ip_cap');
    END IF;
  END IF;

  -- Reserve: increment global counters now (config row already locked)
  UPDATE public.ai_free_config
     SET chat_spent_usd = chat_spent_usd
           + CASE WHEN p_feature = 'chat' THEN v_est_cost ELSE 0 END,
         images_used = images_used
           + CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END,
         global_hour_bucket = v_hour,
         global_calls_this_hour = v_g_calls + 1,
         global_images_this_hour = v_g_images
           + CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END,
         updated_at = now()
   WHERE id = 1;

  -- Reserve: per-device ledger
  INSERT INTO public.ai_anon_usage (
    device_id, chat_cost_usd, chat_calls, images_used, total_calls,
    hour_bucket, calls_this_hour
  ) VALUES (
    p_device_id,
    CASE WHEN p_feature = 'chat'  THEN v_est_cost ELSE 0 END,
    CASE WHEN p_feature = 'chat'  THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END,
    1, v_hour, 1
  )
  ON CONFLICT (device_id) DO UPDATE SET
    chat_cost_usd = public.ai_anon_usage.chat_cost_usd
      + CASE WHEN p_feature = 'chat' THEN v_est_cost ELSE 0 END,
    chat_calls = public.ai_anon_usage.chat_calls
      + CASE WHEN p_feature = 'chat' THEN 1 ELSE 0 END,
    images_used = public.ai_anon_usage.images_used
      + CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END,
    total_calls = public.ai_anon_usage.total_calls + 1,
    hour_bucket = v_hour,
    calls_this_hour = CASE
      WHEN public.ai_anon_usage.hour_bucket = v_hour
        THEN public.ai_anon_usage.calls_this_hour + 1
      ELSE 1 END,
    last_used_at = now();

  -- Reserve: per-IP ledger
  IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0 THEN
    INSERT INTO public.ai_ip_usage (
      ip_hash, calls_this_hour, images_this_hour, chat_cost_usd, hour_bucket
    ) VALUES (
      p_ip_hash, 1,
      CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END,
      CASE WHEN p_feature = 'chat'  THEN v_est_cost ELSE 0 END,
      v_hour
    )
    ON CONFLICT (ip_hash) DO UPDATE SET
      calls_this_hour = CASE
        WHEN public.ai_ip_usage.hour_bucket = v_hour
          THEN public.ai_ip_usage.calls_this_hour + 1
        ELSE 1 END,
      images_this_hour = CASE
        WHEN public.ai_ip_usage.hour_bucket = v_hour
          THEN public.ai_ip_usage.images_this_hour
            + CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END
        ELSE CASE WHEN p_feature = 'image' THEN v_est_images ELSE 0 END END,
      chat_cost_usd = CASE
        WHEN public.ai_ip_usage.hour_bucket = v_hour
          THEN public.ai_ip_usage.chat_cost_usd
            + CASE WHEN p_feature = 'chat' THEN v_est_cost ELSE 0 END
        ELSE CASE WHEN p_feature = 'chat' THEN v_est_cost ELSE 0 END END,
      hour_bucket = v_hour,
      last_seen_at = now();
  END IF;

  RETURN json_build_object('allowed', true, 'reason', 'ok');
END;
$$;

-- 6) Settle: reconcile to actual cost (delta vs reservation), or release if failed.
CREATE OR REPLACE FUNCTION public.settle_free_ai(
  p_device_id text,
  p_ip_hash text,
  p_feature text,
  p_est_cost numeric,
  p_est_images int,
  p_actual_cost numeric,
  p_actual_images int,
  p_succeeded boolean
) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cost_delta numeric;
  v_img_delta int;
  v_calls_delta int;
BEGIN
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RETURN;
  END IF;
  IF p_feature NOT IN ('chat','image') THEN
    RETURN;
  END IF;

  IF p_succeeded THEN
    v_cost_delta := COALESCE(p_actual_cost, 0) - COALESCE(p_est_cost, 0);
    v_img_delta  := COALESCE(p_actual_images, 0) - COALESCE(p_est_images, 0);
    v_calls_delta := 0; -- the call did happen; keep the +1 reserved
  ELSE
    -- Release the entire reservation
    v_cost_delta := - COALESCE(p_est_cost, 0);
    v_img_delta  := - COALESCE(p_est_images, 0);
    v_calls_delta := -1;
  END IF;

  -- Lock config and apply deltas. Floor at 0 to defend against bugs.
  PERFORM 1 FROM public.ai_free_config WHERE id = 1 FOR UPDATE;
  UPDATE public.ai_free_config
     SET chat_spent_usd = GREATEST(0, chat_spent_usd
           + CASE WHEN p_feature = 'chat' THEN v_cost_delta ELSE 0 END),
         images_used = GREATEST(0, images_used
           + CASE WHEN p_feature = 'image' THEN v_img_delta ELSE 0 END),
         global_calls_this_hour = GREATEST(0, global_calls_this_hour + v_calls_delta),
         global_images_this_hour = GREATEST(0, global_images_this_hour
           + CASE WHEN p_feature = 'image' THEN v_img_delta ELSE 0 END),
         updated_at = now()
   WHERE id = 1;

  UPDATE public.ai_anon_usage
     SET chat_cost_usd = GREATEST(0, chat_cost_usd
           + CASE WHEN p_feature = 'chat' THEN v_cost_delta ELSE 0 END),
         chat_calls = GREATEST(0, chat_calls
           + CASE WHEN p_feature = 'chat' THEN v_calls_delta ELSE 0 END),
         images_used = GREATEST(0, images_used
           + CASE WHEN p_feature = 'image' THEN v_img_delta ELSE 0 END),
         total_calls = GREATEST(0, total_calls + v_calls_delta),
         calls_this_hour = GREATEST(0, calls_this_hour + v_calls_delta),
         last_used_at = now()
   WHERE device_id = p_device_id;

  IF p_ip_hash IS NOT NULL AND length(p_ip_hash) > 0 THEN
    UPDATE public.ai_ip_usage
       SET calls_this_hour = GREATEST(0, calls_this_hour + v_calls_delta),
           images_this_hour = GREATEST(0, images_this_hour
             + CASE WHEN p_feature = 'image' THEN v_img_delta ELSE 0 END),
           chat_cost_usd = GREATEST(0, chat_cost_usd
             + CASE WHEN p_feature = 'chat' THEN v_cost_delta ELSE 0 END),
           last_seen_at = now()
     WHERE ip_hash = p_ip_hash;
  END IF;
END;
$$;

-- 7) Lock down execution to service_role only
REVOKE ALL ON FUNCTION public.reserve_free_ai(text, text, text, numeric, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_free_ai(text, text, text, numeric, int, numeric, int, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_free_ai(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_free_ai(text, text, numeric, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_free_ai(text, text, text, numeric, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_free_ai(text, text, text, numeric, int, numeric, int, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_free_ai(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_free_ai(text, text, numeric, int) TO service_role;
