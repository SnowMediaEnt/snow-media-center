-- Fix knowledge-base storage bucket policies to restrict to admin only
-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can upload knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update knowledge files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete knowledge files" ON storage.objects;

-- Create admin-only policies for knowledge-base bucket
CREATE POLICY "Admins can upload knowledge files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'knowledge-base' 
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can update knowledge files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'knowledge-base' 
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'knowledge-base' 
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Admins can delete knowledge files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'knowledge-base' 
  AND public.has_role(auth.uid(), 'admin')
);