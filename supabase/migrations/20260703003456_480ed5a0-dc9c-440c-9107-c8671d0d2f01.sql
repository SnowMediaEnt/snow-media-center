
CREATE OR REPLACE FUNCTION public.notify_telegram_on_app_alert_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/telegram-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
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
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('event', 'resolved', 'record', v_rec),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'telegram-notify resolved dispatch failed: %', SQLERRM;
  END;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_app_alerts_telegram_resolved_update ON public.app_alerts;
CREATE TRIGGER trg_app_alerts_telegram_resolved_update
AFTER UPDATE ON public.app_alerts
FOR EACH ROW
WHEN (OLD.active = true AND NEW.active = false)
EXECUTE FUNCTION public.notify_telegram_on_app_alert_resolved();

DROP TRIGGER IF EXISTS trg_app_alerts_telegram_resolved_delete ON public.app_alerts;
CREATE TRIGGER trg_app_alerts_telegram_resolved_delete
AFTER DELETE ON public.app_alerts
FOR EACH ROW
WHEN (OLD.active = true)
EXECUTE FUNCTION public.notify_telegram_on_app_alert_resolved();
