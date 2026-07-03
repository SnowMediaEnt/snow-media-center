
CREATE OR REPLACE FUNCTION public._probe_tenant_overview(p_code text) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r text;
BEGIN
  PERFORM public.tenant_analytics_overview(p_code, 30);
  RETURN 'NO_RAISE';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;
GRANT EXECUTE ON FUNCTION public._probe_tenant_overview(text) TO supabase_read_only_user, authenticated, anon;
