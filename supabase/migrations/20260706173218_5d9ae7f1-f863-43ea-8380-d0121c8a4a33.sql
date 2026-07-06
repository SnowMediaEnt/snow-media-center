
ALTER TABLE public.tenant_settings ADD COLUMN IF NOT EXISTS apps_source_urls jsonb;

UPDATE public.tenant_settings
SET apps_source_url = 'https://snowmediaapps.com/guesswhat/apps.json.php?k=tJIso9tAokZ937fFcnpWT6YL0oJQ'
WHERE apps_source_url = 'https://snowmediaapps.com/apps/apps.json.php';

UPDATE public.tenant_settings
SET apps_source_urls = jsonb_build_array(jsonb_build_object('url', apps_source_url, 'enabled', true))
WHERE apps_source_url IS NOT NULL
  AND (apps_source_urls IS NULL OR jsonb_array_length(apps_source_urls) = 0);

CREATE OR REPLACE FUNCTION public.get_tenant_config(p_code text)
 RETURNS json
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT json_build_object(
    'tenant', json_build_object('id', t.id, 'code', t.code, 'name', t.name),
    'branding', json_build_object('app_display_name', b.app_display_name, 'in_app_logo_url', b.in_app_logo_url,
      'background_style', b.background_style, 'tagline', b.tagline, 'primary_color', b.primary_color,
      'accent_color', b.accent_color, 'splash_bg', b.splash_bg, 'background_image_url', b.background_image_url,
      'background_manifest_url', b.background_manifest_url, 'attribution', b.attribution),
    'settings', json_build_object('support_email', s.support_email, 'apps_source_url', s.apps_source_url,
      'apps_source_urls', s.apps_source_urls,
      'content_bar_default', s.content_bar_default, 'plex_autoconnect', s.plex_autoconnect, 'rss_url', s.rss_url,
      'community_enabled', s.community_enabled, 'support_videos_url', s.support_videos_url, 'website_url', s.website_url,
      'player_url', s.player_url, 'player_name', s.player_name),
    'features', COALESCE((SELECT json_object_agg(f.feature_key, f.enabled) FROM public.tenant_features f WHERE f.tenant_id=t.id),'{}'::json))
  FROM public.tenants t
  LEFT JOIN public.tenant_branding b ON b.tenant_id=t.id
  LEFT JOIN public.tenant_settings s ON s.tenant_id=t.id
  WHERE t.code=p_code AND t.status='active' LIMIT 1;
$function$;
