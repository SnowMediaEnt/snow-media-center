GRANT EXECUTE ON FUNCTION public.giveaway_award_entry(uuid,uuid,uuid,text,integer,text,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_invalidate_order(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_backfill_active(uuid) TO service_role;