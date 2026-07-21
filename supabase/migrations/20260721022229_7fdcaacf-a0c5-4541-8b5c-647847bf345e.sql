DO $$
BEGIN
  -- Remove exact duplicate (tenant_id, user_id) rows, keeping the oldest.
  DELETE FROM public.canvas_customers c
  USING public.canvas_customers c2
  WHERE c.tenant_id = c2.tenant_id
    AND c.user_id = c2.user_id
    AND c.user_id IS NOT NULL
    AND c.created_at > c2.created_at;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'canvas_customers_tenant_user_key'
      AND conrelid = 'public.canvas_customers'::regclass
  ) THEN
    ALTER TABLE public.canvas_customers
      ADD CONSTRAINT canvas_customers_tenant_user_key UNIQUE (tenant_id, user_id);
  END IF;
END $$;