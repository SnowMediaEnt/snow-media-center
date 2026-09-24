-- A customer's new remote-support request always starts unpaid.
--
-- The insert policy only checked auth.uid() = user_id, so a signed-in customer
-- could insert their own row already 'paid' or 'comped' (with a made-up
-- order_number or comp stamp) and skip the $25 payment: the app resumes a
-- paid/comped row straight into setup, start_remote_support_session accepts
-- it, and the admin list shows it as paid.
--
-- Now a customer's insert must be exactly what the app sends: status
-- 'pending_payment' and none of the payment, comp, session or admin fields.
-- The app (RemoteSupport.tsx) and the Canvas app already insert that way.
-- Rows become paid or comped only through the service role (the checkout
-- webhook in giveaway-bridge), an admin, or the SECURITY DEFINER code
-- functions, none of which this touches.
--
-- The permissive policy is re-created with the check, and a RESTRICTIVE
-- policy adds the same check on top of any other INSERT policy the live
-- database may have under another name (policies are OR-ed; a restrictive one
-- is AND-ed with them). Admins are exempt from the restrictive one.
--
-- Do NOT apply 20260922060000_remote_support_codes.sql; this does not need it.

DROP POLICY IF EXISTS "Users can insert their own remote support requests" ON public.remote_support_requests;
CREATE POLICY "Users can insert their own remote support requests"
  ON public.remote_support_requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_payment'
    AND paid_at IS NULL
    AND order_number IS NULL
    AND session_started_at IS NULL
    AND comped_at IS NULL
    AND comped_by IS NULL
    AND admin_note IS NULL
  );

DROP POLICY IF EXISTS "New remote support requests start unpaid" ON public.remote_support_requests;
CREATE POLICY "New remote support requests start unpaid"
  ON public.remote_support_requests AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      status = 'pending_payment'
      AND paid_at IS NULL
      AND order_number IS NULL
      AND session_started_at IS NULL
      AND comped_at IS NULL
      AND comped_by IS NULL
      AND admin_note IS NULL
    )
  );
