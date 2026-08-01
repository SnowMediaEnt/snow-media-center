-- ============================================================
-- AUGUST SMC GIVEAWAY — schema, constraints, RLS, RPCs, triggers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.giveaways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  prize_description text,
  prize_image_url text,
  prize_value_usd numeric,
  included_service_description text,
  winner_count integer NOT NULL DEFAULT 3 CHECK (winner_count > 0),
  start_at timestamptz,
  end_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','paused','ended','drawn','announced')),
  rules_md text,
  announcement_md text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.giveaways TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.giveaways TO authenticated;
GRANT ALL ON public.giveaways TO service_role;

CREATE TABLE IF NOT EXISTS public.giveaway_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  user_id uuid,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN
    ('active_account','account_created','renewal','device_purchase',
     'facebook_review','facebook_engagement','admin_bonus')),
  entry_count integer NOT NULL DEFAULT 1 CHECK (entry_count > 0),
  status text NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid','pending','rejected','invalidated')),
  source_id text,
  source_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid,
  invalidated_at timestamptz,
  invalidation_reason text,
  CHECK (user_id IS NOT NULL OR customer_id IS NOT NULL
         OR coalesce(metadata->>'buyer_email','') <> '')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.giveaway_entries TO authenticated;
GRANT ALL ON public.giveaway_entries TO service_role;

CREATE TABLE IF NOT EXISTS public.giveaway_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid NOT NULL REFERENCES public.giveaways(id) ON DELETE CASCADE,
  entry_id uuid REFERENCES public.giveaway_entries(id),
  user_id uuid,
  customer_id uuid,
  draw_round integer NOT NULL DEFAULT 1,
  position integer NOT NULL,
  public_display_name text,
  status text NOT NULL DEFAULT 'selected'
    CHECK (status IN ('selected','verified','declined','unreachable','replaced')),
  prize_delivered_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  replaced_by uuid REFERENCES public.giveaway_winners(id),
  drawn_at timestamptz NOT NULL DEFAULT now(),
  drawn_by uuid,
  draw_seed text,
  draw_method text,
  announced boolean NOT NULL DEFAULT false
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.giveaway_winners TO authenticated;
GRANT ALL ON public.giveaway_winners TO service_role;

CREATE TABLE IF NOT EXISTS public.giveaway_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giveaway_id uuid REFERENCES public.giveaways(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  entry_id uuid,
  winner_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.giveaway_audit_log TO authenticated;
GRANT ALL ON public.giveaway_audit_log TO service_role;

-- Dedupe / anti-fraud unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_active_customer
  ON public.giveaway_entries (giveaway_id, customer_id)
  WHERE entry_type = 'active_account' AND customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_active_user
  ON public.giveaway_entries (giveaway_id, user_id)
  WHERE entry_type = 'active_account' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_account_created
  ON public.giveaway_entries (giveaway_id, user_id)
  WHERE entry_type = 'account_created' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_purchase_source
  ON public.giveaway_entries (giveaway_id, entry_type, source_id)
  WHERE entry_type IN ('renewal','device_purchase') AND source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_fb_claim
  ON public.giveaway_entries (giveaway_id, user_id)
  WHERE entry_type = 'facebook_review' AND status IN ('valid','pending') AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_fb_review_url
  ON public.giveaway_entries (giveaway_id, lower(trim(metadata->>'review_url')))
  WHERE entry_type = 'facebook_review' AND status IN ('valid','pending')
    AND coalesce(trim(metadata->>'review_url'),'') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ge_fb_profile
  ON public.giveaway_entries (giveaway_id, lower(trim(metadata->>'fb_profile')))
  WHERE entry_type = 'facebook_review' AND status IN ('valid','pending')
    AND coalesce(trim(metadata->>'fb_profile'),'') <> '';
CREATE INDEX IF NOT EXISTS idx_ge_giveaway_status ON public.giveaway_entries (giveaway_id, status);
CREATE INDEX IF NOT EXISTS idx_ge_user ON public.giveaway_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_ge_customer ON public.giveaway_entries (customer_id);
CREATE INDEX IF NOT EXISTS idx_ge_source ON public.giveaway_entries (source_id);

-- updated_at
CREATE OR REPLACE FUNCTION public.giveaway_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_giveaways_touch ON public.giveaways;
CREATE TRIGGER trg_giveaways_touch BEFORE UPDATE ON public.giveaways
  FOR EACH ROW EXECUTE FUNCTION public.giveaway_touch_updated_at();

-- RLS
ALTER TABLE public.giveaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_winners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.giveaway_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY giveaways_public_read ON public.giveaways
  FOR SELECT USING (status <> 'draft' OR public.has_role(auth.uid(),'admin'));
CREATE POLICY giveaways_admin_all ON public.giveaways
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY ge_own_read ON public.giveaway_entries
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.customers c
               WHERE c.id = giveaway_entries.customer_id AND c.user_id = auth.uid())
    OR public.has_role(auth.uid(),'admin'));
