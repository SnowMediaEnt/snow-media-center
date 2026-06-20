
CREATE OR REPLACE FUNCTION public.grant_coins_on_gem_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- TUNE THIS: bonus Snow Coins granted per 1 Snow Gem purchased.
  COINS_PER_GEM CONSTANT integer := 1000;
  v_bonus integer;
BEGIN
  -- Strict filter: ONLY genuine money-for-Gems purchases.
  -- - transaction_type='purchase' (excludes 'deduction' AI spends and 'refund' chargebacks)
  -- - paypal_transaction_id IS NOT NULL (excludes admin/free/promo grants, which pass NULL)
  -- - positive amount (sanity)
  IF NEW.transaction_type <> 'purchase'
     OR NEW.paypal_transaction_id IS NULL
     OR NEW.amount IS NULL
     OR NEW.amount <= 0 THEN
    RETURN NEW;
  END IF;

  -- Double-grant guard: one bonus per credit_transactions row.
  -- The chip_ledger reason embeds this row id; if already present, skip.
  IF EXISTS (
    SELECT 1 FROM public.chip_ledger
    WHERE user_id = NEW.user_id
      AND reason = 'gem_purchase_bonus:' || NEW.id::text
  ) THEN
    RETURN NEW;
  END IF;

  v_bonus := floor(NEW.amount * COINS_PER_GEM)::integer;
  IF v_bonus <= 0 THEN
    RETURN NEW;
  END IF;

  PERFORM public.apply_chip_change(
    NEW.user_id,
    v_bonus,
    'gem_purchase_bonus:' || NEW.id::text,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_coins_on_gem_purchase ON public.credit_transactions;
CREATE TRIGGER trg_grant_coins_on_gem_purchase
AFTER INSERT ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public.grant_coins_on_gem_purchase();
