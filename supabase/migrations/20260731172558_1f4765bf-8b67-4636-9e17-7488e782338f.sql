CREATE TABLE public.backup_streams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL DEFAULT 'live' CHECK (kind IN ('live','vod')),
  title         text NOT NULL,
  subtitle      text,
  url           text NOT NULL,
  poster_url    text,
  -- Xtream server targeting, same convention as app_alerts.app_match:
  -- NULL or 'all' = every server; otherwise matches the signed-in server
  -- label case-insensitively ('Dreamstreams' | 'Vibez').
  server_label  text,
  -- Tenant scoping. Holds the tenant CODE (tenants.code), never the uuid —
  -- the Player only ever has a code in hand. NULL = Snow Media only (default),
  -- 'all' = every tenant, or a specific reseller code.
  reseller_id   text,
  sort          integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  -- Optional auto-expiry so a PPV backup cleans itself up.
  starts_at     timestamptz,
  ends_at       timestamptz,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_backup_streams_lookup ON public.backup_streams (active, kind, sort);
CREATE INDEX idx_backup_streams_reseller ON public.backup_streams (reseller_id);

GRANT SELECT ON public.backup_streams TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_streams TO authenticated;
GRANT ALL ON public.backup_streams TO service_role;

ALTER TABLE public.backup_streams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active backup streams"
  ON public.backup_streams FOR SELECT
  USING (
    active = true
    AND (starts_at IS NULL OR now() >= starts_at)
    AND (ends_at   IS NULL OR now() <= ends_at)
  );

CREATE POLICY "Admins can view all backup streams"
  ON public.backup_streams FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert backup streams"
  ON public.backup_streams FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update backup streams"
  ON public.backup_streams FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete backup streams"
  ON public.backup_streams FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_backup_streams_updated_at
  BEFORE UPDATE ON public.backup_streams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.backup_streams REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backup_streams;