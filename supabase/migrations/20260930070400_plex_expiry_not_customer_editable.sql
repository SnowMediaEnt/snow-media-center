-- A customer can no longer extend their own Plex access by editing a date.
--
-- The Hub's Plex enforcement copies customer_services.expiration_date of the
-- service a Plex member is bound to (plex_members.sync_service_id) onto the
-- member's expires_at every sweep. Customers can write their own
-- customer_services rows ('users update own services' / 'users insert own
-- services', which the My Services editor and the player-account sync use),
-- so a customer could set that date years ahead and keep Plex without paying.
-- The admin app's plex_autobind_member_to_service trigger made it quicker: any
-- dated non-Plex row a customer inserted bound their Plex member to it and
-- moved expires_at at once.
--
-- 1. plex_autobind_member_to_service does nothing when the write comes from a
--    signed-in user who is not an admin. The Hub (admin), the service-role
--    edge functions (capture-player-signin, refresh-player-signins, the link
--    functions) and SQL run by the owner or pg_cron have no end-user
--    auth.uid() or are admins, so they bind exactly as before. (Checking
--    auth.role() = 'service_role' instead would also stop pg_cron and the SQL
--    editor, which have no JWT at all.)
-- 2. A new BEFORE UPDATE trigger keeps the old expiration_date when such a
--    user changes the date of a row a Plex member is bound to. The rest of
--    the update still goes through, so the app's editor and sync keep
--    working; only that one date stays put until an admin or a server path
--    changes it. SECURITY DEFINER because plex_members has no policies, so the
--    customer could not see the member row the check needs.
--
-- The Hub's enforcement code does not change. The body in (1) is the admin
-- app's 0005_plex_autobind_service.sql with the new first check; if the live
-- body has been edited since, compare with
-- pg_get_functiondef('public.plex_autobind_member_to_service()'::regprocedure).

CREATE OR REPLACE FUNCTION public.plex_autobind_member_to_service()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_expires timestamptz;
BEGIN
  -- A customer's own write never moves Plex; only admins and server paths do.
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN RETURN NEW; END IF;

  -- Only Live TV / IPTV-style services with a date. Plex rows are the thing
  -- being bound, never the source.
  IF NEW.expiration_date IS NULL THEN RETURN NEW; END IF;
  IF lower(coalesce(NEW.service_type,'')) LIKE '%plex%' THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;

  -- On UPDATE, only react when the date actually changed (or the row just
  -- gained one). Renewals recorded via the Hub/app both land here.
  IF TG_OP = 'UPDATE' AND NEW.expiration_date IS NOT DISTINCT FROM OLD.expiration_date THEN
    RETURN NEW;
  END IF;

  -- MUST match serviceExpiryToIso in plex-admin AND the Hub EXACTLY:
  --   new Date(`${yyyy-mm-dd}T23:59:59-06:00`)
  -- i.e. 23:59:59 at a FIXED -06:00 offset (not a named zone). Enforcement
  -- re-mirrors whenever the stored date differs from that by > 1 hour, so
  -- any other convention here would make the two fight every sweep.
  v_expires := (NEW.expiration_date::text || ' 23:59:59-06')::timestamptz;

  UPDATE public.plex_members m
     SET sync_service_id = NEW.id,
         expires_at      = v_expires,
         status          = CASE WHEN m.status = 'expired' AND v_expires > now()
                                THEN 'active' ELSE m.status END
   WHERE m.customer_id = NEW.customer_id
     AND m.status IN ('active','expired')
     AND (
           m.sync_service_id IS NULL
        OR m.sync_service_id = NEW.id
        OR EXISTS (SELECT 1 FROM public.customer_services s
                    WHERE s.id = m.sync_service_id
                      AND lower(coalesce(s.service_type,'')) LIKE '%plex%')
         );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a service save because the Plex mirror hiccupped.
  RAISE WARNING 'plex_autobind: % (service %)', SQLERRM, NEW.id;
  RETURN NEW;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.plex_autobind_member_to_service() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.customer_services_keep_plex_expiry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  -- plex_members comes from the Hub's setup, not these migrations; without
  -- it (a local database) there is nothing to protect. A separate IF, so the
  -- query below is only planned when the table exists.
  IF NEW.expiration_date IS DISTINCT FROM OLD.expiration_date
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND to_regclass('public.plex_members') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.plex_members m WHERE m.sync_service_id = OLD.id) THEN
      NEW.expiration_date := OLD.expiration_date;
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.customer_services_keep_plex_expiry() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_services_keep_plex_expiry ON public.customer_services;
CREATE TRIGGER trg_customer_services_keep_plex_expiry
  BEFORE UPDATE OF expiration_date ON public.customer_services
  FOR EACH ROW EXECUTE FUNCTION public.customer_services_keep_plex_expiry();
