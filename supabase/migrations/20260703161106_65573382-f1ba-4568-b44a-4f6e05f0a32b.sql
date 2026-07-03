
-- 1. Tag player_signins with tenant code
ALTER TABLE public.player_signins ADD COLUMN IF NOT EXISTS reseller_id text;

-- 2. Update capture RPC to accept + validate tenant_code
CREATE OR REPLACE FUNCTION public.capture_player_signin(
  p_host text,
  p_username text,
  p_password text,
  p_expiration_date date,
  p_status text,
  p_max_connections integer,
  p_is_trial boolean,
  p_device_id text,
  p_server_label text,
  p_supabase_user_id uuid,
  p_matched_customer_id uuid,
  p_reason text,
  p_tenant_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matched uuid;
  v_reseller text := NULL;
BEGIN
  IF p_tenant_code IS NOT NULL
     AND btrim(p_tenant_code) <> ''
     AND lower(p_tenant_code) NOT IN ('snowmedia','canvas','ask') THEN
    SELECT code INTO v_reseller FROM public.tenants WHERE code = p_tenant_code;
  END IF;

  INSERT INTO public.player_signins (
    panel_host, panel_username, panel_password, expiration_date, xtream_status,
    max_connections, is_trial, device_id, server_label,
    supabase_user_id, matched_customer_id, reseller_id
  ) VALUES (
    p_host, p_username, p_password, p_expiration_date, p_status,
    p_max_connections, p_is_trial, p_device_id, p_server_label,
    p_supabase_user_id, p_matched_customer_id, v_reseller
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
    matched_customer_id = COALESCE(EXCLUDED.matched_customer_id, public.player_signins.matched_customer_id),
    reseller_id = COALESCE(EXCLUDED.reseller_id, public.player_signins.reseller_id)
  RETURNING matched_customer_id INTO v_matched;

  RETURN jsonb_build_object('ok', true, 'linked', v_matched IS NOT NULL);
END
$$;

-- 3. Reseller-scoped analytics RPCs

-- a. Overview
CREATE OR REPLACE FUNCTION public.tenant_analytics_overview(p_code text, p_days int)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid; v_code text; v_name text; v_status text;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
  v_result json;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'invalid tenant code'; END IF;
  IF p_code IN ('snowmedia','canvas','ask') THEN RAISE EXCEPTION 'null bucket not available via tenant RPC'; END IF;
  SELECT id, code, name, status INTO v_tenant_id, v_code, v_name, v_status FROM public.tenants WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
  IF NOT public.is_tenant_member(v_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT json_build_object(
    'tenant_code', v_code,
    'tenant_name', v_name,
    'tenant_status', v_status,
    'active_devices', COALESCE(e.active_devices, 0),
    'total_events', COALESCE(e.total_events, 0),
    'app_launches', COALESCE(e.app_launches, 0),
    'signins', COALESCE(e.signins, 0),
    'plex_opens', COALESCE(e.plex_opens, 0),
    'last_active', e.last_active,
    'sessions', COALESCE(s.sessions, 0),
    'avg_session_seconds', COALESCE(round(s.avg_session_seconds)::int, 0)
  ) INTO v_result
  FROM (
    SELECT
      count(DISTINCT device_id) FILTER (WHERE device_id IS NOT NULL) AS active_devices,
      count(*) AS total_events,
      count(*) FILTER (WHERE event_name = 'app_launched') AS app_launches,
      count(*) FILTER (WHERE event_category = 'player' AND event_name = 'livetv_signin') AS signins,
      count(*) FILTER (WHERE event_name = 'plex_open') AS plex_opens,
      max(occurred_at) AS last_active
    FROM public.analytics_events
    WHERE reseller_id = v_code AND occurred_at >= v_since
  ) e
  CROSS JOIN (
    SELECT
      count(*) AS sessions,
      avg(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL AND duration_seconds >= 0) AS avg_session_seconds
    FROM public.analytics_sessions
    WHERE reseller_id = v_code AND started_at >= v_since
  ) s;

  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.tenant_analytics_overview(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_analytics_overview(text,int) TO authenticated;

-- b. Daily activity
CREATE OR REPLACE FUNCTION public.tenant_analytics_daily(p_code text, p_days int)
RETURNS TABLE(day date, events bigint, active_devices bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid; v_code text;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'invalid tenant code'; END IF;
  IF p_code IN ('snowmedia','canvas','ask') THEN RAISE EXCEPTION 'null bucket not available via tenant RPC'; END IF;
  SELECT id, code INTO v_tenant_id, v_code FROM public.tenants WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
  IF NOT public.is_tenant_member(v_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  SELECT
    ((occurred_at AT TIME ZONE 'utc'))::date AS day,
    count(*)::bigint AS events,
    count(DISTINCT device_id)::bigint AS active_devices
  FROM public.analytics_events
  WHERE reseller_id = v_code AND occurred_at >= v_since
  GROUP BY 1
  ORDER BY 1;
END $$;
REVOKE ALL ON FUNCTION public.tenant_analytics_daily(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_analytics_daily(text,int) TO authenticated;

-- c. Area / screen time
CREATE OR REPLACE FUNCTION public.tenant_area_time(p_code text, p_days int)
RETURNS TABLE(screen text, total_seconds bigint, avg_seconds numeric, samples bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid; v_code text;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'invalid tenant code'; END IF;
  IF p_code IN ('snowmedia','canvas','ask') THEN RAISE EXCEPTION 'null bucket not available via tenant RPC'; END IF;
  SELECT id, code INTO v_tenant_id, v_code FROM public.tenants WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
  IF NOT public.is_tenant_member(v_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  SELECT
    left(coalesce(properties->>'screen','(unknown)'),64) AS screen,
    sum(least((properties->>'seconds')::int, 14400))::bigint AS total_seconds,
    avg(least((properties->>'seconds')::int, 14400))::numeric AS avg_seconds,
    count(*)::bigint AS samples
  FROM public.analytics_events
  WHERE event_name = 'screen_time'
    AND reseller_id = v_code
    AND occurred_at >= v_since
    AND (properties->>'seconds') ~ '^[0-9]+$'
    AND (properties->>'seconds')::int >= 2
  GROUP BY 1
  ORDER BY total_seconds DESC;
END $$;
REVOKE ALL ON FUNCTION public.tenant_area_time(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_area_time(text,int) TO authenticated;

-- d. App launches
CREATE OR REPLACE FUNCTION public.tenant_app_launches(p_code text, p_days int)
RETURNS TABLE(app text, launches bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid; v_code text;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'invalid tenant code'; END IF;
  IF p_code IN ('snowmedia','canvas','ask') THEN RAISE EXCEPTION 'null bucket not available via tenant RPC'; END IF;
  SELECT id, code INTO v_tenant_id, v_code FROM public.tenants WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
  IF NOT public.is_tenant_member(v_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  SELECT
    coalesce(properties->>'app','(unknown)') AS app,
    count(*)::bigint AS launches
  FROM public.analytics_events
  WHERE event_name = 'app_launched'
    AND reseller_id = v_code
    AND occurred_at >= v_since
  GROUP BY 1
  ORDER BY launches DESC
  LIMIT 50;
END $$;
REVOKE ALL ON FUNCTION public.tenant_app_launches(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_app_launches(text,int) TO authenticated;

-- e. Player activity
CREATE OR REPLACE FUNCTION public.tenant_player_activity(p_code text, p_days int)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid; v_code text;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
  v_counts json;
  v_top json;
BEGIN
  IF p_code IS NULL OR btrim(p_code) = '' THEN RAISE EXCEPTION 'invalid tenant code'; END IF;
  IF p_code IN ('snowmedia','canvas','ask') THEN RAISE EXCEPTION 'null bucket not available via tenant RPC'; END IF;
  SELECT id, code INTO v_tenant_id, v_code FROM public.tenants WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
  IF NOT public.is_tenant_member(v_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT json_build_object(
    'channel_plays', count(*) FILTER (WHERE event_name = 'channel_play'),
    'movie_plays',   count(*) FILTER (WHERE event_name = 'movie_play'),
    'series_plays',  count(*) FILTER (WHERE event_name = 'series_play'),
    'plex_plays',    count(*) FILTER (WHERE event_name = 'plex_play'),
    'signins',       count(*) FILTER (WHERE event_name = 'livetv_signin'),
    'searches',      count(*) FILTER (WHERE event_name = 'player_search'),
    'errors',        count(*) FILTER (WHERE event_name = 'player_error')
  ) INTO v_counts
  FROM public.analytics_events
  WHERE event_category = 'player'
    AND reseller_id = v_code
    AND occurred_at >= v_since;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_top
  FROM (
    SELECT properties->>'channel' AS channel, count(*)::bigint AS plays
    FROM public.analytics_events
    WHERE event_category = 'player'
      AND event_name = 'channel_play'
      AND reseller_id = v_code
      AND occurred_at >= v_since
      AND properties->>'channel' IS NOT NULL
    GROUP BY 1
    ORDER BY plays DESC
    LIMIT 15
  ) t;

  RETURN json_build_object('counts', v_counts, 'top_channels', v_top);
END $$;
REVOKE ALL ON FUNCTION public.tenant_player_activity(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_player_activity(text,int) TO authenticated;
