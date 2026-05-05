CREATE TABLE public.processed_wix_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  order_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processed_wix_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read processed wix events" ON public.processed_wix_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.pending_credits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wix_order_id text NOT NULL,
  wix_order_number text,
  buyer_email text,
  credits numeric NOT NULL DEFAULT 0,
  raw_payload jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pending_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read pending credits" ON public.pending_credits
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update pending credits" ON public.pending_credits
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));