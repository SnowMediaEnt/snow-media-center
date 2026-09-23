-- Titles viewers requested through Plex search (Overseerr), so the box that
-- asked can be told when it arrives. Written and read ONLY by the
-- overseerr-request edge function with the service role: RLS is on and no
-- policy grants anything to anon or authenticated users.
--
-- device_key is a random secret generated per install (never the analytics
-- device id); user_id is the signed-in Snow Media user when there was one.
CREATE TABLE IF NOT EXISTS public.plex_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_key text NOT NULL,
  user_id uuid,
  tmdb_id integer NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('movie', 'tv')),
  title text NOT NULL,
  poster_url text,
  overseerr_request_id integer,
  requested_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  notified_at timestamptz,
  CONSTRAINT plex_requests_device_title_key UNIQUE (device_key, tmdb_id, media_type)
);

CREATE INDEX IF NOT EXISTS plex_requests_pending_idx
  ON public.plex_requests (device_key)
  WHERE notified_at IS NULL;

ALTER TABLE public.plex_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plex_requests FROM anon, authenticated;
GRANT ALL ON public.plex_requests TO service_role;