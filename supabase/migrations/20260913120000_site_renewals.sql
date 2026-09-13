-- One row per paid renewal the website reports (giveaway-bridge action
-- 'renewal-paid'). The order number is the idempotency key: the website's
-- notification is fire-and-forget and may be delivered more than once, and
-- a renewal that reaches WHMCS twice would extend the line twice.
CREATE TABLE IF NOT EXISTS public.site_renewals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text NOT NULL UNIQUE,
  username         text NOT NULL,
  server           text,
  total            numeric(10,2) NOT NULL DEFAULT 0,
  months           integer,
  connections      integer,
  customer_id      uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  hub_service_id   uuid REFERENCES public.customer_services(id) ON DELETE SET NULL,
  whmcs_service_id integer,
  -- received: recorded, nothing done yet · extended: panel + billing moved
  -- manual: needs a human (not in WHMCS, unknown term, Vibez) · failed: WHMCS refused
  status           text NOT NULL DEFAULT 'received',
  detail           text,
  new_expiry       date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_renewals_username_idx ON public.site_renewals (lower(username));
CREATE INDEX IF NOT EXISTS site_renewals_status_idx   ON public.site_renewals (status, created_at DESC);

ALTER TABLE public.site_renewals ENABLE ROW LEVEL SECURITY;
-- Written by the edge function (service role). Admins may read it in the hub.
DROP POLICY IF EXISTS "site_renewals admin read" ON public.site_renewals;
CREATE POLICY "site_renewals admin read" ON public.site_renewals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
