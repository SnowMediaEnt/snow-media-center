
-- Allow users to manage their own customer row
CREATE POLICY "users insert own customer" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own customer" ON public.customers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Allow users to manage their own devices
CREATE POLICY "users insert own devices" ON public.customer_devices
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_devices.customer_id AND c.user_id = auth.uid()));

CREATE POLICY "users update own devices" ON public.customer_devices
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_devices.customer_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_devices.customer_id AND c.user_id = auth.uid()));

CREATE POLICY "users delete own devices" ON public.customer_devices
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_devices.customer_id AND c.user_id = auth.uid()));

-- Allow users to manage their own services
CREATE POLICY "users insert own services" ON public.customer_services
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_services.customer_id AND c.user_id = auth.uid()));

CREATE POLICY "users update own services" ON public.customer_services
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_services.customer_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_services.customer_id AND c.user_id = auth.uid()));

CREATE POLICY "users delete own services" ON public.customer_services
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_services.customer_id AND c.user_id = auth.uid()));

-- Track which apps a service is tied to so we can show a launch popup on those apps
ALTER TABLE public.customer_services
  ADD COLUMN IF NOT EXISTS tied_apps text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.customer_services
  ADD COLUMN IF NOT EXISTS service_name text;
