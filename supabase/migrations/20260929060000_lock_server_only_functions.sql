-- Lock down functions that must never be called from a browser or a box.
--
-- On this project new functions are granted EXECUTE to anon and
-- authenticated BY NAME (Supabase's default privileges), so the
-- "REVOKE ... FROM PUBLIC; GRANT ... TO service_role" in earlier migrations
-- did not close them: the live database let anyone call them.
--
-- capture_player_signin (both overloads) trusts the ids it is given and
-- re-links a line to whatever customer the caller names; link_player_signin_to_crm
-- then copies that line's stored panel password into the named customer's
-- customer_services row, which the caller can read. link_claimed_panel_line
-- attaches any line to any customer. Only the edge functions (service role)
-- and other SECURITY DEFINER functions (which run as their owner) call them.
REVOKE EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_player_signin(text, text, text, date, text, integer, boolean, text, text, uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.link_claimed_panel_line(uuid, uuid, text, text, text, date, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_claimed_panel_line(uuid, uuid, text, text, text, date, integer, boolean) TO service_role;

-- Giveaway admin actions: the Hub calls them as a signed-in admin and each
-- checks has_role(admin) itself, but nobody signed out should reach them.
-- giveaway_backfill_active's check lets a null auth.uid() through (for the
-- service role), which is exactly what a signed-out caller has.
REVOKE EXECUTE ON FUNCTION public.giveaway_backfill_active(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.giveaway_draw_winners(uuid, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.giveaway_review_entry(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.giveaway_invalidate_entry(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.giveaway_admin_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.giveaway_backfill_active(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_draw_winners(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_review_entry(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_invalidate_entry(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.giveaway_admin_overview(uuid) TO authenticated, service_role;

-- A name from any user or customer id: only giveaway_draw_winners (as its
-- owner) needs it.
REVOKE EXECUTE ON FUNCTION public.giveaway_display_name(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.giveaway_display_name(uuid, uuid) TO service_role;

-- A profile stays its owner's: without WITH CHECK an owner could move their
-- row to another user_id.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
