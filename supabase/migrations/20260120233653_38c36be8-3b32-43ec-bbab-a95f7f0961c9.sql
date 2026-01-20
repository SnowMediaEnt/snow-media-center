-- Drop the admin-only management policy
DROP POLICY IF EXISTS "Admins can manage media assets" ON public.media_assets;

-- Allow authenticated users to insert their own media assets
CREATE POLICY "Users can insert their own media assets"
ON public.media_assets
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = uploaded_by);

-- Allow users to update their own media assets
CREATE POLICY "Users can update their own media assets"
ON public.media_assets
FOR UPDATE
TO authenticated
USING (auth.uid() = uploaded_by)
WITH CHECK (auth.uid() = uploaded_by);

-- Allow users to delete their own media assets
CREATE POLICY "Users can delete their own media assets"
ON public.media_assets
FOR DELETE
TO authenticated
USING (auth.uid() = uploaded_by);

-- Allow users to view their own media assets (even inactive ones)
CREATE POLICY "Users can view their own media assets"
ON public.media_assets
FOR SELECT
TO authenticated
USING (auth.uid() = uploaded_by);