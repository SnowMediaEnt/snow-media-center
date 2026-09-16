-- Two levels of AI: the included one and a premium one paid in Snow Gems.
--
-- ai_tiers is the price list and model list, readable by the app so the
-- toggle can say what premium costs, editable by admins so a price or a
-- model changes without a build. The edge functions read it with the service
-- role and charge server-side, so the app can never skip a premium charge.
--
-- ai_premium_trials remembers the one free premium sample each account gets
-- per feature (the side-by-side "see the difference" run). Written only by
-- the functions.
CREATE TABLE IF NOT EXISTS public.ai_tiers (
  feature    text NOT NULL CHECK (feature IN ('chat','image')),
  tier       text NOT NULL CHECK (tier IN ('free','premium')),
  model      text NOT NULL,
  gems       numeric(10,2) NOT NULL DEFAULT 0 CHECK (gems >= 0),
  label      text NOT NULL,
  blurb      text,
  enabled    boolean NOT NULL DEFAULT true,
  sort       integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feature, tier)
);

INSERT INTO public.ai_tiers (feature, tier, model, gems, label, blurb, sort) VALUES
  ('chat',  'free',    'gpt-5.4-nano',  0.01, 'Snow AI',         'Quick answers, included with your gems',        0),
  ('chat',  'premium', 'gpt-5.6-terra', 0.50, 'Snow AI Premium', 'Sharper, deeper answers from a top model',      1),
  ('image', 'free',    'gpt-image-2',   1.00, 'Standard',        'Good backgrounds in seconds',                   0),
  ('image', 'premium', 'gpt-image-2',   4.00, 'Premium',         'Full-detail, photoreal backgrounds',            1)
ON CONFLICT (feature, tier) DO NOTHING;

ALTER TABLE public.ai_tiers ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_tiers TO anon, authenticated;
GRANT ALL ON public.ai_tiers TO service_role;

DROP POLICY IF EXISTS "ai_tiers public read" ON public.ai_tiers;
CREATE POLICY "ai_tiers public read" ON public.ai_tiers
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ai_tiers admin write" ON public.ai_tiers;
CREATE POLICY "ai_tiers admin write" ON public.ai_tiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
GRANT INSERT, UPDATE, DELETE ON public.ai_tiers TO authenticated;

CREATE TABLE IF NOT EXISTS public.ai_premium_trials (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature  text NOT NULL CHECK (feature IN ('chat','image')),
  used_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature)
);

ALTER TABLE public.ai_premium_trials ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_premium_trials TO authenticated;
GRANT ALL ON public.ai_premium_trials TO service_role;

DROP POLICY IF EXISTS "ai_premium_trials read own" ON public.ai_premium_trials;
CREATE POLICY "ai_premium_trials read own" ON public.ai_premium_trials
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
