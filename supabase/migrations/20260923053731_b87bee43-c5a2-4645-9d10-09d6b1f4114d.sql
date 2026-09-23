ALTER TABLE public.seasonal_cache DROP COLUMN IF EXISTS building_at;
ALTER TABLE public.seasonal_cache ADD COLUMN building_at timestamptz;
GRANT ALL ON public.seasonal_cache TO service_role;
NOTIFY pgrst, 'reload schema';