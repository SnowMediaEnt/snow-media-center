CREATE TABLE public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  label text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

GRANT SELECT, INSERT, DELETE ON public.web_push_subscriptions TO authenticated;
GRANT ALL ON public.web_push_subscriptions TO service_role;

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscriptions"
  ON public.web_push_subscriptions FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all subscriptions"
  ON public.web_push_subscriptions FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete any subscription"
  ON public.web_push_subscriptions FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_web_push_subscriptions_user_id ON public.web_push_subscriptions(user_id);