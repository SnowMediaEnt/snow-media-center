CREATE OR REPLACE FUNCTION public.update_user_credits(
  p_user_id uuid,
  p_amount numeric,
  p_transaction_type text,
  p_description text,
  p_paypal_transaction_id text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_admin boolean := v_caller IS NOT NULL AND public.has_role(v_caller, 'admin');
BEGIN
  -- A negative amount turned a deduction into a top-up. Nothing to do for 0.
  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_amount = 0 THEN
    RETURN TRUE;
  END IF;

  -- Only allow a user to modify their own credits, or an admin.
  IF v_caller IS NOT NULL AND p_user_id IS DISTINCT FROM v_caller AND NOT v_admin THEN
    RAISE EXCEPTION 'Unauthorized: Cannot modify another user''s credits';
  END IF;

  -- A signed-in user (not an admin) can only spend. Purchases and refunds come
  -- from the server (service role: no auth.uid()) or an admin.
  IF v_caller IS NOT NULL AND NOT v_admin AND p_transaction_type IS DISTINCT FROM 'deduction' THEN
    RAISE EXCEPTION 'Only the server can add Snow Gems';
  END IF;

  IF p_transaction_type = 'purchase' OR p_transaction_type = 'refund' THEN
    UPDATE public.profiles
    SET credits = credits + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id;
  ELSIF p_transaction_type = 'deduction' THEN
    UPDATE public.profiles
    SET credits = credits - p_amount,
        total_spent = total_spent + p_amount,
        updated_at = now()
    WHERE user_id = p_user_id AND credits >= p_amount;

    IF NOT FOUND THEN
      RETURN FALSE;
    END IF;
  END IF;

  INSERT INTO public.credit_transactions (
    user_id, amount, transaction_type, description, paypal_transaction_id
  ) VALUES (
    p_user_id, p_amount, p_transaction_type, p_description, p_paypal_transaction_id
  );

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.update_user_credits(uuid, numeric, text, text, text) TO authenticated, service_role;

-- The balance columns keep their values on any direct write by a signed-in
-- non-admin; the rest of what they wrote (name, username, phone, email) still
-- saves. A direct insert starts at zero. current_user tells a client write
-- ('authenticated') from SECURITY DEFINER code and the service role.
-- Not SECURITY DEFINER on purpose: current_user must stay the caller's role.
CREATE OR REPLACE FUNCTION public.profiles_keep_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF current_user = 'authenticated' AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.credits     := 0;
      NEW.total_spent := 0;
    ELSE
      NEW.user_id     := OLD.user_id;
      NEW.credits     := OLD.credits;
      NEW.total_spent := OLD.total_spent;
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_keep_balance ON public.profiles;
CREATE TRIGGER profiles_keep_balance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_balance();