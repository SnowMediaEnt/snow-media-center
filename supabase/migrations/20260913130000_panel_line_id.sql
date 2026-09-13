-- The panel's own id for a line (a UUID). The reseller API key cannot look
-- lines up by username until the panel admin grants indexLines, but it can
-- renew any line by id. WHMCS-provisioned lines already carry theirs in
-- tblhosting.dedicatedip; hand-made lines get it recorded here, either by an
-- admin or by the renewal bridge after the first successful renewal.
ALTER TABLE public.customer_services ADD COLUMN IF NOT EXISTS panel_line_id text;
ALTER TABLE public.site_renewals ADD COLUMN IF NOT EXISTS panel_line_id text;
