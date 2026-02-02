-- Fix is_profile_owner function to set search_path
CREATE OR REPLACE FUNCTION public.is_profile_owner(profile_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  RETURN auth.uid() = profile_user_id;
END;
$function$;