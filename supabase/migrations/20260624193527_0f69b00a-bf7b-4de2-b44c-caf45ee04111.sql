UPDATE ai_free_config SET chat_per_device_limit_usd = 0.50, chat_spent_usd = 0, images_used = 0, global_calls_this_hour = 0, global_images_this_hour = 0 WHERE id=1;
DELETE FROM ai_anon_usage WHERE device_id='smoke-test-1';
DELETE FROM ai_ip_usage WHERE ip_hash='662f55d4391ec143362d46fc0fb1da0a8a0420d61e04d69518a0562ef0478676';