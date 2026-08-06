-- Account-claim flow: lets a player-only user (Xtream panel sign-in, no Snow
-- Media account) attach an email/account so renewal outreach is possible.

-- 1. Short-lived sessions carrying the panel identity from TV → phone.
CREATE TABLE public.account_claim_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  panel_username text NOT NULL,
  panel_host text NOT NULL,
  server_label text,
  expiration_date date,
  max_connections integer,
  is_trial boolean,
  claimed_user_id uuid,
  claimed_email text,
  completed_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- No anon/authenticated table grants on purpose: every read/write flows through
-- the security-definer functions below (the hardened qr_login_sessions pattern).
-- service_role keeps full access for admin jobs / edge functions.
GRANT ALL ON public.account_claim_sessions TO service_role;

ALTER TABLE public.account_claim_sessions ENABLE ROW LEVEL SECURITY;
-- No RLS policies: table-level access is denied for anon/authenticated and the
-- functions below bypass RLS as security definer.

-- 2. TV creates a pending session; returns the token encoded in the QR.
CREATE OR REPLACE FUNCTION public.create_claim_session(
  p_panel_username text,
  p_panel_host text,
  p_server_label text DEFAULT NULL,
  p_expiration_date date DEFAULT NULL,
  p_max_connections integer DEFAULT NULL,
  p_is_trial boolean DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token text := gen_random_uuid()::text;
  v_username text := lower(btrim(coalesce(p_panel_username, '')));
  v_host text := rtrim(btrim(coalesce(p_panel_host, '')), '/');
BEGIN
  IF v_username = '' OR length(v_username) > 256 THEN
    RAISE EXCEPTION 'bad_username';
  END IF;
  IF v_host = '' OR length(v_host) > 256 OR v_host !~ '^https?://' THEN
    RAISE EXCEPTION 'bad_host';
  END IF;

  INSERT INTO public.account_claim_sessions (
    token, panel_username, panel_host, server_label,
    expiration_date, max_connections, is_trial
  ) VALUES (
    v_token, v_username, v_host,
    nullif(btrim(coalesce(p_server_label, '')), ''),
    p_expiration_date, p_max_connections, p_is_trial
  );
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_claim_session(text,text,text,date,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_claim_session(text,text,text,date,integer,boolean) TO anon, authenticated;

-- 3. Token-scoped read for the TV (polling) and the phone (claim form).
CREATE OR REPLACE FUNCTION public.get_claim_session(p_token text)
RETURNS TABLE(
  token text,
  panel_username text,
  server_label text,
  expiration_date date,
  completed_at timestamp with time zone,
  claimed_email text,
  expires_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT s.token, s.panel_username, s.server_label, s.expiration_date,
         s.completed_at, s.claimed_email, s.expires_at
  FROM public.account_claim_sessions s
  WHERE s.token = p_token
    AND s.expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_claim_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_claim_session(text) TO anon, authenticated;

-- 4. Shared writer: upsert customer_services in the exact shape
-- src/lib/playerAccountSync.ts writes, stamp the player_signins row, then
-- enrich from the captured sign-in (fills panel_password + propagates).
CREATE OR REPLACE FUNCTION public.link_claimed_panel_line(
  p_customer_id uuid,
  p_supabase_user_id uuid,
  p_panel_username text,
  p_panel_host text,
  p_server_label text,
  p_expiration_date date,
  p_max_connections integer,
  p_is_trial boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_username text := lower(btrim(coalesce(p_panel_username, '')));
  v_host text := rtrim(btrim(coalesce(p_panel_host, '')), '/');
  v_bare_host text;
  v_service_name text;
  v_renewal text;
  v_signin_id uuid;
  v_stamped integer := 0;
BEGIN
  -- player_signins stores the host bare (no scheme); customer_services with scheme.
  v_bare_host := regexp_replace(lower(v_host), '^https?://', '');
  IF v_bare_host = 'dstreams.xyz' THEN
    v_bare_host := 'dstreams.xyz:8080';
  END IF;
  v_service_name := CASE WHEN coalesce(p_server_label, '') ILIKE '%vibez%'
                            OR v_bare_host = 'strmz.xyz'
                         THEN 'VibezTV' ELSE 'Dreamstreams' END;
  v_renewal := CASE WHEN p_expiration_date IS NULL OR p_expiration_date >= current_date
                    THEN 'active' ELSE 'expired' END;

  -- Same no-regress guards as link_player_signin_to_crm: an older claim must
  -- never move an expiration backwards, and status only follows a winning date.
  INSERT INTO public.customer_services (
    customer_id, service_type, service_name, panel_username,
    panel_host, expiration_date, renewal_status, max_connections, is_trial
  ) VALUES (
    p_customer_id, 'IPTV', v_service_name, v_username,
    v_host, p_expiration_date, v_renewal, p_max_connections, p_is_trial
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
    panel_host      = coalesce(public.customer_services.panel_host, EXCLUDED.panel_host),
    max_connections = coalesce(EXCLUDED.max_connections, public.customer_services.max_connections),
    is_trial        = coalesce(EXCLUDED.is_trial, public.customer_services.is_trial);

  -- Stamp the captured sign-in row so this person stops showing as a LEAD.
  -- Never overwrite a different customer's match.
  UPDATE public.player_signins
  SET matched_customer_id = coalesce(matched_customer_id, p_customer_id),
      supabase_user_id = coalesce(supabase_user_id, p_supabase_user_id)
  WHERE panel_host = v_bare_host
    AND lower(panel_username) = v_username
    AND (matched_customer_id IS NULL OR matched_customer_id = p_customer_id);
  GET DIAGNOSTICS v_stamped = ROW_COUNT;

  -- Enrich from the captured sign-in (fills panel_password, propagates to other
  -- CRM rows for the same line). Best-effort: must never fail the claim.
  SELECT id INTO v_signin_id
  FROM public.player_signins
  WHERE panel_host = v_bare_host AND lower(panel_username) = v_username
  LIMIT 1;
  IF v_signin_id IS NOT NULL THEN
    BEGIN
      PERFORM public.link_player_signin_to_crm(v_signin_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'link_player_signin_to_crm failed for %: %', v_signin_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'signin_stamped', v_stamped > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.link_claimed_panel_line(uuid,uuid,text,text,text,date,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_claimed_panel_line(uuid,uuid,text,text,text,date,integer,boolean) TO service_role;

-- 5. Phone completes the claim (must be signed in — existing or new account).
CREATE OR REPLACE FUNCTION public.complete_account_claim(
  p_token text,
  p_name text DEFAULT NULL,
  p_device_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_device text := nullif(btrim(coalesce(p_device_type, '')), '');
  v_s RECORD;
  v_customer_id uuid;
  v_existing_user uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT lower(u.email) INTO v_email FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_email');
  END IF;

  SELECT * INTO v_s
  FROM public.account_claim_sessions
  WHERE token = p_token AND expires_at > now()
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_or_expired');
  END IF;

  -- Idempotent: a retry after a network hiccup returns the original result.
  IF v_s.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true,
      'email', CASE WHEN v_s.claimed_user_id = v_uid THEN v_s.claimed_email ELSE NULL END);
  END IF;

  -- Ensure the customers row: by user id, then by email (adopt unlinked rows
  -- the CRM auto-created), else create.
  SELECT c.id INTO v_customer_id FROM public.customers c WHERE c.user_id = v_uid LIMIT 1;
  IF v_customer_id IS NULL THEN
    SELECT c.id, c.user_id INTO v_customer_id, v_existing_user
    FROM public.customers c WHERE lower(c.email) = v_email LIMIT 1;
    IF v_customer_id IS NOT NULL THEN
      IF v_existing_user IS NOT NULL AND v_existing_user <> v_uid THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'email_in_use');
      END IF;
      IF v_existing_user IS NULL THEN
        UPDATE public.customers SET user_id = v_uid WHERE id = v_customer_id;
      END IF;
    END IF;
  END IF;
  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (user_id, email, name, notes)
    VALUES (v_uid, v_email, coalesce(v_name, split_part(v_email, '@', 1)), 'created via account claim')
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_customer_id;
    IF v_customer_id IS NULL THEN
      -- Lost a race with a concurrent insert: adopt the existing row.
      SELECT c.id INTO v_customer_id FROM public.customers c WHERE lower(c.email) = v_email LIMIT 1;
      UPDATE public.customers SET user_id = v_uid WHERE id = v_customer_id AND user_id IS NULL;
    END IF;
  END IF;

  -- Optional name: fill when the row has none or only the auto-derived prefix.
  IF v_name IS NOT NULL THEN
    UPDATE public.customers
    SET name = v_name
    WHERE id = v_customer_id
      AND (name IS NULL OR btrim(name) = '' OR lower(name) = lower(split_part(v_email, '@', 1)));
  END IF;

  PERFORM public.link_claimed_panel_line(
    v_customer_id, v_uid, v_s.panel_username, v_s.panel_host,
    v_s.server_label, v_s.expiration_date, v_s.max_connections, v_s.is_trial
  );

  -- Optional device record (customer_devices keys on customer_id and holds
  -- device_type/label/notes — the right home for what the phone collected).
  IF v_device IS NOT NULL AND length(v_device) <= 64 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.customer_devices d
      WHERE d.customer_id = v_customer_id AND lower(d.device_type) = lower(v_device)
    ) THEN
      INSERT INTO public.customer_devices (customer_id, device_type, notes)
      VALUES (v_customer_id, v_device, 'Added via account claim');
    END IF;
  END IF;

  UPDATE public.account_claim_sessions
  SET claimed_user_id = v_uid,
      claimed_email = v_email,
      completed_at = now()
  WHERE id = v_s.id AND completed_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'email', v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_account_claim(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_account_claim(text,text,text) TO authenticated;

-- 6. Manual fallback from the TV (anonymous): email-only claim. Requires proof
-- of a real panel sign-in (a captured player_signins row) so anonymous callers
-- cannot spam customer records.
CREATE OR REPLACE FUNCTION public.claim_account_manual(
  p_panel_username text,
  p_panel_host text,
  p_server_label text,
  p_expiration_date date,
  p_max_connections integer,
  p_is_trial boolean,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_username text := lower(btrim(coalesce(p_panel_username, '')));
  v_bare_host text;
  v_customer_id uuid;
  v_signin_id uuid;
BEGIN
  IF v_email = '' OR length(v_email) > 320
     OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_email');
  END IF;
  IF v_username = '' OR length(v_username) > 256 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_username');
  END IF;

  v_bare_host := regexp_replace(rtrim(lower(btrim(coalesce(p_panel_host, ''))), '/'), '^https?://', '');
  IF v_bare_host = 'dstreams.xyz' THEN
    v_bare_host := 'dstreams.xyz:8080';
  END IF;

  -- Proof of an actual panel sign-in on this line: the capture pipeline writes
  -- a player_signins row on every successful Xtream login.
  SELECT id INTO v_signin_id
  FROM public.player_signins
  WHERE panel_host = v_bare_host AND lower(panel_username) = v_username
  LIMIT 1;
  IF v_signin_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'signin_not_found');
  END IF;

  SELECT c.id INTO v_customer_id FROM public.customers c WHERE lower(c.email) = v_email LIMIT 1;
  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers (email, name, notes)
    VALUES (v_email, split_part(v_email, '@', 1), 'created via in-TV account claim')
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_customer_id;
    IF v_customer_id IS NULL THEN
      SELECT c.id INTO v_customer_id FROM public.customers c WHERE lower(c.email) = v_email LIMIT 1;
    END IF;
  END IF;

  PERFORM public.link_claimed_panel_line(
    v_customer_id, NULL, v_username, p_panel_host,
    p_server_label, p_expiration_date, p_max_connections, p_is_trial
  );

  RETURN jsonb_build_object('ok', true, 'email', v_email);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_account_manual(text,text,text,date,integer,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_account_manual(text,text,text,date,integer,boolean,text) TO anon, authenticated;