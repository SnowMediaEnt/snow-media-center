
ALTER TABLE public.tenant_branding ADD COLUMN IF NOT EXISTS attribution text;

CREATE OR REPLACE FUNCTION public.get_tenant_config(p_code text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'tenant', json_build_object('code', t.code, 'name', t.name),
    'branding', json_build_object(
      'app_display_name', b.app_display_name,
      'in_app_logo_url', b.in_app_logo_url,
      'background_style', b.background_style,
      'tagline', b.tagline,
      'primary_color', b.primary_color,
      'accent_color', b.accent_color,
      'splash_bg', b.splash_bg,
      'background_image_url', b.background_image_url,
      'background_manifest_url', b.background_manifest_url,
      'attribution', b.attribution
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
$function$;

CREATE OR REPLACE FUNCTION public.create_tenant(p_name text, p_code text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_slug text;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Tenant name is required';
  END IF;

  IF p_code IS NOT NULL AND length(btrim(p_code)) > 0 THEN
    v_code := lower(btrim(p_code));
  ELSE
    v_slug := lower(btrim(p_name));
    v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');
    IF v_slug = '' THEN v_slug := 'tenant'; END IF;
    v_code := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE code = v_code) THEN
    RAISE EXCEPTION 'Tenant code "%" already exists', v_code;
  END IF;

  INSERT INTO public.tenants (code, name, status)
  VALUES (v_code, p_name, 'active')
  RETURNING id INTO v_id;

  INSERT INTO public.tenant_branding (
    tenant_id, app_display_name, tagline, background_style,
    primary_color, accent_color, splash_bg, in_app_logo_url,
    background_image_url, background_manifest_url, attribution
  ) VALUES (
    v_id, p_name, '', 'plain', '#3b82f6', '#22d3ee', '#0b1220', NULL,
    NULL, NULL, NULL
  );

  INSERT INTO public.tenant_settings (
    tenant_id, support_email, apps_source_url, rss_url,
    content_bar_default, plex_autoconnect, community_enabled
  ) VALUES (
    v_id, NULL, NULL, NULL, false, false, false
  );

  INSERT INTO public.tenant_features (tenant_id, feature_key, enabled) VALUES
    (v_id, 'support_videos', true),
    (v_id, 'games', false),
    (v_id, 'ai', false),
    (v_id, 'wix_store', false),
    (v_id, 'community', false),
    (v_id, 'customer_dashboard', false),
    (v_id, 'content_bar', false);

  RETURN json_build_object('id', v_id, 'code', v_code, 'name', p_name);
END;
$function$;

UPDATE public.tenant_branding b
   SET app_display_name = 'Canvas',
       attribution = 'by Snow Media'
  FROM public.tenants t
 WHERE b.tenant_id = t.id AND t.code = 'canvas';
