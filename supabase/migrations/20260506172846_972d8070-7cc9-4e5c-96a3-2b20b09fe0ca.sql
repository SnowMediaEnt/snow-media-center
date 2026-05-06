
-- 1. Fix qr_login_sessions: stop public enumeration; expose lookup via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Allow reading sessions by specific token" ON public.qr_login_sessions;

CREATE POLICY "Authenticated users read own QR sessions"
ON public.qr_login_sessions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_qr_session(p_token text)
RETURNS TABLE (
  id uuid,
  token text,
  user_id uuid,
  is_used boolean,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id, token, user_id, is_used, expires_at, created_at
  FROM public.qr_login_sessions
  WHERE token = p_token
    AND expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_qr_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qr_session(text) TO anon, authenticated;

-- 2. Storage: remove anonymous upload to media-assets
DROP POLICY IF EXISTS "Anyone can upload to media-assets bucket" ON storage.objects;

CREATE POLICY "Authenticated users upload own media-assets"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'media-assets'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- 3. Profiles: remove redundant overlapping policies; keep simple owner-scoped ones
DROP POLICY IF EXISTS "Secure profile access" ON public.profiles;

-- 4. user_roles: prevent privilege escalation by explicitly restricting writes to admins
CREATE POLICY "Admins can insert user_roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update user_roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete user_roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 5. community_messages: require authentication to read (no public correlation)
DROP POLICY IF EXISTS "Anyone can view community messages" ON public.community_messages;

CREATE POLICY "Authenticated users can view community messages"
ON public.community_messages
FOR SELECT
TO authenticated
USING (true);

-- 6. Trigger functions: add SET search_path = '' for defense in depth
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.support_tickets 
  SET 
    last_message_at = NEW.created_at,
    updated_at = now(),
    user_has_unread = CASE 
      WHEN NEW.sender_type = 'admin' THEN true 
      ELSE user_has_unread 
    END,
    admin_has_unread = CASE 
      WHEN NEW.sender_type = 'user' THEN true 
      ELSE false 
    END
  WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.ai_conversations 
  SET 
    last_message_at = NEW.created_at,
    updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.limit_ai_conversations()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
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
