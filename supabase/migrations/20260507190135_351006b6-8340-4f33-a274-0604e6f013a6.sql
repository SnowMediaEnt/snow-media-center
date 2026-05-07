
CREATE OR REPLACE FUNCTION public.update_ticket_on_message()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_conversations
  SET last_message_at = NEW.created_at, updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

CREATE OR REPLACE FUNCTION public.limit_ai_conversations()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SET search_path = '';
