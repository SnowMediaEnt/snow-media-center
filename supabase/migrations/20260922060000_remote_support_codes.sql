-- Free-session codes for Remote Access.
--
-- An admin makes a code in the Admin Hub (Remote Access section): how many
-- times it may be used, when it expires, a note. A customer types it on the
-- payment step in the app and the request is comped on the spot, exactly as
-- if the admin had pressed "Make it free". Nothing about a code lives in the
-- app: the only thing the APK can do is ask this function whether a code is
-- good, and the function decides.

CREATE TABLE public.remote_support_codes (
  -- Stored normalised: upper case, letters and digits only. The function
  -- normalises what the customer typed the same way, so "abc-123" matches.
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{4,32}$'),
  note text,
  max_uses int NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses int NOT NULL DEFAULT 0,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.remote_support_codes TO authenticated;
GRANT ALL ON public.remote_support_codes TO service_role;
ALTER TABLE public.remote_support_codes ENABLE ROW LEVEL SECURITY;

-- Admins manage codes; customers never read the table, they only redeem.
CREATE POLICY "Admins manage remote support codes"
  ON public.remote_support_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Every redeem attempt, so a customer cannot guess codes by volume and an
-- admin can see who used what.
CREATE TABLE public.remote_support_code_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  request_id uuid,
  code text NOT NULL,
  ok boolean NOT NULL,
  reason text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX remote_support_code_attempts_user_idx
  ON public.remote_support_code_attempts (user_id, attempted_at DESC);
GRANT SELECT ON public.remote_support_code_attempts TO authenticated;
GRANT ALL ON public.remote_support_code_attempts TO service_role;
ALTER TABLE public.remote_support_code_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read code attempts"
  ON public.remote_support_code_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- The customer's side. Comps THEIR OWN pending request when the code is good.
-- Returns json {ok: true} or {ok: false, reason: <why>}; reasons:
--   signed_out · too_many · invalid · expired · used_up · no_request
CREATE OR REPLACE FUNCTION public.redeem_remote_support_code(p_request_id uuid, p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row public.remote_support_codes%ROWTYPE;
  v_failed int;
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'signed_out');
  END IF;

  -- Eight wrong codes in fifteen minutes is someone guessing, not typing.
  SELECT count(*) INTO v_failed
  FROM public.remote_support_code_attempts
  WHERE user_id = v_uid AND NOT ok AND attempted_at > now() - interval '15 minutes';
  IF v_failed >= 8 THEN
    INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok, reason)
    VALUES (v_uid, p_request_id, left(v_code, 32), false, 'too_many');
    RETURN json_build_object('ok', false, 'reason', 'too_many');
  END IF;

  SELECT * INTO v_row FROM public.remote_support_codes WHERE code = v_code FOR UPDATE;

  IF NOT FOUND OR NOT v_row.active THEN
    INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok, reason)
    VALUES (v_uid, p_request_id, left(v_code, 32), false, 'invalid');
    RETURN json_build_object('ok', false, 'reason', 'invalid');
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok, reason)
    VALUES (v_uid, p_request_id, v_code, false, 'expired');
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_row.uses >= v_row.max_uses THEN
    INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok, reason)
    VALUES (v_uid, p_request_id, v_code, false, 'used_up');
    RETURN json_build_object('ok', false, 'reason', 'used_up');
  END IF;

  -- Their own request, still waiting for payment. Same columns "Make it
  -- free" stamps, so the admin list reads the same; comped_by stays null and
  -- the note says which code did it.
  UPDATE public.remote_support_requests
  SET status = 'comped',
      comped_at = now(),
      admin_note = concat_ws(E'\n', nullif(admin_note, ''), 'Free with code ' || v_code)
  WHERE id = p_request_id AND user_id = v_uid AND status = 'pending_payment';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok, reason)
    VALUES (v_uid, p_request_id, v_code, false, 'no_request');
    RETURN json_build_object('ok', false, 'reason', 'no_request');
  END IF;

  UPDATE public.remote_support_codes
  SET uses = uses + 1, last_used_at = now()
  WHERE code = v_code;

  INSERT INTO public.remote_support_code_attempts (user_id, request_id, code, ok)
  VALUES (v_uid, p_request_id, v_code, true);

  RETURN json_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_remote_support_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_remote_support_code(uuid, text) TO authenticated;
