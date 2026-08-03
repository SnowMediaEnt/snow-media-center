-- 1. Extensions (pg_net already powers the telegram triggers; IF NOT EXISTS is harmless)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Wrapper the cron job runs. Reads CRON_REFRESH_SECRET from Supabase Vault at
--    runtime so no secret literal ever appears in a migration file. Skips
--    gracefully (NOTICE only) if the secret has not been vaulted yet.
CREATE OR REPLACE FUNCTION public.run_refresh_player_signins()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'CRON_REFRESH_SECRET'
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_secret IS NULL OR length(v_secret) = 0 THEN
    RAISE NOTICE 'CRON_REFRESH_SECRET missing from Vault — skipping refresh';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/refresh-player-signins',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_refresh_player_signins() FROM PUBLIC, anon, authenticated;

-- 3. Idempotent daily schedule at 15:00 UTC. The DO block swallows the
--    'job not found' error from cron.unschedule on first run.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-player-signins-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'refresh-player-signins-daily',
  '0 15 * * *',
  $$SELECT public.run_refresh_player_signins()$$
);