-- 1) Normalization trigger: panel_username := lower(trim(...)) on every write.
CREATE OR REPLACE FUNCTION public.customer_services_normalize_username()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $func$
BEGIN
  IF NEW.panel_username IS NOT NULL THEN
    NEW.panel_username := lower(trim(NEW.panel_username));
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_customer_services_normalize_username ON public.customer_services;
CREATE TRIGGER trg_customer_services_normalize_username
BEFORE INSERT OR UPDATE ON public.customer_services
FOR EACH ROW EXECUTE FUNCTION public.customer_services_normalize_username();

-- 2) Normalize existing rows to match the trigger's rules.
UPDATE public.customer_services
SET panel_username = lower(trim(panel_username))
WHERE panel_username IS NOT NULL
  AND panel_username <> lower(trim(panel_username));

-- 3) Uniqueness: one row per (customer, username); one per (customer, service) when no username.
CREATE UNIQUE INDEX customer_services_customer_panel_key
  ON public.customer_services (customer_id, panel_username)
  WHERE panel_username IS NOT NULL;

CREATE UNIQUE INDEX customer_services_customer_service_key
  ON public.customer_services (customer_id, lower(coalesce(service_name,'')))
  WHERE panel_username IS NULL;

-- 4) Race-safe Rule-1 sync inside the CRM linker (ON CONFLICT replaces select-then-insert).
CREATE OR REPLACE FUNCTION public.link_player_signin_to_crm(p_signin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ps RECORD;
  v_customer_id uuid;
  v_email text;
  v_host text;
  v_service_name text;
  v_renewal text;
  v_created_customer boolean := false;
  v_linked_new boolean := false;
  v_match_count integer;
  v_svc_id uuid;
  v_svc_upserted boolean := false;
  v_svc_propagated integer := 0;
BEGIN
  SELECT * INTO v_ps FROM public.player_signins WHERE id = p_signin_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'signin_not_found');
  END IF;

  -- customer_services stores panel_host WITH scheme; player_signins stores it bare.
  v_host := CASE WHEN v_ps.panel_host = 'strmz.xyz'
                 THEN 'https://strmz.xyz'
                 ELSE 'http://' || v_ps.panel_host END;
  v_service_name := CASE WHEN v_ps.panel_host = 'strmz.xyz'
                            OR coalesce(v_ps.server_label, '') ILIKE '%vibez%'
                         THEN 'VibezTV' ELSE 'Dreamstreams' END;
  -- Same mapping as src/lib/playerAccountSync.ts renewalFromStatus.
  v_renewal := CASE WHEN lower(coalesce(v_ps.xtream_status, '')) IN ('', 'active', 'trial')
                    THEN 'active' ELSE 'expired' END;

  v_customer_id := v_ps.matched_customer_id;

  -- Rules 2 + 4: email match-or-create. Username-as-email first (Vibez routing),
  -- then the signed-in profile's email for non-email usernames.
  IF v_customer_id IS NULL THEN
    v_email := NULL;
    IF position('@' in v_ps.panel_username) > 1 THEN
      v_email := lower(btrim(v_ps.panel_username));
    ELSIF v_ps.supabase_user_id IS NOT NULL THEN
      SELECT lower(p.email) INTO v_email
      FROM public.profiles p
      WHERE p.user_id = v_ps.supabase_user_id
        AND p.email LIKE '%@%.%'
      LIMIT 1;
    END IF;

    IF v_email IS NOT NULL THEN
      SELECT c.id INTO v_customer_id FROM public.customers c
      WHERE lower(c.email) = v_email LIMIT 1;

      IF v_customer_id IS NULL THEN
        INSERT INTO public.customers (email, name, notes)
        VALUES (v_email, split_part(v_email, '@', 1), 'auto-created from player sign-in')
        ON CONFLICT (email) DO NOTHING
        RETURNING id INTO v_customer_id;
        IF v_customer_id IS NULL THEN
          -- Lost a race with a concurrent insert: adopt the existing row.
          SELECT c.id INTO v_customer_id FROM public.customers c
          WHERE lower(c.email) = v_email LIMIT 1;
        ELSE
          v_created_customer := true;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Rule 3: non-email username → link only when exactly one customer uses it.
  IF v_customer_id IS NULL AND position('@' in v_ps.panel_username) = 0 THEN
    SELECT count(DISTINCT cs.customer_id) INTO v_match_count
    FROM public.customer_services cs
    WHERE lower(cs.panel_username) = lower(v_ps.panel_username);
    IF v_match_count = 1 THEN
      SELECT cs.customer_id INTO v_customer_id
      FROM public.customer_services cs
      WHERE lower(cs.panel_username) = lower(v_ps.panel_username)
      LIMIT 1;
    ELSE
      v_customer_id := NULL;
    END IF;
  END IF;

  -- Never overwrite an existing matched_customer_id with a different customer.
  IF v_customer_id IS NOT NULL AND v_ps.matched_customer_id IS NULL THEN
    UPDATE public.player_signins
    SET matched_customer_id = v_customer_id
    WHERE id = p_signin_id AND matched_customer_id IS NULL;
    v_linked_new := FOUND;
  ELSIF v_ps.matched_customer_id IS NOT NULL THEN
    v_customer_id := v_ps.matched_customer_id;
  END IF;

  -- Rule 1: sync the matched customer's customer_services row. Race-safe upsert
  -- against customer_services_customer_panel_key; a concurrent insert merges
  -- instead of duplicating. No-regress: a stale capture must not move an
  -- expiration backwards, and status only follows when the panel's date wins.
  IF v_customer_id IS NOT NULL THEN
    INSERT INTO public.customer_services (
      customer_id, service_type, service_name, panel_username, panel_password,
      panel_host, expiration_date, renewal_status, max_connections, is_trial
    ) VALUES (
      v_customer_id, 'IPTV', v_service_name, v_ps.panel_username, v_ps.panel_password,
      v_host, v_ps.expiration_date, v_renewal, v_ps.max_connections, v_ps.is_trial
    )
    ON CONFLICT (customer_id, panel_username) WHERE panel_username IS NOT NULL
    DO UPDATE SET
      expiration_date = CASE
        WHEN public.customer_services.expiration_date IS NULL THEN EXCLUDED.expiration_date
        WHEN EXCLUDED.expiration_date IS NULL THEN public.customer_services.expiration_date
        ELSE greatest(public.customer_services.expiration_date, EXCLUDED.expiration_date)
      END,
      renewal_status = CASE
        WHEN EXCLUDED.expiration_date IS NOT NULL
             AND (public.customer_services.expiration_date IS NULL
                  OR EXCLUDED.expiration_date >= public.customer_services.expiration_date)
        THEN EXCLUDED.renewal_status
        ELSE public.customer_services.renewal_status
      END,
      panel_password  = coalesce(EXCLUDED.panel_password, public.customer_services.panel_password),
      panel_host      = coalesce(public.customer_services.panel_host, EXCLUDED.panel_host),
      max_connections = coalesce(EXCLUDED.max_connections, public.customer_services.max_connections),
      is_trial        = coalesce(EXCLUDED.is_trial, public.customer_services.is_trial)
    RETURNING id INTO v_svc_id;
    v_svc_upserted := true;
  END IF;

  -- Username-wide propagation: heal CRM rows for other/unlinked customers with
  -- the same line (panel_host matched with scheme variants or NULL). Same
  -- no-regress guard as above. Skips the row already synced.
  WITH matched_rows AS (
    SELECT cs.id, cs.expiration_date
    FROM public.customer_services cs
    WHERE lower(cs.panel_username) = lower(v_ps.panel_username)
      AND (cs.panel_host IS NULL
           OR cs.panel_host IN ('http://' || v_ps.panel_host, 'https://' || v_ps.panel_host))
      AND (v_svc_id IS NULL OR cs.id <> v_svc_id)
  ), upd AS (
    UPDATE public.customer_services cs
    SET expiration_date = CASE
          WHEN m.expiration_date IS NULL THEN v_ps.expiration_date
          WHEN v_ps.expiration_date IS NULL THEN m.expiration_date
          ELSE greatest(m.expiration_date, v_ps.expiration_date)
        END,
        renewal_status = CASE
          WHEN v_ps.expiration_date IS NOT NULL
               AND (m.expiration_date IS NULL OR v_ps.expiration_date >= m.expiration_date)
          THEN v_renewal ELSE cs.renewal_status END
    FROM matched_rows m
    WHERE cs.id = m.id
    RETURNING cs.id
  )
  SELECT count(*) INTO v_svc_propagated FROM upd;

  RETURN jsonb_build_object(
    'ok', true,
    'linked_new', v_linked_new,
    'customer_created', v_created_customer,
    'matched_customer_id', v_customer_id,
    'service_upserted', v_svc_upserted,
    'services_propagated', v_svc_propagated
  );
END;
$function$