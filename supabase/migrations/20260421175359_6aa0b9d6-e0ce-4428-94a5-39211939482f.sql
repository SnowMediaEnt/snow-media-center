-- Create app_alerts table for per-app warning popups
CREATE TABLE public.app_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  app_match TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Heads up',
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'admin',
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_alerts_active_match ON public.app_alerts (active, app_match);

ALTER TABLE public.app_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active app alerts"
ON public.app_alerts
FOR SELECT
USING (active = true);

CREATE POLICY "Admins can view all app alerts"
ON public.app_alerts
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert app alerts"
ON public.app_alerts
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update app alerts"
ON public.app_alerts
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete app alerts"
ON public.app_alerts
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_app_alerts_updated_at
BEFORE UPDATE ON public.app_alerts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();