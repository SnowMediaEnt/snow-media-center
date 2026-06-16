
-- Restrict analytics_sessions UPDATE
DROP POLICY IF EXISTS "anon can update sessions" ON public.analytics_sessions;
CREATE POLICY "clients can update own sessions"
ON public.analytics_sessions
FOR UPDATE
TO anon, authenticated
USING (user_id IS NULL OR user_id = auth.uid())
WITH CHECK (
  (length(session_id) >= 8) AND (length(session_id) <= 128)
  AND (user_id IS NULL OR user_id = auth.uid())
);

-- Restrict analytics_devices UPDATE
DROP POLICY IF EXISTS "anon can update devices" ON public.analytics_devices;
CREATE POLICY "clients can update own devices"
ON public.analytics_devices
FOR UPDATE
TO anon, authenticated
USING (
  last_user_id IS NULL
  OR last_user_id = auth.uid()
  OR first_user_id = auth.uid()
)
WITH CHECK (
  (length(device_id) >= 8) AND (length(device_id) <= 128)
);

-- Restrict knowledge_documents SELECT to authenticated users only
DROP POLICY IF EXISTS "Knowledge documents are viewable by everyone" ON public.knowledge_documents;
CREATE POLICY "Authenticated users can view active knowledge documents"
ON public.knowledge_documents
FOR SELECT
TO authenticated
USING (is_active = true);

REVOKE SELECT ON public.knowledge_documents FROM anon;
