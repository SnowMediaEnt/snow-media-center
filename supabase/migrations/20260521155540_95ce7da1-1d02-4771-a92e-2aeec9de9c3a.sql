
CREATE TABLE IF NOT EXISTS public.analytics_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL UNIQUE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  platform text,
  os_version text,
  app_version text,
  device_model text,
  form_factor text,
  reseller_id text,
  first_user_id uuid,
  last_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_last_seen ON public.analytics_devices(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_devices_reseller ON public.analytics_devices(reseller_id);

CREATE TABLE IF NOT EXISTS public.analytics_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL UNIQUE,
  device_id text NOT NULL,
  user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  app_version text,
  platform text,
  os_version text,
  reseller_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_device ON public.analytics_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_user ON public.analytics_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON public.analytics_sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  session_id text,
  user_id uuid,
  event_name text NOT NULL,
  event_category text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  platform text,
  reseller_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name ON public.analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_category ON public.analytics_events(event_category);
CREATE INDEX IF NOT EXISTS idx_analytics_events_occurred ON public.analytics_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON public.analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_device ON public.analytics_events(device_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_reseller ON public.analytics_events(reseller_id);

CREATE TABLE IF NOT EXISTS public.analytics_crashes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text NOT NULL,
  session_id text,
  user_id uuid,
  message text,
  stack text,
  component text,
  severity text DEFAULT 'error',
  app_version text,
  platform text,
  os_version text,
  reseller_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analytics_crashes_occurred ON public.analytics_crashes(occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_daily_rollup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  event_name text NOT NULL,
  reseller_id text,
  platform text,
  signed_in_count integer NOT NULL DEFAULT 0,
  anonymous_count integer NOT NULL DEFAULT 0,
  total_count integer NOT NULL DEFAULT 0,
  unique_devices integer NOT NULL DEFAULT 0,
  unique_users integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day, event_name, reseller_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_analytics_rollup_day ON public.analytics_daily_rollup(day DESC);

ALTER TABLE public.analytics_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_crashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_daily_rollup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can insert devices" ON public.analytics_devices
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(device_id) BETWEEN 8 AND 128);
CREATE POLICY "anon can update devices" ON public.analytics_devices
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (length(device_id) BETWEEN 8 AND 128);
CREATE POLICY "admins read devices" ON public.analytics_devices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "anon can insert sessions" ON public.analytics_sessions
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(session_id) BETWEEN 8 AND 128 AND length(device_id) BETWEEN 8 AND 128);
CREATE POLICY "anon can update sessions" ON public.analytics_sessions
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (length(session_id) BETWEEN 8 AND 128);
CREATE POLICY "admins read sessions" ON public.analytics_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "anon can insert events" ON public.analytics_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(device_id) BETWEEN 8 AND 128
    AND length(event_name) BETWEEN 1 AND 128
    AND octet_length(properties::text) <= 8192
  );
CREATE POLICY "admins read events" ON public.analytics_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "anon can insert crashes" ON public.analytics_crashes
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    length(device_id) BETWEEN 8 AND 128
    AND coalesce(octet_length(message), 0) <= 4096
    AND coalesce(octet_length(stack), 0) <= 16384
  );
CREATE POLICY "admins read crashes" ON public.analytics_crashes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins read rollup" ON public.analytics_daily_rollup
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.analytics_active_users(p_period text DEFAULT 'day')
RETURNS TABLE(period_start timestamptz, active_users bigint, active_devices bigint, anonymous_devices bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    date_trunc(
      CASE p_period WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' ELSE 'day' END,
      occurred_at
    ) AS period_start,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS active_users,
    COUNT(DISTINCT device_id) AS active_devices,
    COUNT(DISTINCT device_id) FILTER (WHERE user_id IS NULL) AS anonymous_devices
  FROM public.analytics_events
  WHERE occurred_at > now() - INTERVAL '90 days'
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

CREATE OR REPLACE FUNCTION public.analytics_event_counts(
  p_start timestamptz DEFAULT now() - INTERVAL '30 days',
  p_end timestamptz DEFAULT now(),
  p_reseller text DEFAULT NULL
)
RETURNS TABLE(day date, event_name text, total bigint, unique_devices bigint, unique_users bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    occurred_at::date AS day,
    event_name,
    COUNT(*) AS total,
    COUNT(DISTINCT device_id) AS unique_devices,
    COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS unique_users
  FROM public.analytics_events
  WHERE occurred_at BETWEEN p_start AND p_end
    AND (p_reseller IS NULL OR reseller_id = p_reseller)
    AND public.has_role(auth.uid(), 'admin')
  GROUP BY 1, 2
  ORDER BY 1 DESC, total DESC;
$$;

DROP TRIGGER IF EXISTS analytics_devices_updated_at ON public.analytics_devices;
CREATE TRIGGER analytics_devices_updated_at
  BEFORE UPDATE ON public.analytics_devices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS analytics_rollup_updated_at ON public.analytics_daily_rollup;
CREATE TRIGGER analytics_rollup_updated_at
  BEFORE UPDATE ON public.analytics_daily_rollup
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
