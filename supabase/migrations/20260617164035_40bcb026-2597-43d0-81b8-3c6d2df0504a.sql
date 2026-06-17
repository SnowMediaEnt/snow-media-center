
-- #8 knowledge_documents: ensure no anon/public SELECT policy remains; lock SELECT to authenticated
DROP POLICY IF EXISTS "Knowledge documents are viewable by everyone" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Public can view active knowledge documents" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Anyone can view active knowledge documents" ON public.knowledge_documents;
DROP POLICY IF EXISTS "Authenticated users can view active knowledge documents" ON public.knowledge_documents;
CREATE POLICY "Authenticated users can view active knowledge documents"
  ON public.knowledge_documents
  FOR SELECT
  TO authenticated
  USING (is_active = true);
REVOKE SELECT ON public.knowledge_documents FROM anon;

-- #7 analytics_sessions: replace any UPDATE policy with a self-scoped one
DROP POLICY IF EXISTS "anon can update sessions" ON public.analytics_sessions;
DROP POLICY IF EXISTS "clients can update own sessions" ON public.analytics_sessions;
DROP POLICY IF EXISTS "clients update own sessions" ON public.analytics_sessions;
CREATE POLICY "clients update own sessions"
  ON public.analytics_sessions
  FOR UPDATE
  TO anon, authenticated
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (
    length(session_id) BETWEEN 8 AND 128
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- #7 analytics_devices: replace any UPDATE policy with a self-scoped one
DROP POLICY IF EXISTS "anon can update devices" ON public.analytics_devices;
DROP POLICY IF EXISTS "clients can update own devices" ON public.analytics_devices;
DROP POLICY IF EXISTS "clients update own devices" ON public.analytics_devices;
CREATE POLICY "clients update own devices"
  ON public.analytics_devices
  FOR UPDATE
  TO anon, authenticated
  USING (
    last_user_id IS NULL
    OR last_user_id = auth.uid()
    OR first_user_id = auth.uid()
  )
  WITH CHECK (
    length(device_id) BETWEEN 8 AND 128
    AND (last_user_id IS NULL OR last_user_id = auth.uid())
  );
