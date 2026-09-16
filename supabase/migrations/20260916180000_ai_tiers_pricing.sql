-- AI tiers: final models and Snow Gem prices.
-- Chat premium on GPT-5.6 Terra (newer and cheaper than GPT-5.4; GPT-5.5 costs
-- Sol money without being Sol). Both image tiers on gpt-image-2: gpt-image-1
-- shuts down 2026-10-23. Free pictures keep coming from generate-hf-image
-- (Gemini via the Lovable gateway); that row is a label, not a route.
-- Prices leave ~45-60% after model cost.
INSERT INTO public.ai_tiers (feature, tier, model, gems, label, blurb, sort) VALUES
  ('chat',  'free',    'gpt-5.4-nano',  0.01, 'Snow AI',         'Quick answers, included with your gems',        0),
  ('chat',  'premium', 'gpt-5.6-terra', 0.50, 'Snow AI Premium', 'Sharper, deeper answers from a top model',      1),
  ('image', 'free',    'google/gemini-2.5-flash-image', 1.00, 'Standard', 'Good backgrounds in seconds',       0),
  ('image', 'premium', 'gpt-image-2',   4.00, 'Premium',         'Full-detail, photoreal backgrounds',            1)
ON CONFLICT (feature, tier) DO UPDATE SET
  model = EXCLUDED.model,
  gems = EXCLUDED.gems,
  label = EXCLUDED.label,
  blurb = EXCLUDED.blurb,
  sort = EXCLUDED.sort,
  updated_at = now();
