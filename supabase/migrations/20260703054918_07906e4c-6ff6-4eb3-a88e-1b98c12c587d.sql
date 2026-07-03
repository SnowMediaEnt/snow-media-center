
-- 1. player_signins
CREATE TABLE public.player_signins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_host TEXT NOT NULL,
  panel_username TEXT NOT NULL,
  panel_password TEXT,
  server_label TEXT,
  expiration_date DATE,
  xtream_status TEXT,
  max_connections INT,
  is_trial BOOLEAN,
  device_id TEXT,
  supabase_user_id UUID,
  matched_customer_id UUID,
  signin_count INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT player_signins_host_user_key UNIQUE (panel_host, panel_username)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_signins TO authenticated;
GRANT ALL ON public.player_signins TO service_role;

ALTER TABLE public.player_signins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage player_signins"
  ON public.player_signins
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX player_signins_last_seen_idx ON public.player_signins (last_seen_at DESC);
CREATE INDEX player_signins_expiration_idx ON public.player_signins (expiration_date);
CREATE INDEX player_signins_matched_customer_idx ON public.player_signins (matched_customer_id);

-- 2. player_signin_throttle (service-role only)
CREATE TABLE public.player_signin_throttle (
  ip_hash TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INT NOT NULL DEFAULT 0
);

GRANT ALL ON public.player_signin_throttle TO service_role;

ALTER TABLE public.player_signin_throttle ENABLE ROW LEVEL SECURITY;
-- No policies: nothing but service_role can touch this table.

-- 3. Upsert function with the exact conflict semantics required.
CREATE OR REPLACE FUNCTION public.capture_player_signin(
  p_host TEXT,
  p_username TEXT,
  p_password TEXT,
  p_expiration_date DATE,
  p_status TEXT,
  p_max_connections INT,
  p_is_trial BOOLEAN,
  p_device_id TEXT,
  p_server_label TEXT,
  p_supabase_user_id UUID,
  p_matched_customer_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched UUID;
BEGIN
  INSERT INTO public.player_signins (
    panel_host, panel_username, panel_password, expiration_date, xtream_status,
    max_connections, is_trial, device_id, server_label,
    supabase_user_id, matched_customer_id
  ) VALUES (
    p_host, p_username, p_password, p_expiration_date, p_status,
    p_max_connections, p_is_trial, p_device_id, p_server_label,
    p_supabase_user_id, p_matched_customer_id
  )
  ON CONFLICT (panel_host, panel_username) DO UPDATE SET
    panel_password = EXCLUDED.panel_password,
    expiration_date = EXCLUDED.expiration_date,
    xtream_status = EXCLUDED.xtream_status,
    max_connections = EXCLUDED.max_connections,
    is_trial = EXCLUDED.is_trial,
    server_label = EXCLUDED.server_label,
    last_seen_at = now(),
    device_id = CASE WHEN p_reason = 'signin' THEN EXCLUDED.device_id ELSE public.player_signins.device_id END,
    signin_count = public.player_signins.signin_count + CASE WHEN p_reason = 'signin' THEN 1 ELSE 0 END,
    supabase_user_id = COALESCE(EXCLUDED.supabase_user_id, public.player_signins.supabase_user_id),
    matched_customer_id = COALESCE(EXCLUDED.matched_customer_id, public.player_signins.matched_customer_id)
  RETURNING matched_customer_id INTO v_matched;

  RETURN jsonb_build_object('ok', true, 'linked', v_matched IS NOT NULL);
END
$$;

REVOKE ALL ON FUNCTION public.capture_player_signin(TEXT,TEXT,TEXT,DATE,TEXT,INT,BOOLEAN,TEXT,TEXT,UUID,UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.capture_player_signin(TEXT,TEXT,TEXT,DATE,TEXT,INT,BOOLEAN,TEXT,TEXT,UUID,UUID,TEXT) TO service_role;
