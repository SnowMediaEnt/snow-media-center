
-- 1. Feature flag (ships OFF)
INSERT INTO public.feature_flags (key, enabled) VALUES ('free_ai_enabled', false)
ON CONFLICT (key) DO NOTHING;

-- 2. ai_free_config (single-row config)
CREATE TABLE public.ai_free_config (
  id int PRIMARY KEY DEFAULT 1,
  chat_total_limit_usd numeric NOT NULL DEFAULT 50,
  chat_per_device_limit_usd numeric NOT NULL DEFAULT 0.50,
  images_total_limit int NOT NULL DEFAULT 200,
  images_per_device_limit int NOT NULL DEFAULT 3,
  rate_limit_per_hour int NOT NULL DEFAULT 20,
  chat_spent_usd numeric NOT NULL DEFAULT 0,
  images_used int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_free_config_singleton CHECK (id = 1)
);
GRANT SELECT ON public.ai_free_config TO anon, authenticated;
GRANT ALL ON public.ai_free_config TO service_role;
ALTER TABLE public.ai_free_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read free ai config" ON public.ai_free_config
  FOR SELECT USING (true);
CREATE POLICY "Admin write free ai config" ON public.ai_free_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.ai_free_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. ai_anon_usage (per-device ledger; server-write only)
CREATE TABLE public.ai_anon_usage (
  device_id text PRIMARY KEY,
  chat_cost_usd numeric NOT NULL DEFAULT 0,
  chat_calls int NOT NULL DEFAULT 0,
  images_used int NOT NULL DEFAULT 0,
  total_calls int NOT NULL DEFAULT 0,
  hour_bucket timestamptz,
  calls_this_hour int NOT NULL DEFAULT 0,
  first_used_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_anon_usage TO authenticated;
GRANT ALL ON public.ai_anon_usage TO service_role;
-- intentionally no grant to anon
ALTER TABLE public.ai_anon_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin read anon usage" ON public.ai_anon_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
-- no INSERT/UPDATE/DELETE policies; only service_role bypasses RLS

-- 4. check_free_ai RPC
CREATE OR REPLACE FUNCTION public.check_free_ai(p_device_id text, p_feature text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_flag boolean;
  v_paused boolean;
  v_paused_until timestamptz;
  v_cfg public.ai_free_config%ROWTYPE;
  v_dev public.ai_anon_usage%ROWTYPE;
  v_dev_found boolean := false;
  v_calls_hour int := 0;
  v_now timestamptz := now();
  v_hour timestamptz := date_trunc('hour', now());
BEGIN
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT enabled INTO v_flag FROM public.feature_flags WHERE key = 'free_ai_enabled';
  IF NOT COALESCE(v_flag, false) THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT paused, paused_until INTO v_paused, v_paused_until
    FROM public.ai_safety_state WHERE id = 1;
  IF COALESCE(v_paused, false)
     AND (v_paused_until IS NULL OR v_paused_until > v_now) THEN
    RETURN json_build_object('allowed', false, 'reason', 'paused');
  END IF;

  SELECT * INTO v_cfg FROM public.ai_free_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  SELECT * INTO v_dev FROM public.ai_anon_usage WHERE device_id = p_device_id;
  v_dev_found := FOUND;

  IF v_dev_found AND v_dev.hour_bucket = v_hour THEN
    v_calls_hour := v_dev.calls_this_hour;
  END IF;

  IF v_calls_hour >= v_cfg.rate_limit_per_hour THEN
    RETURN json_build_object('allowed', false, 'reason', 'rate_limited');
  END IF;

  IF p_feature = 'chat' THEN
    IF v_cfg.chat_spent_usd >= v_cfg.chat_total_limit_usd THEN
      RETURN json_build_object('allowed', false, 'reason', 'total_cap');
    END IF;
    IF v_dev_found AND v_dev.chat_cost_usd >= v_cfg.chat_per_device_limit_usd THEN
      RETURN json_build_object('allowed', false, 'reason', 'device_cap');
    END IF;
  ELSIF p_feature = 'image' THEN
    IF v_cfg.images_used >= v_cfg.images_total_limit THEN
      RETURN json_build_object('allowed', false, 'reason', 'total_cap');
    END IF;
    IF v_dev_found AND v_dev.images_used >= v_cfg.images_per_device_limit THEN
      RETURN json_build_object('allowed', false, 'reason', 'device_cap');
    END IF;
  ELSE
    RETURN json_build_object('allowed', false, 'reason', 'disabled');
  END IF;

  RETURN json_build_object('allowed', true, 'reason', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.check_free_ai(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_free_ai(text, text) TO service_role;

-- 5. record_free_ai RPC (server-only)
CREATE OR REPLACE FUNCTION public.record_free_ai(
  p_device_id text,
  p_feature text,
  p_cost_usd numeric,
  p_images int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour timestamptz := date_trunc('hour', now());
BEGIN
  IF p_device_id IS NULL OR length(btrim(p_device_id)) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.ai_anon_usage (
    device_id, chat_cost_usd, chat_calls, images_used, total_calls,
    hour_bucket, calls_this_hour
  )
  VALUES (
    p_device_id,
    CASE WHEN p_feature = 'chat'  THEN COALESCE(p_cost_usd, 0) ELSE 0 END,
    CASE WHEN p_feature = 'chat'  THEN 1 ELSE 0 END,
    CASE WHEN p_feature = 'image' THEN COALESCE(p_images, 0) ELSE 0 END,
    1,
    v_hour,
    1
  )
  ON CONFLICT (device_id) DO UPDATE SET
    chat_cost_usd = public.ai_anon_usage.chat_cost_usd
      + CASE WHEN p_feature = 'chat' THEN COALESCE(p_cost_usd, 0) ELSE 0 END,
    chat_calls = public.ai_anon_usage.chat_calls
      + CASE WHEN p_feature = 'chat' THEN 1 ELSE 0 END,
    images_used = public.ai_anon_usage.images_used
      + CASE WHEN p_feature = 'image' THEN COALESCE(p_images, 0) ELSE 0 END,
    total_calls = public.ai_anon_usage.total_calls + 1,
    hour_bucket = v_hour,
    calls_this_hour = CASE
      WHEN public.ai_anon_usage.hour_bucket = v_hour
        THEN public.ai_anon_usage.calls_this_hour + 1
      ELSE 1
    END,
    last_used_at = now();

  UPDATE public.ai_free_config
     SET chat_spent_usd = chat_spent_usd
           + CASE WHEN p_feature = 'chat' THEN COALESCE(p_cost_usd, 0) ELSE 0 END,
         images_used = images_used
           + CASE WHEN p_feature = 'image' THEN COALESCE(p_images, 0) ELSE 0 END,
         updated_at = now()
   WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.record_free_ai(text, text, numeric, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_free_ai(text, text, numeric, int) TO service_role;
