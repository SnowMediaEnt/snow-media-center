CREATE OR REPLACE FUNCTION public.create_tenant(p_name text, p_code text DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    primary_color, accent_color, splash_bg, in_app_logo_url
  ) VALUES (
    v_id, p_name, '', 'plain', '#3b82f6', '#22d3ee', '#0b1220', NULL
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
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant(text, text) TO authenticated;