CREATE POLICY ge_admin_write ON public.giveaway_entries
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY gw_own_or_admin ON public.giveaway_winners
  FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY gw_admin_write ON public.giveaway_winners
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY gal_admin ON public.giveaway_audit_log
  FOR ALL USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Public winner announcement (no PII: display name only)
CREATE OR REPLACE VIEW public.giveaway_public_winners AS
  SELECT w.giveaway_id, w.position, w.public_display_name, w.drawn_at
  FROM public.giveaway_winners w
  JOIN public.giveaways g ON g.id = w.giveaway_id
  WHERE w.announced = true AND w.status IN ('selected','verified') AND g.status = 'announced';
GRANT SELECT ON public.giveaway_public_winners TO anon, authenticated;

-- Display-name helper (first name + last initial)
CREATE OR REPLACE FUNCTION public.giveaway_display_name(p_user uuid, p_customer uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  SELECT nullif(trim(name),'') INTO v_name FROM customers WHERE id = p_customer;
  IF v_name IS NULL THEN
    SELECT nullif(trim(full_name),'') INTO v_name FROM profiles WHERE user_id = p_user;
  END IF;
  IF v_name IS NULL THEN RETURN 'SMC Member'; END IF;
  RETURN split_part(v_name,' ',1) ||
         coalesce(' ' || left(nullif(split_part(v_name,' ',2),''),1) || '.','');
END $$;

-- Idempotent entry award (SERVICE-ROLE ONLY — revoked from clients below)
CREATE OR REPLACE FUNCTION public.giveaway_award_entry(
  p_giveaway_id uuid, p_user_id uuid, p_customer_id uuid,
  p_type text, p_count integer, p_source_id text, p_source_ref text,
  p_status text DEFAULT 'valid', p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO giveaway_entries
    (giveaway_id, user_id, customer_id, entry_type, entry_count, status,
     source_id, source_reference, metadata)
  VALUES (p_giveaway_id, p_user_id, p_customer_id, p_type, p_count, p_status,
          p_source_id, p_source_ref, coalesce(p_metadata,'{}'::jsonb))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN RETURN NULL;
END $$;

-- Activation backfill: every currently-active customer gets 1 base entry.
-- "Active" = the Hub dashboard rule: customer_services.expiration_date >= today.
CREATE OR REPLACE FUNCTION public.giveaway_backfill_active(p_giveaway_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer := 0; r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  FOR r IN
    SELECT DISTINCT c.id AS customer_id, c.user_id
    FROM customers c JOIN customer_services s ON s.customer_id = c.id
    WHERE s.expiration_date IS NOT NULL AND s.expiration_date >= CURRENT_DATE
  LOOP
    IF giveaway_award_entry(p_giveaway_id, r.user_id, r.customer_id,
        'active_account', 1, NULL, 'Active SMC service') IS NOT NULL THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  INSERT INTO giveaway_audit_log (giveaway_id, actor, action, details)
  VALUES (p_giveaway_id, auth.uid(), 'backfill_active', jsonb_build_object('awarded', v_count));
  RETURN v_count;
END $$;

-- New SMC account during an active giveaway -> 1 entry. Exception-swallowing:
-- signup must NEVER break because of the giveaway.
CREATE OR REPLACE FUNCTION public.giveaway_on_profile_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g_id uuid;
BEGIN
  SELECT id INTO g_id FROM giveaways
   WHERE status='active' AND now() BETWEEN coalesce(start_at,now()) AND coalesce(end_at,now())
   ORDER BY created_at DESC LIMIT 1;
  IF g_id IS NOT NULL THEN
    PERFORM giveaway_award_entry(g_id, NEW.user_id, NULL, 'account_created', 1, NULL, 'New SMC account');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_giveaway_profile_created ON public.profiles;
CREATE TRIGGER trg_giveaway_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.giveaway_on_profile_created();

-- Customer newly active mid-giveaway also gets the base entry (idempotent).
CREATE OR REPLACE FUNCTION public.giveaway_on_service_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g_id uuid; v_user uuid;
BEGIN
  IF NEW.expiration_date IS NULL OR NEW.expiration_date < CURRENT_DATE THEN RETURN NEW; END IF;
  SELECT id INTO g_id FROM giveaways
   WHERE status='active' AND now() BETWEEN coalesce(start_at,now()) AND coalesce(end_at,now())
   ORDER BY created_at DESC LIMIT 1;
  IF g_id IS NOT NULL THEN
    SELECT user_id INTO v_user FROM customers WHERE id = NEW.customer_id;
    PERFORM giveaway_award_entry(g_id, v_user, NEW.customer_id, 'active_account', 1, NULL, 'Active SMC service');
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_giveaway_service_active ON public.customer_services;
CREATE TRIGGER trg_giveaway_service_active
  AFTER INSERT OR UPDATE OF expiration_date ON public.customer_services
  FOR EACH ROW EXECUTE FUNCTION public.giveaway_on_service_active();

-- Refund/cancel invalidation (keeps audit history, never deletes)
CREATE OR REPLACE FUNCTION public.giveaway_invalidate_order(p_order_id text, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  UPDATE giveaway_entries
     SET status='invalidated', invalidated_at=now(),
         invalidation_reason=coalesce(p_reason,'order refunded')
   WHERE source_id = p_order_id AND status IN ('valid','pending');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    INSERT INTO giveaway_audit_log (giveaway_id, action, details)
    SELECT DISTINCT giveaway_id, 'order_refund_invalidation',
           jsonb_build_object('order_id', p_order_id, 'entries', v_n, 'reason', p_reason)
      FROM giveaway_entries WHERE source_id = p_order_id;
  END IF;
  RETURN v_n;
END $$;

-- Customer-facing summary (RPC used by SMC app + bridge)
CREATE OR REPLACE FUNCTION public.giveaway_my_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
DECLARE g record; v_entries jsonb; v_total integer;
BEGIN
  SELECT * INTO g FROM giveaways
   WHERE status IN ('active','paused','ended','drawn','announced')
   ORDER BY (status='active') DESC, created_at DESC LIMIT 1;
  IF g.id IS NULL THEN RETURN jsonb_build_object('giveaway', NULL); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'entry_type', e.entry_type, 'entry_count', e.entry_count,
           'status', e.status, 'source_reference', e.source_reference,
           'created_at', e.created_at) ORDER BY e.created_at), '[]'::jsonb),
         coalesce(sum(e.entry_count) FILTER (WHERE e.status='valid'),0)
    INTO v_entries, v_total
    FROM giveaway_entries e
   WHERE e.giveaway_id = g.id
     AND (e.user_id = auth.uid() OR e.customer_id IN
          (SELECT id FROM customers WHERE user_id = auth.uid()));
  RETURN jsonb_build_object(
    'giveaway', jsonb_build_object('id',g.id,'slug',g.slug,'name',g.name,
      'description',g.description,'prize_description',g.prize_description,
      'prize_image_url',g.prize_image_url,'winner_count',g.winner_count,
      'included_service_description',g.included_service_description,
      'start_at',g.start_at,'end_at',g.end_at,'status',g.status,
      'rules_md',g.rules_md,'announcement_md',g.announcement_md),
    'my_total_valid', v_total, 'my_entries', v_entries);
END $$;

-- Weighted, seeded, auditable draw. Excludes anyone previously drawn (any status).
CREATE OR REPLACE FUNCTION public.giveaway_draw_winners(
  p_giveaway_id uuid, p_count integer, p_seed text DEFAULT NULL)
RETURNS SETOF public.giveaway_winners
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seed text; v_round integer; v_pos integer; r record;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  v_seed := coalesce(nullif(trim(p_seed),''), md5(clock_timestamp()::text || random()::text));
  SELECT coalesce(max(draw_round),0)+1 INTO v_round FROM giveaway_winners WHERE giveaway_id=p_giveaway_id;
  SELECT coalesce(max(position),0) INTO v_pos FROM giveaway_winners WHERE giveaway_id=p_giveaway_id;
  FOR r IN
    WITH tickets AS (
      SELECT e.id AS entry_id, e.user_id, e.customer_id,
             md5(v_seed || e.id::text || '#' || t.n::text) AS h
      FROM giveaway_entries e
      CROSS JOIN LATERAL generate_series(1, e.entry_count) AS t(n)
      WHERE e.giveaway_id = p_giveaway_id AND e.status = 'valid'
        AND (e.user_id IS NOT NULL OR e.customer_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM giveaway_winners w
              WHERE w.giveaway_id = p_giveaway_id
                AND ((w.user_id IS NOT NULL AND w.user_id = e.user_id)
                  OR (w.customer_id IS NOT NULL AND w.customer_id = e.customer_id)))
    ), ranked AS (
      SELECT DISTINCT ON (coalesce(customer_id::text, user_id::text)) *
      FROM tickets ORDER BY coalesce(customer_id::text, user_id::text), h
    )
    SELECT * FROM ranked ORDER BY h LIMIT p_count
  LOOP
    v_pos := v_pos + 1;
    RETURN QUERY
    INSERT INTO giveaway_winners
      (giveaway_id, entry_id, user_id, customer_id, draw_round, position,
       drawn_by, draw_seed, draw_method, public_display_name)
    VALUES (p_giveaway_id, r.entry_id, r.user_id, r.customer_id, v_round, v_pos,
       auth.uid(), v_seed, 'md5(seed||entry_id||ticket_n) ascending, weighted by entry_count',
       giveaway_display_name(r.user_id, r.customer_id))
    RETURNING *;
  END LOOP;
  INSERT INTO giveaway_audit_log (giveaway_id, actor, action, details)
  VALUES (p_giveaway_id, auth.uid(), 'draw_winners',
          jsonb_build_object('round', v_round, 'requested', p_count, 'seed', v_seed));
END $$;

-- Facebook claim (authenticated users; called from SMC app rpc + bridge)
CREATE OR REPLACE FUNCTION public.giveaway_claim_facebook(
  p_giveaway_id uuid, p_fb_name text, p_review_url text, p_screenshot_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; v_id uuid; v_customer uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_signed_in'); END IF;
  SELECT * INTO g FROM giveaways WHERE id = p_giveaway_id;
  IF g.id IS NULL OR g.status <> 'active'
     OR now() NOT BETWEEN coalesce(g.start_at,now()) AND coalesce(g.end_at,now()) THEN
    RETURN jsonb_build_object('ok',false,'error','giveaway_not_active');
  END IF;
  IF coalesce(trim(p_fb_name),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'error','missing_name');
  END IF;
  SELECT id INTO v_customer FROM customers WHERE user_id = auth.uid() LIMIT 1;
  BEGIN
    INSERT INTO giveaway_entries
      (giveaway_id, user_id, customer_id, entry_type, entry_count, status, metadata)
    VALUES (p_giveaway_id, auth.uid(), v_customer, 'facebook_review', 1, 'pending',
            jsonb_build_object('fb_profile', trim(p_fb_name),
                               'review_url', coalesce(trim(p_review_url),''),
                               'screenshot_url', coalesce(trim(p_screenshot_url),'')))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','already_claimed');
  END;
  INSERT INTO giveaway_audit_log (giveaway_id, actor, action, entry_id, details)
  VALUES (p_giveaway_id, auth.uid(), 'facebook_claim_submitted', v_id,
          jsonb_build_object('fb_profile', trim(p_fb_name)));
  RETURN jsonb_build_object('ok',true,'entry_id',v_id,'status','pending');
END $$;

-- Admin approve/reject of pending claims
CREATE OR REPLACE FUNCTION public.giveaway_review_entry(
  p_entry_id uuid, p_approve boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO e FROM giveaway_entries WHERE id = p_entry_id;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  IF e.status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','not_pending'); END IF;
  UPDATE giveaway_entries SET
    status = CASE WHEN p_approve THEN 'valid' ELSE 'rejected' END,
    approved_at = CASE WHEN p_approve THEN now() ELSE NULL END,
    approved_by = CASE WHEN p_approve THEN auth.uid() ELSE approved_by END,
    invalidated_at = CASE WHEN p_approve THEN NULL ELSE now() END,
    invalidation_reason = CASE WHEN p_approve THEN NULL ELSE coalesce(p_reason,'rejected by admin') END
  WHERE id = p_entry_id;
  INSERT INTO giveaway_audit_log (giveaway_id, actor, action, entry_id, details)
  VALUES (e.giveaway_id, auth.uid(),
          CASE WHEN p_approve THEN 'entry_approved' ELSE 'entry_rejected' END,
          p_entry_id, jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok',true);
END $$;

-- Admin invalidation with required reason
CREATE OR REPLACE FUNCTION public.giveaway_invalidate_entry(p_entry_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e record;
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'error','reason_required');
  END IF;
  SELECT * INTO e FROM giveaway_entries WHERE id = p_entry_id;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  UPDATE giveaway_entries
     SET status='invalidated', invalidated_at=now(), invalidation_reason=trim(p_reason)
   WHERE id = p_entry_id;
  INSERT INTO giveaway_audit_log (giveaway_id, actor, action, entry_id, details)
  VALUES (e.giveaway_id, auth.uid(), 'entry_invalidated', p_entry_id,
          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok',true);
END $$;

-- Admin dashboard overview
CREATE OR REPLACE FUNCTION public.giveaway_admin_overview(p_giveaway_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'admin only'; END IF;
  RETURN (
    SELECT jsonb_build_object(
      'participants', count(DISTINCT coalesce(customer_id::text, user_id::text)) FILTER (WHERE status='valid'),
      'total_valid', coalesce(sum(entry_count) FILTER (WHERE status='valid'),0),
      'total_pending', count(*) FILTER (WHERE status='pending'),
      'total_rejected', count(*) FILTER (WHERE status='rejected'),
      'total_invalidated', count(*) FILTER (WHERE status='invalidated'),
      'by_type', (SELECT coalesce(jsonb_object_agg(t.entry_type, t.agg),'{}'::jsonb) FROM (
          SELECT entry_type, jsonb_build_object(
            'valid', coalesce(sum(entry_count) FILTER (WHERE status='valid'),0),
            'pending', count(*) FILTER (WHERE status='pending'),
            'invalidated', count(*) FILTER (WHERE status='invalidated')) AS agg
          FROM giveaway_entries WHERE giveaway_id=p_giveaway_id GROUP BY entry_type) t),
      'daily', (SELECT coalesce(jsonb_agg(d ORDER BY d->>'day'),'[]'::jsonb) FROM (
          SELECT jsonb_build_object('day', date_trunc('day',created_at)::date,
                 'entries', count(*), 'weight', sum(entry_count)) AS d
          FROM giveaway_entries WHERE giveaway_id=p_giveaway_id
          GROUP BY date_trunc('day',created_at)) x))
    FROM giveaway_entries WHERE giveaway_id=p_giveaway_id);
END $$;

-- Lock down who can call what:
REVOKE EXECUTE ON FUNCTION public.giveaway_award_entry(uuid,uuid,uuid,text,integer,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.giveaway_invalidate_order(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_backfill_active(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_my_summary() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.giveaway_claim_facebook(uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_review_entry(uuid,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_invalidate_entry(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_draw_winners(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_admin_overview(uuid) TO authenticated;

-- Admin notify: new pending Facebook entry -> giveaway-bridge via pg_net
-- (mirrors the app_alerts -> telegram-notify pattern; secret from private vault,
-- exception-swallowing so an entry insert can never fail because of notify).
CREATE OR REPLACE FUNCTION public.giveaway_notify_pending_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url  text := 'https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/giveaway-bridge';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';
  v_sec  text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'pending'
     OR NEW.entry_type NOT IN ('facebook_review','facebook_engagement') THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_sec := private.fn_secret('INTERNAL_FN_SECRET');
    IF v_sec IS NULL THEN
      RAISE WARNING 'giveaway notify skipped: INTERNAL_FN_SECRET missing from private.app_secrets';
      RETURN NEW;
    END IF;
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'admin-notify', 'entry_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon,
        'x-internal-secret', v_sec
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'giveaway-bridge dispatch failed: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_giveaway_pending_notify ON public.giveaway_entries;
CREATE TRIGGER trg_giveaway_pending_notify
  AFTER INSERT ON public.giveaway_entries
  FOR EACH ROW EXECUTE FUNCTION public.giveaway_notify_pending_entry();

-- Feature flag for remote on/off in the app (no APK release needed)
INSERT INTO public.feature_flags (key, enabled) VALUES ('giveaway_enabled', true)
ON CONFLICT (key) DO NOTHING;

-- Seed the August giveaway as DRAFT (admin activates it from the Hub)
INSERT INTO public.giveaways
  (slug, name, description, prize_description, winner_count,
   included_service_description, start_at, end_at, status, config)
VALUES
  ('august-2026', 'August SMC Giveaway',
   'Three winners each get a free X96 M200 streaming device plus one year of service.',
   'X96 M200 streaming device + 1 year of service (3 winners)', 3,
   '1 year of Snow Media service (admin will set exact service details)',
   '2026-08-01T00:00:00-07:00', '2026-08-31T23:59:59-07:00', 'draft',
   '{"purchase_rules":[
      {"patterns":["renew","subscription","month","service","stream","iptv"],"entry_type":"renewal","entries":1},
      {"patterns":["x96","device","box","onn","stick","fire"],"entry_type":"device_purchase","entries":2}],
     "excluded_buyer_emails":[]}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- END OF MIGRATION