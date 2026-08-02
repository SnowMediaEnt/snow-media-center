CREATE TABLE public.expiration_notices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  panel_host text NOT NULL,
  panel_username text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('expiring', 'expired', 'renewed')),
  expiration_date date,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (panel_host, panel_username, kind, expiration_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expiration_notices TO authenticated;
GRANT ALL ON public.expiration_notices TO service_role;

ALTER TABLE public.expiration_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage expiration notices"
ON public.expiration_notices
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));