
-- Drop old restrictive policies
DROP POLICY IF EXISTS "Users can insert their own media assets" ON public.media_assets;
DROP POLICY IF EXISTS "Users can update their own media assets" ON public.media_assets;
DROP POLICY IF EXISTS "Users can delete their own media assets" ON public.media_assets;

-- Owners can insert their own assets (active or inactive)
CREATE POLICY "Users can insert their own media assets"
ON public.media_assets
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = uploaded_by);

-- Owners can update their own assets (including activating them)
CREATE POLICY "Users can update their own media assets"
ON public.media_assets
FOR UPDATE
TO authenticated
USING (auth.uid() = uploaded_by)
WITH CHECK (auth.uid() = uploaded_by);

-- Owners can delete their own assets
CREATE POLICY "Users can delete their own media assets"
ON public.media_assets
FOR DELETE
TO authenticated
USING (auth.uid() = uploaded_by);

-- Admins can update any asset (needed for cross-user deactivation in a section)
CREATE POLICY "Admins can update any media asset"
ON public.media_assets
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admins can delete any asset
CREATE POLICY "Admins can delete any media asset"
ON public.media_assets
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
