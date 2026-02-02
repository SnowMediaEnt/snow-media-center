-- Fix SUPA_function_search_path_mutable: Add search_path to trigger functions
-- Fix for update_ticket_on_message function
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SET search_path = '';

-- Fix for update_conversation_on_message function
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_conversations 
  SET 
    last_message_at = NEW.created_at,
    updated_at = now()
  WHERE id = NEW.conversation_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Fix for limit_ai_conversations function
CREATE OR REPLACE FUNCTION public.limit_ai_conversations()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete old conversations if user has more than 5
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
$$ LANGUAGE plpgsql SET search_path = '';

-- Fix for update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Fix SUPA_rls_policy_always_true: Replace overly permissive INSERT policy on qr_login_sessions
-- The current policy allows anyone to insert, which is correct for QR login but should be more specific
DROP POLICY IF EXISTS "Allow inserting new QR sessions" ON public.qr_login_sessions;

-- Create a more secure policy - only allow inserting sessions where user_id is null (new sessions)
-- and is_used is false (not already used)
CREATE POLICY "Allow inserting new QR sessions"
ON public.qr_login_sessions
FOR INSERT
WITH CHECK (user_id IS NULL AND is_used = false);