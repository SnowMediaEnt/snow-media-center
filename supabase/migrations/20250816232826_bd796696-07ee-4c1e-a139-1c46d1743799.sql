-- Security fix: Ensure profiles table has the most restrictive RLS policies
-- to prevent any potential email harvesting attacks

-- First, let's verify current policies are the most secure
-- Drop any potentially insecure policies if they exist
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;

-- Ensure only the secure user-specific policies exist
-- These should already be in place but we're being explicit for security

-- Policy for users to view only their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = user_id);

-- Policy for users to update only their own profile  
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id);

-- Policy for users to insert only their own profile
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Ensure RLS is enabled (should already be enabled)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Add a security function to double-check user access
CREATE OR REPLACE FUNCTION public.is_profile_owner(profile_user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN auth.uid() = profile_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Create a more restrictive policy using the security function for extra protection
DROP POLICY IF EXISTS "Secure profile access" ON public.profiles;
CREATE POLICY "Secure profile access"
ON public.profiles
FOR ALL
USING (public.is_profile_owner(user_id))
WITH CHECK (public.is_profile_owner(user_id));