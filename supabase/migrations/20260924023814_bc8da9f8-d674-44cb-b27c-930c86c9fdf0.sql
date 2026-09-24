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
-- The same goes for a customer's later edits. The app re-saves the form on an
-- unpaid request (RemoteSupport.tsx), which needs the customer UPDATE policy
-- the live database has (not in these migrations; 20260804162806 says it is
-- pinned to 'pending_payment'). That policy does not stop the payment fields
-- themselves, so a customer could stamp paid_at and an order number on their
-- unpaid row and have the admin list show "Paid" and "Order #…". A BEFORE
-- UPDATE trigger now keeps status, payment, comp, session and admin fields as
-- they were on any direct write by a signed-in non-admin; what they wrote
-- (issue, needs, contact, device) still saves. current_user tells a direct
-- client write ('authenticated') from the SECURITY DEFINER functions
-- (start_remote_support_session, code redemption), which run as their owner,
-- and from the service role, so none of those change.
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

-- Not SECURITY DEFINER on purpose: current_user must stay the caller's role.
CREATE OR REPLACE FUNCTION public.remote_support_keep_payment_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_user = 'authenticated' AND NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.user_id            := OLD.user_id;
    NEW.status             := OLD.status;
    NEW.paid_at            := OLD.paid_at;
    NEW.order_number       := OLD.order_number;
    NEW.session_started_at := OLD.session_started_at;
    NEW.comped_at          := OLD.comped_at;
    NEW.comped_by          := OLD.comped_by;
    NEW.admin_note         := OLD.admin_note;
  END IF;
  RETURN NEW;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.remote_support_keep_payment_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_remote_support_keep_payment_fields ON public.remote_support_requests;
CREATE TRIGGER trg_remote_support_keep_payment_fields
  BEFORE UPDATE ON public.remote_support_requests
  FOR EACH ROW EXECUTE FUNCTION public.remote_support_keep_payment_fields();