DELETE FROM ai_anon_usage WHERE device_id LIKE 'ask-test-%';
UPDATE ai_free_config SET chat_spent_usd = GREATEST(0, chat_spent_usd - 0.05) WHERE id = 1;