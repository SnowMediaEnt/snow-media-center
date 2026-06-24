DO $$
DECLARE v_refund numeric;
BEGIN
  SELECT COALESCE(SUM(chat_cost_usd),0) INTO v_refund
    FROM public.ai_anon_usage
    WHERE device_id IN ('smoke-test-model-1','smoke-test-model-2','smoke-test-1');
  UPDATE public.ai_free_config
    SET chat_spent_usd = GREATEST(0, chat_spent_usd - v_refund),
        updated_at = now()
    WHERE id = 1;
END $$;
DELETE FROM public.ai_anon_usage WHERE device_id IN ('smoke-test-model-1','smoke-test-model-2','smoke-test-1');