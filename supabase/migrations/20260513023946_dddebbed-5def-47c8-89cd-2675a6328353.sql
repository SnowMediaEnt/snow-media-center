
-- 1. user_subscriptions: restrict writes to admin only, keep user SELECT
DROP POLICY IF EXISTS "Users can manage their own subscriptions" ON public.user_subscriptions;

CREATE POLICY "Admins can insert subscriptions"
  ON public.user_subscriptions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update subscriptions"
  ON public.user_subscriptions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete subscriptions"
  ON public.user_subscriptions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. media-assets storage: drop self-upload, admin-only INSERT remains
DROP POLICY IF EXISTS "Authenticated users upload own media-assets" ON storage.objects;

-- 3. Add search_path to trigger functions
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.support_tickets
  SET
    last_message_at = NEW.created_at,
    updated_at = now(),
    user_has_unread = CASE WHEN NEW.sender_type = 'admin' THEN true ELSE user_has_unread END,
    admin_has_unread = CASE WHEN NEW.sender_type = 'user' THEN true ELSE false END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.ai_conversations
  SET last_message_at = NEW.created_at, updated_at = now()
  WHERE conversation_id = NEW.conversation_id OR id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.limit_ai_conversations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM public.ai_conversations
  WHERE user_id = NEW.user_id
    AND id NOT IN (
      SELECT id FROM public.ai_conversations
      WHERE user_id = NEW.user_id
      ORDER BY last_message_at DESC
      LIMIT 5
    );
  RETURN NEW;
END;
$function$;

-- 4. Revoke anon EXECUTE on SECURITY DEFINER functions exposed via API
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.ai_tokens_last_hour() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_qr_session(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_profile_owner(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.backfill_customers_from_auth() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_qr_session(text) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_tokens_last_hour() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_qr_session(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_profile_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_customers_from_auth() TO authenticated;
-- get_qr_session is needed by polling QR page (anon) — keep accessible but via service role only
-- Actually QR polling is done from the desktop browser before login (anon). Re-grant to anon.
GRANT EXECUTE ON FUNCTION public.get_qr_session(text) TO anon, authenticated;
