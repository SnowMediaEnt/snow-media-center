DO $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.app_alerts (app_match, title, message, severity, active, source)
  VALUES ('__telegram_pipeline_test__', 'Telegram pipeline test', 'Verifying end-to-end delivery. Safe to ignore.', 'info', false, 'test')
  RETURNING id INTO v_id;
  DELETE FROM public.app_alerts WHERE id = v_id;
END $$;