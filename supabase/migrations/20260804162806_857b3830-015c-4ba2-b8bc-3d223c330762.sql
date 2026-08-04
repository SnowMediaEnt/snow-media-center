-- 1. Allow the new 'comped' status (admin-set only; the customer update policy
--    stays pinned to pending_payment on USING and WITH CHECK — unchanged).
ALTER TABLE public.remote_support_requests DROP CONSTRAINT remote_support_requests_status_check;
ALTER TABLE public.remote_support_requests
  ADD CONSTRAINT remote_support_requests_status_check
  CHECK (status = ANY (ARRAY['pending_payment'::text, 'paid'::text, 'comped'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text]));

-- 2. Audit trail for comped sessions (plain uuid, no auth.users FK per project rules).
ALTER TABLE public.remote_support_requests ADD COLUMN IF NOT EXISTS comped_at timestamptz;
ALTER TABLE public.remote_support_requests ADD COLUMN IF NOT EXISTS comped_by uuid;

-- 3. Session handoff: comped rows start exactly like paid rows.
CREATE OR REPLACE FUNCTION public.start_remote_support_session(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.remote_support_requests
  SET status = 'in_progress', session_started_at = now()
  WHERE id = p_id AND user_id = auth.uid() AND status IN ('paid', 'comped');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$function$;

-- 4. Notify the admin the moment a request is created (mirrors the
--    support_messages -> notify-ticket pg_net pattern). A new request is always
--    'pending_payment', so the message says so explicitly (comp candidate).
CREATE OR REPLACE FUNCTION public.notify_on_remote_support_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url   text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/notify-ticket';
  v_anon  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_label text;
  v_email text;
BEGIN
  SELECT NULLIF(p.full_name, ''), NULLIF(p.email, '')
    INTO v_label, v_email
    FROM public.profiles p
   WHERE p.user_id = NEW.user_id
   LIMIT 1;

  v_label := coalesce(v_label, v_email, 'User ' || left(NEW.user_id::text, 8));

  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'ticket_id', NEW.id,
        'subject', '[AWAITING PAYMENT] Remote Access: ' || left(NEW.issue, 120),
        'message_preview', left(
          'From: ' || v_label || E'\n' ||
          'Status: ' || NEW.status || ' — awaiting payment (use "Make it free" to comp)' || E'\n' ||
          'Needs: ' || coalesce(NEW.needs, '—') || E'\n' ||
          'Contact: ' || coalesce(NEW.contact, '—') || E'\n' ||
          'Device: ' || coalesce(NEW.device_model || ' / Android ' || NEW.android_version, '—'),
          300),
        'source', 'remote_support',
        'user_email', coalesce(v_email, v_label),
        'created_at', NEW.created_at
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- NEVER roll back the customer's request because the notifier broke.
    RAISE WARNING 'notify remote-support dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_remote_support_notify ON public.remote_support_requests;
CREATE TRIGGER trg_remote_support_notify
  AFTER INSERT ON public.remote_support_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_remote_support_request();