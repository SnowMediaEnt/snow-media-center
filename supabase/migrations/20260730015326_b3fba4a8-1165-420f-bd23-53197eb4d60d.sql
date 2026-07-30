CREATE TABLE public.demo_catalog_cache (
  id text PRIMARY KEY DEFAULT 'v1',
  payload jsonb NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.demo_catalog_cache TO service_role;
ALTER TABLE public.demo_catalog_cache ENABLE ROW LEVEL SECURITY;