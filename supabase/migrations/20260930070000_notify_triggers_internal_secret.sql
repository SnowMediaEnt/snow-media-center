-- The notification triggers now prove they are the database.
--
-- notify-ticket and telegram-notify are verify_jwt = false and used to check
-- nothing: the only thing these triggers sent was the public anon key, which
-- anyone has. So anyone could post fake tickets and "Remote Access Request"
-- alerts to the Discord channels, the admin inbox and every admin's phone, and
-- fake outage alerts through the Telegram bot.
--
-- Each trigger below now also sends x-internal-secret, read from
-- private.fn_secret('INTERNAL_FN_SECRET') the way giveaway_notify_pending_entry
-- already does, and the two functions refuse any call without it. Nothing
-- else about the triggers changes; if the secret is missing the trigger skips
-- the call with a WARNING, and a notifier failure still never rolls back the
-- row that fired it.
--
-- ORDER: apply this migration BEFORE deploying the new notify-ticket and
-- telegram-notify. Deployed first, they would refuse the old triggers and the
-- alerts would stop without an error anywhere (the triggers only warn).
-- Check first that the secret is there (this prints true/false, never the
-- value):
--   select private.fn_secret('INTERNAL_FN_SECRET') is not null;
--
-- The bodies are the latest ones in this repo (20260716184655,
-- 20260804162806, 20260702195532, 20260703003456) plus the header. If a live
-- body has been changed by hand since, compare with
-- pg_get_functiondef('public.<name>()'::regprocedure) before applying. And
-- check nothing else in the database posts to either function (anything this
-- lists besides the four below would need the header too):
--   select proname from pg_proc
--    where prosrc ~ '(notify-ticket|telegram-notify)' order by 1;
-- Outside the database, the admin app's notify-admin also calls
-- telegram-notify and must send x-internal-secret before these deploy.

CREATE OR REPLACE FUNCTION public.notify_ticket_on_first_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/notify-ticket';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_sec text;
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
    v_sec := private.fn_secret('INTERNAL_FN_SECRET');
    IF v_sec IS NULL THEN
      RAISE WARNING 'notify-ticket skipped: INTERNAL_FN_SECRET missing from private.app_secrets';
      RETURN NEW;
    END IF;
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
        'Authorization', 'Bearer ' || v_anon,
        'x-internal-secret', v_sec
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notify-ticket dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_remote_support_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url   text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/notify-ticket';
  v_anon  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_sec   text;
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
    v_sec := private.fn_secret('INTERNAL_FN_SECRET');
    IF v_sec IS NULL THEN
      RAISE WARNING 'notify remote-support skipped: INTERNAL_FN_SECRET missing from private.app_secrets';
      RETURN NEW;
    END IF;
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
        'Authorization', 'Bearer ' || v_anon,
        'x-internal-secret', v_sec
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- NEVER roll back the customer's request because the notifier broke.
    RAISE WARNING 'notify remote-support dispatch failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_telegram_on_app_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/telegram-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_sec text;
BEGIN
  BEGIN
    v_sec := private.fn_secret('INTERNAL_FN_SECRET');
    IF v_sec IS NULL THEN
      RAISE WARNING 'telegram-notify skipped: INTERNAL_FN_SECRET missing from private.app_secrets';
      RETURN NEW;
    END IF;
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('record', to_jsonb(NEW)),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon,
        'x-internal-secret', v_sec
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'telegram-notify dispatch failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_telegram_on_app_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/telegram-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_sec text;
  v_rec jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.active = true AND NEW.active = false) THEN
      RETURN NEW;
    END IF;
    v_rec := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.active IS DISTINCT FROM true THEN
      RETURN OLD;
    END IF;
    v_rec := to_jsonb(OLD);
  ELSE
    RETURN NULL;
  END IF;

  BEGIN
    v_sec := private.fn_secret('INTERNAL_FN_SECRET');
    IF v_sec IS NULL THEN
      RAISE WARNING 'telegram-notify resolved skipped: INTERNAL_FN_SECRET missing from private.app_secrets';
    ELSE
      PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object('event', 'resolved', 'record', v_rec),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon,
          'x-internal-secret', v_sec
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'telegram-notify resolved dispatch failed: %', SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger functions only; nobody calls them by name. (The triggers themselves
-- are unchanged and keep firing: EXECUTE is checked when a trigger is
-- created, not each time it fires.)
REVOKE EXECUTE ON FUNCTION public.notify_ticket_on_first_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_on_remote_support_request() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_on_app_alert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_telegram_on_app_alert_resolved() FROM PUBLIC, anon, authenticated;
