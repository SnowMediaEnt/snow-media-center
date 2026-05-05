
-- AI usage log: every chat + image-gen request, admin-visible
CREATE TABLE public.ai_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  user_email TEXT,
  feature TEXT NOT NULL,        -- 'chat' | 'image'
  model TEXT,
  prompt TEXT,
  response_preview TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_credits NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok', -- 'ok' | 'error' | 'blocked'
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_log_created ON public.ai_usage_log (created_at DESC);
CREATE INDEX idx_ai_usage_log_user ON public.ai_usage_log (user_id, created_at DESC);
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all AI usage logs"
  ON public.ai_usage_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- AI safety state: single row, governs platform pause
CREATE TABLE public.ai_safety_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  paused BOOLEAN NOT NULL DEFAULT false,
  pause_reason TEXT,
  paused_at TIMESTAMP WITH TIME ZONE,
  paused_until TIMESTAMP WITH TIME ZONE,
  token_threshold_per_hour BIGINT NOT NULL DEFAULT 2000000,
  notify_email TEXT NOT NULL DEFAULT 'Joshua.perez@snowmediaent.com',
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
INSERT INTO public.ai_safety_state (id) VALUES (1);
ALTER TABLE public.ai_safety_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read AI safety state"
  ON public.ai_safety_state FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update AI safety state"
  ON public.ai_safety_state FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helper: tokens used in the last hour (platform-wide)
CREATE OR REPLACE FUNCTION public.ai_tokens_last_hour()
RETURNS BIGINT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(total_tokens), 0)::BIGINT
  FROM public.ai_usage_log
  WHERE created_at > now() - INTERVAL '1 hour';
$$;
