-- A later sign-in capture can no longer move a line to another customer.
--
-- capture_player_signin wrote matched_customer_id = COALESCE(new, old), so
-- whoever captured a line last decided whose customer it was. A signed-in
-- caller whose own customers row the edge function passed in could take over
-- a line that already belonged to someone else, and link_player_signin_to_crm
-- then copied that line's stored panel password into the caller's own
-- customer_services row. The linker already refuses to replace a link ("Never
-- overwrite an existing matched_customer_id with a different customer"); the
-- capture now keeps the one it finds too. Only a line with no customer yet
-- takes the one it is given. Moving a line to someone else is a Hub job.
--
-- Everything else is exactly as in 20260905120100_capture_stamp_repair.sql.
--
-- The 12-argument overload (from 20260703054918, before tenant codes) is
-- dropped: nothing calls it (capture-player-signin passes p_tenant_code, so
-- it always resolves to the 13-argument one) and it still had the old
-- last-writer-wins upsert, password included.

CREATE OR REPLACE FUNCTION public.capture_player_signin(
  p_host text, p_username text, p_password text, p_expiration_date date,
  p_status text, p_max_connections integer, p_is_trial boolean, p_device_id text,
  p_server_label text, p_supabase_user_id uuid, p_matched_customer_id uuid,
  p_reason text, p_tenant_code text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
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
    panel_password = COALESCE(EXCLUDED.panel_password, public.player_signins.panel_password),
    expiration_date = EXCLUDED.expiration_date,
    xtream_status = EXCLUDED.xtream_status,
    max_connections = EXCLUDED.max_connections,
    is_trial = EXCLUDED.is_trial,
    server_label = EXCLUDED.server_label,
    last_seen_at = now(),
    device_id = CASE WHEN p_reason = 'signin' THEN EXCLUDED.device_id ELSE public.player_signins.device_id END,
    signin_count = public.player_signins.signin_count + CASE WHEN p_reason = 'signin' THEN 1 ELSE 0 END,
    supabase_user_id = CASE
      WHEN EXCLUDED.supabase_user_id IS NOT NULL AND (
        public.player_signins.supabase_user_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = public.player_signins.supabase_user_id)
      ) THEN EXCLUDED.supabase_user_id
      ELSE public.player_signins.supabase_user_id
    END,
    -- First link wins: an existing customer is kept, a new one only fills a gap.
    matched_customer_id = COALESCE(public.player_signins.matched_customer_id, EXCLUDED.matched_customer_id),
    reseller_id = COALESCE(EXCLUDED.reseller_id, public.player_signins.reseller_id)
  RETURNING id, matched_customer_id INTO v_id, v_matched;

  -- Auto-link/merge into the CRM on EVERY capture (signin + reconcile).
  -- Failures here must never break sign-in capture.
  BEGIN
    PERFORM public.link_player_signin_to_crm(v_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'link_player_signin_to_crm failed for %: %', v_id, SQLERRM;
  END;

  SELECT matched_customer_id INTO v_matched FROM public.player_signins WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'linked', v_matched IS NOT NULL);
END
$function$;

-- Server only, as 20260929060000 set it (repeated so this file stands alone).
REVOKE EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text);