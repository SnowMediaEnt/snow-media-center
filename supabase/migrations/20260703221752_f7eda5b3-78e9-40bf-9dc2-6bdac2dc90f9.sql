
CREATE OR REPLACE FUNCTION public.admin_activity_series(p_bucket text, p_days int)
RETURNS TABLE(bucket date, active_devices bigint, events bigint, sessions bigint, signins bigint, avg_session_seconds numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket text;
  v_floor timestamptz := '2020-01-01';
  v_since timestamptz;
BEGIN
  IF NOT public.is_master() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_bucket := lower(coalesce(p_bucket,'day'));
  IF v_bucket NOT IN ('day','week','month') THEN
    v_bucket := 'day';
  END IF;

  v_since := CASE WHEN coalesce(p_days,0) <= 0
                  THEN v_floor
                  ELSE greatest(v_floor, now() - make_interval(days => p_days))
             END;

  RETURN QUERY
  WITH ev AS (
    SELECT date_trunc(v_bucket, occurred_at)::date AS bucket,
           count(DISTINCT device_id) FILTER (WHERE device_id IS NOT NULL) AS active_devices,
           count(*) AS events,
           count(*) FILTER (WHERE event_name = 'livetv_signin') AS signins
    FROM public.analytics_events
    WHERE occurred_at >= v_since
    GROUP BY 1
  ),
  se AS (
    SELECT date_trunc(v_bucket, started_at)::date AS bucket,
           count(*) AS sessions,
           round(avg(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL AND duration_seconds >= 0)) AS avg_session_seconds
    FROM public.analytics_sessions
    WHERE started_at >= v_since
    GROUP BY 1
  )
  SELECT coalesce(ev.bucket, se.bucket) AS bucket,
         coalesce(ev.active_devices, 0)::bigint,
         coalesce(ev.events, 0)::bigint,
         coalesce(se.sessions, 0)::bigint,
         coalesce(ev.signins, 0)::bigint,
         coalesce(se.avg_session_seconds, 0)::numeric
  FROM ev
  FULL OUTER JOIN se ON se.bucket = ev.bucket
  ORDER BY 1 ASC;
END
$$;

REVOKE ALL ON FUNCTION public.admin_activity_series(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_activity_series(text, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_series(text, int) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_activity_summary()
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor timestamptz := '2020-01-01';
  v_dau bigint;
  v_wau bigint;
  v_mau bigint;
  v_events_30d bigint;
  v_first_event timestamptz;
  v_sessions_30d bigint;
  v_avg_sess numeric;
  v_stickiness numeric;
BEGIN
  IF NOT public.is_master() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT
    count(DISTINCT device_id) FILTER (WHERE occurred_at >= date_trunc('day', now())),
    count(DISTINCT device_id) FILTER (WHERE occurred_at >= now() - interval '7 days'),
    count(DISTINCT device_id) FILTER (WHERE occurred_at >= now() - interval '30 days'),
    count(*) FILTER (WHERE occurred_at >= now() - interval '30 days'),
    min(occurred_at)
  INTO v_dau, v_wau, v_mau, v_events_30d, v_first_event
  FROM public.analytics_events
  WHERE occurred_at >= v_floor;

  SELECT count(*),
         round(avg(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL AND duration_seconds >= 0))
  INTO v_sessions_30d, v_avg_sess
  FROM public.analytics_sessions
  WHERE started_at >= now() - interval '30 days';

  v_stickiness := round((v_dau::numeric / nullif(v_mau, 0)) * 100, 1);

  RETURN json_build_object(
    'dau', coalesce(v_dau, 0),
    'wau', coalesce(v_wau, 0),
    'mau', coalesce(v_mau, 0),
    'stickiness_pct', coalesce(v_stickiness, 0),
    'events_30d', coalesce(v_events_30d, 0),
    'sessions_30d', coalesce(v_sessions_30d, 0),
    'avg_session_seconds_30d', coalesce(v_avg_sess, 0),
    'first_event', v_first_event
  );
END
$$;

REVOKE ALL ON FUNCTION public.admin_activity_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_activity_summary() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_summary() TO authenticated;
