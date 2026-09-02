-- Store display overrides — how products from the snowmediaent.com store are
-- presented inside the SMC TV app. Products themselves live in the STORE's
-- Supabase project (public `products` table, read via REST); this table only
-- carries per-product presentation edited from SMC Hub → Store.
CREATE TABLE public.store_display (
  product_slug  text PRIMARY KEY,
  -- Optional overrides; NULL = use the store's own value.
  title         text,
  blurb         text,
  badge         text,
  image_url     text,
  -- Which TV shelf the item sits on. NULL = derived from the store category.
  group_kind    text CHECK (group_kind IN ('device','service','accessory','digital')),
  sort          integer NOT NULL DEFAULT 0,
  hidden        boolean NOT NULL DEFAULT false,
  highlight     boolean NOT NULL DEFAULT false,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.store_display TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_display TO authenticated;
GRANT ALL ON public.store_display TO service_role;

ALTER TABLE public.store_display ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view store display"
  ON public.store_display FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert store display"
  ON public.store_display FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update store display"
  ON public.store_display FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete store display"
  ON public.store_display FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_store_display_updated_at
  BEFORE UPDATE ON public.store_display
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.store_display REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_display;
