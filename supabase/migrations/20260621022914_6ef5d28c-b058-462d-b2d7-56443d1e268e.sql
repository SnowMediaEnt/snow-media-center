
-- 1. tenants
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  plan text NOT NULL DEFAULT 'starter',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tenants" ON public.tenants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. tenant_branding
CREATE TABLE public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  app_display_name text,
  in_app_logo_url text,
  background_style text,
  tagline text,
  primary_color text,
  accent_color text,
  splash_bg text
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_branding TO authenticated;
GRANT ALL ON public.tenant_branding TO service_role;
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tenant_branding" ON public.tenant_branding
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. tenant_settings
CREATE TABLE public.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  support_email text,
  apps_source_url text,
  content_bar_default boolean NOT NULL DEFAULT false,
  plex_autoconnect boolean NOT NULL DEFAULT false,
  rss_url text,
  community_enabled boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tenant_settings" ON public.tenant_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. tenant_features
CREATE TABLE public.tenant_features (
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, feature_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_features TO authenticated;
GRANT ALL ON public.tenant_features TO service_role;
ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tenant_features" ON public.tenant_features
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. RPC get_tenant_config
CREATE OR REPLACE FUNCTION public.get_tenant_config(p_code text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'tenant', json_build_object('code', t.code, 'name', t.name),
    'branding', json_build_object(
      'app_display_name', b.app_display_name,
      'in_app_logo_url', b.in_app_logo_url,
      'background_style', b.background_style,
      'tagline', b.tagline,
      'primary_color', b.primary_color,
      'accent_color', b.accent_color,
      'splash_bg', b.splash_bg
    ),
    'settings', json_build_object(
      'support_email', s.support_email,
      'apps_source_url', s.apps_source_url,
      'content_bar_default', s.content_bar_default,
      'plex_autoconnect', s.plex_autoconnect,
      'rss_url', s.rss_url,
      'community_enabled', s.community_enabled
    ),
    'features', COALESCE(
      (SELECT json_object_agg(f.feature_key, f.enabled)
         FROM public.tenant_features f
        WHERE f.tenant_id = t.id),
      '{}'::json
    )
  )
  FROM public.tenants t
  LEFT JOIN public.tenant_branding b ON b.tenant_id = t.id
  LEFT JOIN public.tenant_settings s ON s.tenant_id = t.id
  WHERE t.code = p_code AND t.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tenant_config(text) TO anon, authenticated;

-- 7. Seed tenants
WITH sm AS (
  INSERT INTO public.tenants (code, name) VALUES ('snowmedia', 'Snow Media Center') RETURNING id
)
INSERT INTO public.tenant_branding (tenant_id, app_display_name, in_app_logo_url, background_style, tagline, primary_color, accent_color, splash_bg)
SELECT id, 'Snow Media Center', NULL, 'snow', 'Stay Streamin — Stay Dreamin', '#c3aa72', '#a1d5dc', '#092145' FROM sm;

INSERT INTO public.tenant_settings (tenant_id, support_email, apps_source_url, content_bar_default, plex_autoconnect, rss_url, community_enabled)
SELECT id, 'support@snowmediaent.com', 'https://snowmediaapps.com/apps/apps.json.php', false, true, 'https://snowmediaapps.com/smc/newsfeed.xml', true
FROM public.tenants WHERE code = 'snowmedia';

INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT t.id, k, true
FROM public.tenants t,
     unnest(ARRAY['support_videos','games','ai','wix_store','community','customer_dashboard','content_bar']) AS k
WHERE t.code = 'snowmedia';

-- Canvas
WITH cv AS (
  INSERT INTO public.tenants (code, name) VALUES ('canvas', 'Canvas') RETURNING id
)
INSERT INTO public.tenant_branding (tenant_id, app_display_name, in_app_logo_url, background_style, tagline, primary_color, accent_color, splash_bg)
SELECT id, 'Canvas', NULL, 'plain', '', '#3b82f6', '#22d3ee', '#0b1220' FROM cv;

INSERT INTO public.tenant_settings (tenant_id, support_email, apps_source_url, content_bar_default, plex_autoconnect, rss_url, community_enabled)
SELECT id, NULL, NULL, false, false, NULL, false
FROM public.tenants WHERE code = 'canvas';

INSERT INTO public.tenant_features (tenant_id, feature_key, enabled) VALUES
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'support_videos', true),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'games', false),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'ai', false),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'wix_store', false),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'community', false),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'customer_dashboard', false),
  ((SELECT id FROM public.tenants WHERE code='canvas'), 'content_bar', false);
