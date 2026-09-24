-- Snow Mail readers can no longer read who else a campaign went to.
--
-- snow_mail was granted to anon and authenticated table-wide, and its policy
-- filters rows, not columns. So any account that received a targeted campaign
-- could ask for recipient_emails on that row and get every address on it (up
-- to 20,000 customers).
--
-- Clients now get SELECT on every column except recipient_emails. The read
-- policy still uses recipient_emails to decide who sees a targeted mail:
-- column privileges apply to the columns a query names, not to the columns a
-- policy reads. The app already selects only allowed columns
-- (src/lib/snowMail.ts). mail-publish (service role) and the Hub's admin_posts
-- / admin_delete_posts / admin_restore_post (SECURITY DEFINER) are unaffected.
-- A client `select=*` on snow_mail now fails; nothing in the app, Hub or
-- website does that.

REVOKE SELECT ON public.snow_mail FROM anon, authenticated;
GRANT SELECT (id, campaign_id, subject, preheader, blocks, hero_image, audience_mode, sent_at, created_at, updated_at)
  ON public.snow_mail TO anon, authenticated;
