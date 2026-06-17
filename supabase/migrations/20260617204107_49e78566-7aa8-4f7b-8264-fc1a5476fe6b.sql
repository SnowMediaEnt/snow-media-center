ALTER TABLE public.customer_services
  ADD COLUMN IF NOT EXISTS panel_password text,
  ADD COLUMN IF NOT EXISTS panel_host text,
  ADD COLUMN IF NOT EXISTS max_connections integer,
  ADD COLUMN IF NOT EXISTS is_trial boolean;