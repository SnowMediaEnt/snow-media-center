-- Snow Gems bought from the TV.
--
-- Gems are never sold on the website itself. The Dashboard's Snow Gems store
-- writes one of these rows, shows a QR code that opens a private page on
-- snowmediaent.com carrying the row's id, the phone pays there, and the
-- website tells giveaway-bridge (action 'gems-paid'), which flips the row to
-- paid and credits the profile through update_user_credits. The app polls
-- its own row and shows the gems the moment they land.
--
-- The row is the idempotency key: the website's notification may arrive more
-- than once, and gems credited twice are money given away.
CREATE TABLE IF NOT EXISTS public.gem_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  package_id            uuid REFERENCES public.credit_packages(id) ON DELETE SET NULL,
  package_name          text NOT NULL,
  credits               numeric(10,2) NOT NULL CHECK (credits > 0),
  price                 numeric(10,2) NOT NULL CHECK (price >= 0),
  -- pending_payment: QR shown, nothing paid · paid: credited
  -- review: paid, but the amount did not match the package — a human looks
  -- cancelled: the viewer backed out or the QR went stale
  status                text NOT NULL DEFAULT 'pending_payment'
                        CHECK (status IN ('pending_payment','paid','review','cancelled')),
  order_number          text,
  paypal_transaction_id text,
  paid_total            numeric(10,2),
  paid_at               timestamptz,
  credited_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gem_orders_user_idx   ON public.gem_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gem_orders_status_idx ON public.gem_orders (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS gem_orders_order_number_idx
  ON public.gem_orders (order_number) WHERE order_number IS NOT NULL;

GRANT SELECT, INSERT ON public.gem_orders TO authenticated;
GRANT ALL ON public.gem_orders TO service_role;

ALTER TABLE public.gem_orders ENABLE ROW LEVEL SECURITY;

-- The viewer opens their own order, and only ever as pending: paid, review
-- and cancelled are written by the bridge (service role), never by a client.
DROP POLICY IF EXISTS "gem_orders insert own pending" ON public.gem_orders;
CREATE POLICY "gem_orders insert own pending" ON public.gem_orders
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending_payment');

DROP POLICY IF EXISTS "gem_orders read own" ON public.gem_orders;
CREATE POLICY "gem_orders read own" ON public.gem_orders
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "gem_orders admin read" ON public.gem_orders;
CREATE POLICY "gem_orders admin read" ON public.gem_orders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS update_gem_orders_updated_at ON public.gem_orders;
CREATE TRIGGER update_gem_orders_updated_at
  BEFORE UPDATE ON public.gem_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
