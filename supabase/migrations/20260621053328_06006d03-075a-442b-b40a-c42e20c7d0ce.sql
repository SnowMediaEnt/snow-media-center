CREATE OR REPLACE FUNCTION public.create_tenant(p_name text, p_code text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_id uuid;
  v_attempts int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Tenant name is required';
  END IF;

  IF p_code IS NOT NULL AND length(btrim(p_code)) > 0 THEN
    v_code := btrim(p_code);
    IF EXISTS (SELECT 1 FROM public.tenants WHERE code = v_code) THEN
      RAISE EXCEPTION 'Tenant code "%" already exists', v_code;
    END IF;
  ELSE
    LOOP
      v_attempts := v_attempts + 1;
      v_code := lpad((100000 + floor(random() * 900000)::int)::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tenants WHERE code = v_code);
      IF v_attempts > 50 THEN
        RAISE EXCEPTION 'Could not generate a unique 6-digit tenant code';
      END IF;
    END LOOP;
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