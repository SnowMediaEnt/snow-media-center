DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.credit_transactions;

DROP POLICY IF EXISTS "Allow updating sessions for authentication" ON public.qr_login_sessions;

CREATE OR REPLACE FUNCTION public.claim_qr_session(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.qr_login_sessions
     SET user_id = v_uid,
         is_used = true
   WHERE token = p_token
     AND is_used = false
     AND expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_qr_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_qr_session(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_qr_session(text) TO authenticated;

DROP POLICY IF EXISTS "Users can update their own media assets" ON public.media_assets;
CREATE POLICY "Users can update their own media assets"
ON public.media_assets
FOR UPDATE
TO authenticated
USING (auth.uid() = uploaded_by)
WITH CHECK (
  auth.uid() = uploaded_by
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR is_active = false
  )
);

DROP POLICY IF EXISTS "Users can insert their own media assets" ON public.media_assets;
CREATE POLICY "Users can insert their own media assets"
ON public.media_assets
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = uploaded_by
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR is_active = false
  )
);

REVOKE EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.ai_tokens_last_hour() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ai_tokens_last_hour() FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_tokens_last_hour() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.backfill_customers_from_auth() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.backfill_customers_from_auth() FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_customers_from_auth() TO authenticated;