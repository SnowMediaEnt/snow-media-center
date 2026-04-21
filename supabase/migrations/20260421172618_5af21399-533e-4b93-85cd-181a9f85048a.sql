-- Add columns needed for syncing apps from snowmediaapps.com/apps/apps.json.php
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

-- Unique index so the sync function can upsert on filename
CREATE UNIQUE INDEX IF NOT EXISTS apps_external_id_unique
  ON public.apps (external_id)
  WHERE external_id IS NOT NULL;

-- Helpful index for the Featured tab query
CREATE INDEX IF NOT EXISTS apps_featured_available_idx
  ON public.apps (is_featured, is_available)
  WHERE is_available = true;

-- Mark the existing 8 broken rows as legacy + unavailable so the UI hides them
-- and the sync function can insert fresh rows without conflict.
UPDATE public.apps
SET is_available = false,
    source = 'legacy'
WHERE external_id IS NULL;

-- Updated-at trigger (uses the existing public.update_updated_at_column function)
DROP TRIGGER IF EXISTS apps_set_updated_at ON public.apps;
CREATE TRIGGER apps_set_updated_at
BEFORE UPDATE ON public.apps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();