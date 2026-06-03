SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'auto-knowledge-sync'),
  schedule := '0 * * * *'
);