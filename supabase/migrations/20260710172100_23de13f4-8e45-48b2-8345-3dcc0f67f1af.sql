CREATE TABLE public.ai_generated_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  user_email text NULL,
  model text NULL,
  prompt text NULL,
  storage_path text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  error_message text NULL
);

GRANT SELECT ON public.ai_generated_images TO authenticated;
GRANT ALL ON public.ai_generated_images TO service_role;

ALTER TABLE public.ai_generated_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view generated images"
  ON public.ai_generated_images
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_ai_generated_images_created_at ON public.ai_generated_images (created_at DESC);