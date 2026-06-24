DO $$
DECLARE refund numeric;
BEGIN
  SELECT COALESCE(SUM(chat_cost_usd),0) INTO refund FROM public.ai_anon_usage WHERE device_id LIKE 'lang%';
  DELETE FROM public.ai_anon_usage WHERE device_id LIKE 'lang%';
  UPDATE public.ai_free_config SET chat_spent_usd = GREATEST(0, COALESCE(chat_spent_usd,0) - refund);
END $$;