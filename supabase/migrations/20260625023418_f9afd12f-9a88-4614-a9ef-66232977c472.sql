UPDATE ai_ip_usage SET calls_this_hour = 0, images_this_hour = 0, chat_cost_usd = 0 WHERE hour_bucket = date_trunc('hour', now());
UPDATE ai_free_config SET global_calls_this_hour = 0 WHERE id = 1;