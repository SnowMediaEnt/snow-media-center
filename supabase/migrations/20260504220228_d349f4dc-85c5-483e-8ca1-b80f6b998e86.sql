
CREATE TABLE public.wix_redeemed_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  wix_order_id text NOT NULL UNIQUE,
  wix_order_number text,
  credits_granted numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_wix_redeemed_orders_user ON public.wix_redeemed_orders(user_id);

ALTER TABLE public.wix_redeemed_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own redeemed orders"
ON public.wix_redeemed_orders
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
