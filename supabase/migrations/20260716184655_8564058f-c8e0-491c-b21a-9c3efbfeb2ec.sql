
-- Server-side ticket notification pipeline. Mirrors the app_alerts →
-- telegram-notify trigger pattern: a Postgres AFTER INSERT trigger uses
-- pg_net to POST a payload to a verify_jwt=false edge function.
--
-- Fires on support_messages (first message per ticket) rather than on
-- support_tickets so the payload has the full initial message preview —
-- ticket rows are inserted before their first message row, so a trigger
-- on support_tickets would see no message yet.

CREATE OR REPLACE FUNCTION public.notify_ticket_on_first_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/notify-ticket';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_ticket public.support_tickets%ROWTYPE;
  v_msg_count int;
  v_email text;
  v_source text;
BEGIN
  -- Only fire for the first user-sent message on a ticket.
  IF NEW.sender_type IS DISTINCT FROM 'user' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_msg_count
    FROM public.support_messages
   WHERE ticket_id = NEW.ticket_id;
  IF v_msg_count <> 1 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_ticket.user_id;

  IF lower(coalesce(v_email, '')) = 'player-reports@snowmediaapps.com' THEN
    v_source := 'player_report';
  ELSE
    v_source := 'ticket';
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'ticket_id', v_ticket.id,
        'subject', v_ticket.subject,
        'message_preview', left(NEW.message, 300),
        'source', v_source,
        'user_email', v_email,
        'created_at', v_ticket.created_at
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify-ticket dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_notify_ticket ON public.support_messages;
CREATE TRIGGER trg_support_messages_notify_ticket
AFTER INSERT ON public.support_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_on_first_message();
