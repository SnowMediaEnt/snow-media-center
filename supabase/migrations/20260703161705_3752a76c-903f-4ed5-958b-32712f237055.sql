
CREATE OR REPLACE FUNCTION public.canvas_all_tenants_summary(p_days int)
RETURNS TABLE(
  reseller_id text,
  tenant_name text,
  tenant_status text,
  is_null_bucket boolean,
  active_devices bigint,
  sessions bigint,
  avg_session_seconds numeric,
  app_launches bigint,
  player_plays bigint,
  signins bigint,
  total_events bigint,
  last_active timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
BEGIN
  IF NOT public.is_master() THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  WITH ev AS (
    SELECT
      e.reseller_id,
      count(DISTINCT e.device_id) FILTER (WHERE e.device_id IS NOT NULL) AS active_devices,
      count(*) AS total_events,
      count(*) FILTER (WHERE e.event_name = 'app_launched') AS app_launches,
      count(*) FILTER (WHERE e.event_name = 'livetv_signin') AS signins,
      count(*) FILTER (
        WHERE e.event_category = 'player'
          AND e.event_name IN ('channel_play','movie_play','series_play','plex_play')
      ) AS player_plays,
      max(e.occurred_at) AS last_active
    FROM public.analytics_events e
    WHERE e.occurred_at >= v_since
    GROUP BY e.reseller_id
  ),
  se AS (
    SELECT
      s.reseller_id,
      count(*) AS sessions,
      round(avg(s.duration_seconds) FILTER (WHERE s.duration_seconds IS NOT NULL AND s.duration_seconds >= 0)) AS avg_session_seconds
    FROM public.analytics_sessions s
    WHERE s.started_at >= v_since
    GROUP BY s.reseller_id
  ),
  tenants_rows AS (
    SELECT
      t.code::text                                AS reseller_id,
      t.name::text                                AS tenant_name,
      t.status::text                              AS tenant_status,
      false                                       AS is_null_bucket,
      COALESCE(ev.active_devices, 0)::bigint     AS active_devices,
      COALESCE(se.sessions, 0)::bigint           AS sessions,
      COALESCE(se.avg_session_seconds, 0)::numeric AS avg_session_seconds,
      COALESCE(ev.app_launches, 0)::bigint       AS app_launches,
      COALESCE(ev.player_plays, 0)::bigint       AS player_plays,
      COALESCE(ev.signins, 0)::bigint            AS signins,
      COALESCE(ev.total_events, 0)::bigint       AS total_events,
      ev.last_active                             AS last_active
    FROM public.tenants t
    LEFT JOIN ev ON ev.reseller_id = t.code
    LEFT JOIN se ON se.reseller_id = t.code
    WHERE t.code NOT IN ('snowmedia','canvas')
  ),
  null_row AS (
    SELECT
      NULL::text                                   AS reseller_id,
      'Snow Media SMC app + untagged legacy'::text AS tenant_name,
      NULL::text                                   AS tenant_status,
      true                                         AS is_null_bucket,
      COALESCE(ev.active_devices, 0)::bigint       AS active_devices,
      COALESCE(se.sessions, 0)::bigint             AS sessions,
      COALESCE(se.avg_session_seconds, 0)::numeric AS avg_session_seconds,
      COALESCE(ev.app_launches, 0)::bigint         AS app_launches,
      COALESCE(ev.player_plays, 0)::bigint         AS player_plays,
      COALESCE(ev.signins, 0)::bigint              AS signins,
      COALESCE(ev.total_events, 0)::bigint         AS total_events,
      ev.last_active                               AS last_active
    FROM (SELECT * FROM ev WHERE ev.reseller_id IS NULL) ev
    FULL OUTER JOIN (SELECT * FROM se WHERE se.reseller_id IS NULL) se ON true
  )
  SELECT * FROM tenants_rows
  UNION ALL
  SELECT * FROM null_row
  ORDER BY is_null_bucket ASC, total_events DESC;
END $$;

REVOKE ALL ON FUNCTION public.canvas_all_tenants_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canvas_all_tenants_summary(int) TO authenticated;

-- Definer probe for the deny-path smoke test; dropped after verification below.
CREATE OR REPLACE FUNCTION public._probe_canvas_all(p_days int) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM count(*) FROM public.canvas_all_tenants_summary(p_days);
  RETURN 'NO_RAISE';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public._probe_canvas_all(int) TO supabase_read_only_user, authenticated;
