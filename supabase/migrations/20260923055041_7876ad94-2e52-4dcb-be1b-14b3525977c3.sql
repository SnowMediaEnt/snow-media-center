CREATE TABLE IF NOT EXISTS public.watch_history (
  user_id UUID NOT NULL,
  kind TEXT NOT NULL,
  item_key TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  poster TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  watched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind, item_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watch_history TO authenticated;
GRANT ALL ON public.watch_history TO service_role;
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own watch history"
ON public.watch_history FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);