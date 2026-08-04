CREATE TABLE public.remote_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issue text NOT NULL,
  needs text,
  contact text,
  status text NOT NULL DEFAULT 'pending_payment',
  device_model text,
  android_version text,
  paid_at timestamptz,
  order_number text,
  session_started_at timestamptz,
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT remote_support_requests_status_check CHECK (status IN ('pending_payment','paid','in_progress','done','cancelled'))
);

GRANT SELECT, INSERT, UPDATE ON public.remote_support_requests TO authenticated;
GRANT ALL ON public.remote_support_requests TO service_role;

ALTER TABLE public.remote_support_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own remote support requests"
  ON public.remote_support_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read their own remote support requests"
  ON public.remote_support_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can read all remote support requests"
  ON public.remote_support_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all remote support requests"
  ON public.remote_support_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_remote_support_requests_updated_at
  BEFORE UPDATE ON public.remote_support_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- User self-service transition: paid -> in_progress on their OWN row only.
-- This is the ONLY write a non-admin can make after insert, so a user can
-- never mark their own request paid.
CREATE OR REPLACE FUNCTION public.start_remote_support_session(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.remote_support_requests
  SET status = 'in_progress', session_started_at = now()
  WHERE id = p_id AND user_id = auth.uid() AND status = 'paid';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;