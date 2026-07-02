CREATE OR REPLACE FUNCTION public.notify_telegram_on_app_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_url text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/telegram-notify';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('record', to_jsonb(NEW)),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'telegram-notify dispatch failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;