-- Drop the partial unique index (Postgres ON CONFLICT requires a real UNIQUE constraint)
DROP INDEX IF EXISTS public.apps_external_id_unique;

-- Make sure no existing rows would violate the new constraint
-- (the legacy rows already have NULL external_id, NULLs are allowed in UNIQUE)
ALTER TABLE public.apps
  ADD CONSTRAINT apps_external_id_key UNIQUE (external_id);