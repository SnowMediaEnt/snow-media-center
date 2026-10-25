-- =============================================================================
-- Sign-in PINs (owner, 2026-10-24). Project falmwzhvxoefvkfsiylp.
--
-- Paste the WHOLE file into the SQL Editor and click Run (not `supabase db
-- push`: that would also push older files that must not be applied). Safe to
-- run again. One transaction that checks itself at the end: if a check fails,
-- nothing in it is kept. Changes no existing rows, deletes nothing. It ends
-- with the notice "signin_pins: all checks passed".
--
-- Customers of DreamStreams and Vibez sign in to SMC's Live TV with a 10-digit
-- PIN instead of the line's username and password. One PIN per line, shared
-- by every device on it. A PIN works while its line has not expired and keeps
-- the same digits when the line is renewed.
--
-- What it adds
--   1. public.signin_pins: one row per line.
--        panel_hostname  'dstreams.xyz' or 'strmz.xyz' (no scheme, no port);
--        panel_username  the line's username;
--        line_key        panel_hostname || ':' || lower(panel_username),
--                        generated, unique: one PIN per line;
--        customer_id     the CRM customer, when known;
--        pin_hmac        the lookup key: HMAC-SHA256 of the 10 digits with a
--                        key derived from PANEL_CRED_KEY (64 hex, unique);
--        pin_enc         the PIN itself, enc:v1 (AES-256-GCM, PANEL_CRED_KEY),
--                        only so the hub can show it again;
--        source          where it was made: line-created, site-provision,
--                        capture, hub or backfill;
--        created_by, created_at, updated_at (changes, not sign-ins),
--        disabled_at (switched off when set), deleted_at (deleted in the hub:
--        a soft delete, so the row keeps its line_key and no hook or backfill
--        gives the line a PIN again; only a hub create / new PIN brings it
--        back, with new digits), last_used_at, use_count.
--      There is NO password on this row: pin-signin reads the line's newest
--      password from customer_services / player_signins (signin_pin_line).
--      Row-level security on, no policies, nothing granted to anon or
--      authenticated: only the edge functions (service role) touch it.
--   2. public.throttle_refund(key): takes one count back off a
--      player_login_throttle counter (throttle_hit, 20261016180000).
--      pin-signin counts every attempt first and gives a matching PIN its
--      count back: the limits count wrong PINs only.
--   3. public.signin_pin_used(id): a sign-in with that PIN worked.
--   4. public.signin_pin_line(line_key): the line behind a PIN, read across
--      customer_services and player_signins with the scheme and port
--      stripped from the stored host:
--        expiration_date  the latest of all of them;
--        panel_password   the newest one on file (enc:v1 or plain: the caller
--                         decrypts);
--        panel_host       the host that password was stored with, as stored.
--   All three functions: service role only.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NULL
     OR to_regclass('public.customer_services') IS NULL
     OR to_regclass('public.player_signins') IS NULL
     OR to_regclass('public.player_login_throttle') IS NULL
     OR to_regprocedure('public.throttle_hit(text, bigint)') IS NULL THEN
    RAISE EXCEPTION 'signin_pins needs customers, customer_services, player_signins, player_login_throttle and throttle_hit (20261016180000) first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. The PINs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signin_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_hostname text NOT NULL,
  panel_username text NOT NULL,
  line_key text GENERATED ALWAYS AS (panel_hostname || ':' || lower(panel_username)) STORED,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  pin_hmac text NOT NULL,
  pin_enc text NOT NULL,
  source text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  deleted_at timestamptz,
  last_used_at timestamptz,
  use_count integer NOT NULL DEFAULT 0
);

-- A run of an earlier draft of this file has no deleted_at yet.
ALTER TABLE public.signin_pins ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Dropped and added again on every run, so every row is checked again.
ALTER TABLE public.signin_pins
  DROP CONSTRAINT IF EXISTS signin_pins_hostname_check,
  DROP CONSTRAINT IF EXISTS signin_pins_username_check,
  DROP CONSTRAINT IF EXISTS signin_pins_pin_hmac_check,
  DROP CONSTRAINT IF EXISTS signin_pins_pin_enc_check,
  DROP CONSTRAINT IF EXISTS signin_pins_source_check,
  DROP CONSTRAINT IF EXISTS signin_pins_use_count_check;
ALTER TABLE public.signin_pins
  ADD CONSTRAINT signin_pins_hostname_check
    CHECK (panel_hostname IN ('dstreams.xyz', 'strmz.xyz')),
  ADD CONSTRAINT signin_pins_username_check
    CHECK (char_length(panel_username) BETWEEN 1 AND 256 AND panel_username = btrim(panel_username)
           AND panel_username !~ '[\x01-\x1F\x7F]'),
  ADD CONSTRAINT signin_pins_pin_hmac_check
    CHECK (pin_hmac ~ '^[0-9a-f]{64}$'),
  -- enc:v1:<base64( iv(12) || ciphertext || tag(16) )>: 10 digits are 38
  -- bytes, 52 base64 characters; anything shorter than one byte of
  -- ciphertext (40 characters) is not a PIN.
  ADD CONSTRAINT signin_pins_pin_enc_check
    CHECK (pin_enc ~ '^enc:v1:[A-Za-z0-9+/]{39,}={0,2}$'),
  ADD CONSTRAINT signin_pins_source_check
    CHECK (source IN ('line-created', 'site-provision', 'capture', 'hub', 'backfill')),
  ADD CONSTRAINT signin_pins_use_count_check
    CHECK (use_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS signin_pins_line_key_key ON public.signin_pins (line_key);
CREATE UNIQUE INDEX IF NOT EXISTS signin_pins_pin_hmac_key ON public.signin_pins (pin_hmac);
CREATE INDEX IF NOT EXISTS signin_pins_customer_idx ON public.signin_pins (customer_id);
CREATE INDEX IF NOT EXISTS signin_pins_created_idx ON public.signin_pins (created_at DESC);

-- updated_at: a change (the PIN, on/off, deleted, the customer), never a sign-in.
-- created_at and created_by stay as they were (created_by may only become
-- NULL: the login that made it was removed).
CREATE OR REPLACE FUNCTION public.signin_pins_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    IF NEW.created_by IS NOT NULL THEN
      NEW.created_by := OLD.created_by;
    END IF;
    IF (NEW.panel_hostname, NEW.panel_username, NEW.customer_id, NEW.pin_hmac, NEW.pin_enc, NEW.disabled_at, NEW.deleted_at)
       IS DISTINCT FROM
       (OLD.panel_hostname, OLD.panel_username, OLD.customer_id, OLD.pin_hmac, OLD.pin_enc, OLD.disabled_at, OLD.deleted_at) THEN
      NEW.updated_at := now();
    ELSE
      NEW.updated_at := OLD.updated_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS signin_pins_touch ON public.signin_pins;
CREATE TRIGGER signin_pins_touch BEFORE UPDATE ON public.signin_pins
  FOR EACH ROW EXECUTE FUNCTION public.signin_pins_touch();

-- Server only: no policies, no rights for the API roles.
ALTER TABLE public.signin_pins ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE
  v_policy text;
BEGIN
  FOR v_policy IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'signin_pins' LOOP
    EXECUTE format('DROP POLICY %I ON public.signin_pins', v_policy);
  END LOOP;
END $$;
REVOKE ALL ON public.signin_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signin_pins TO service_role;

-- -----------------------------------------------------------------------------
-- 2. A limit's count taken back (pin-signin: a PIN that matched)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.throttle_refund(p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_key IS NULL OR p_key = '' THEN
    RETURN;
  END IF;
  -- One statement: parallel refunds and hits are each counted once.
  UPDATE public.player_login_throttle t
     SET count = t.count - 1
   WHERE t.ip_hash = p_key AND t.count > 0;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 3. A sign-in with a PIN worked
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.signin_pin_used(p_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  UPDATE public.signin_pins
     SET last_used_at = now(), use_count = least(use_count, 2147483646) + 1
   WHERE id = p_id;
$function$;

-- -----------------------------------------------------------------------------
-- 4. The line behind a PIN
-- -----------------------------------------------------------------------------
-- A stored host, as the hostname alone: 'http://dstreams.xyz:8080/' ->
-- 'dstreams.xyz'. A customer_services row without a host counts for the
-- panel its service type names (DreamStreams / Vibez), never for both.
CREATE OR REPLACE FUNCTION public.signin_pin_line(p_line_key text)
 RETURNS TABLE (expiration_date date, panel_password text, panel_host text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH k AS (
    SELECT split_part(p_line_key, ':', 1) AS hostname,
           substr(p_line_key, strpos(p_line_key, ':') + 1) AS username
     WHERE strpos(coalesce(p_line_key, ''), ':') > 1
  ),
  lines AS (
    SELECT cs.expiration_date, cs.panel_password, cs.panel_host, cs.created_at AS seen_at
      FROM public.customer_services cs, k
     WHERE lower(btrim(cs.panel_username)) = k.username
       AND CASE
             WHEN nullif(btrim(coalesce(cs.panel_host, '')), '') IS NOT NULL THEN
               lower(regexp_replace(regexp_replace(btrim(cs.panel_host), '^[a-z]+://', '', 'i'), '[:/].*$', ''))
             WHEN lower(coalesce(cs.service_type, '')) LIKE 'dream%' THEN 'dstreams.xyz'
             WHEN lower(coalesce(cs.service_type, '')) LIKE 'vibez%' THEN 'strmz.xyz'
             ELSE NULL
           END = k.hostname
    UNION ALL
    SELECT ps.expiration_date, ps.panel_password, ps.panel_host, ps.last_seen_at AS seen_at
      FROM public.player_signins ps, k
     WHERE lower(btrim(ps.panel_username)) = k.username
       AND lower(regexp_replace(regexp_replace(btrim(ps.panel_host), '^[a-z]+://', '', 'i'), '[:/].*$', '')) = k.hostname
  ),
  newest AS (
    SELECT l.panel_password, l.panel_host
      FROM lines l
     WHERE nullif(l.panel_password, '') IS NOT NULL
     ORDER BY l.seen_at DESC NULLS LAST
     LIMIT 1
  )
  SELECT (SELECT max(l.expiration_date) FROM lines l),
         (SELECT n.panel_password FROM newest n),
         (SELECT n.panel_host FROM newest n);
$function$;

-- -----------------------------------------------------------------------------
-- 5. Who may call what
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.signin_pins_touch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.throttle_refund(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.signin_pin_used(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.signin_pin_line(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.throttle_refund(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.signin_pin_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.signin_pin_line(text) TO service_role;

-- -----------------------------------------------------------------------------
-- Self-check (inside the transaction: a failure keeps nothing)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_enc text := 'enc:v1:' || repeat('A', 52);
  v_hmac text := repeat('ab', 32);
  v_case record;
  v_got text;
  v_key text := 'signin-pins-self-check:' || gen_random_uuid()::text;
  v_line_key text;
  v_before integer;
  v_after integer;
  v_floor integer;
  v_line record;
BEGIN
  -- The table and who may touch it.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.signin_pins'::regclass) THEN
    RAISE EXCEPTION 'signin_pins check failed: no row-level security';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'signin_pins') THEN
    RAISE EXCEPTION 'signin_pins check failed: it has a policy (only the server may read it)';
  END IF;
  IF has_table_privilege('anon', 'public.signin_pins', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_table_privilege('authenticated', 'public.signin_pins', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR has_any_column_privilege('anon', 'public.signin_pins', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_any_column_privilege('authenticated', 'public.signin_pins', 'SELECT, INSERT, UPDATE, REFERENCES') THEN
    RAISE EXCEPTION 'signin_pins check failed: open to the app or the hub directly';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.signin_pins', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.signin_pins', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.signin_pins', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.signin_pins', 'DELETE') THEN
    RAISE EXCEPTION 'signin_pins check failed: the edge functions can''t use it';
  END IF;
  IF (SELECT count(*) FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
       WHERE i.indrelid = 'public.signin_pins'::regclass AND i.indisunique AND i.indnatts = 1
         AND i.indpred IS NULL AND a.attname IN ('pin_hmac', 'line_key')) <> 2 THEN
    RAISE EXCEPTION 'signin_pins check failed: pin_hmac and line_key must each be unique';
  END IF;
  IF has_function_privilege('anon', 'public.throttle_refund(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.throttle_refund(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.signin_pin_used(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.signin_pin_used(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.signin_pin_line(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.signin_pin_line(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.throttle_refund(text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.signin_pin_used(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.signin_pin_line(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'signin_pins check failed: a function is open to the wrong callers';
  END IF;

  -- The row checks. Each attempt is inside a block that is undone at its
  -- end: a good row reaches the 'undo' (every check passed), a bad one stops
  -- at its check. Nothing is ever kept.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('good row',               'strmz.xyz',      'Viewer1', v_hmac,          v_enc,        'capture',  'ok'),
      ('another panel',          'example.com',    'viewer1', v_hmac,          v_enc,        'capture',  'check'),
      ('a host with a port',     'dstreams.xyz:8080', 'viewer1', v_hmac,       v_enc,        'capture',  'check'),
      ('no username',            'strmz.xyz',      '',        v_hmac,          v_enc,        'capture',  'check'),
      ('a padded username',      'strmz.xyz',      ' viewer1', v_hmac,         v_enc,        'capture',  'check'),
      ('a line break',           'strmz.xyz',      E'view\ner', v_hmac,        v_enc,        'capture',  'check'),
      ('plain PIN',              'strmz.xyz',      'viewer1', v_hmac,          '1234567890', 'capture',  'check'),
      ('a PIN as its hash key',  'strmz.xyz',      'viewer1', '1234567890',    v_enc,        'capture',  'check'),
      ('an upper-case hash key', 'strmz.xyz',      'viewer1', upper(v_hmac),   v_enc,        'capture',  'check'),
      ('an unknown source',      'strmz.xyz',      'viewer1', v_hmac,          v_enc,        'website',  'check')
    ) AS c(label_case, hostname, username, hmac, pin_enc, source, expect)
  LOOP
    v_line_key := NULL;
    BEGIN
      INSERT INTO public.signin_pins (panel_hostname, panel_username, pin_hmac, pin_enc, source)
      VALUES (v_case.hostname, v_case.username, v_case.hmac, v_case.pin_enc, v_case.source)
      RETURNING line_key INTO v_line_key;
      RAISE EXCEPTION USING ERRCODE = 'P0042', MESSAGE = 'signin_pins self-check: undo';
    EXCEPTION
      WHEN check_violation THEN v_got := 'check';
      WHEN unique_violation THEN v_got := 'unique';
      WHEN SQLSTATE 'P0042' THEN v_got := 'ok';
    END;
    IF v_got IS DISTINCT FROM v_case.expect THEN
      RAISE EXCEPTION 'signin_pins check failed: % (expected %, got %)', v_case.label_case, v_case.expect, v_got;
    END IF;
  END LOOP;

  -- line_key is generated, lower-case, and one PIN per line.
  BEGIN
    INSERT INTO public.signin_pins (panel_hostname, panel_username, pin_hmac, pin_enc, source)
    VALUES ('strmz.xyz', 'Self.Check', repeat('cd', 32), v_enc, 'backfill')
    RETURNING line_key INTO v_line_key;
    IF v_line_key IS DISTINCT FROM 'strmz.xyz:self.check' THEN
      RAISE EXCEPTION 'signin_pins check failed: line_key is %', v_line_key;
    END IF;
    BEGIN
      INSERT INTO public.signin_pins (panel_hostname, panel_username, pin_hmac, pin_enc, source)
      VALUES ('strmz.xyz', 'self.check', repeat('ef', 32), v_enc, 'backfill');
      v_got := 'kept';
    EXCEPTION WHEN unique_violation THEN v_got := 'unique';
    END;
    IF v_got <> 'unique' THEN
      RAISE EXCEPTION 'signin_pins check failed: a second PIN for the same line was kept';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0042', MESSAGE = 'signin_pins self-check: undo';
  EXCEPTION WHEN SQLSTATE 'P0042' THEN
    NULL;
  END;

  -- throttle_refund takes exactly one count back, never below nothing.
  BEGIN
    PERFORM public.throttle_hit(v_key, 600000);
    PERFORM public.throttle_hit(v_key, 600000);
    SELECT t.count INTO v_before FROM public.player_login_throttle t WHERE t.ip_hash = v_key;
    PERFORM public.throttle_refund(v_key);
    SELECT t.count INTO v_after FROM public.player_login_throttle t WHERE t.ip_hash = v_key;
    PERFORM public.throttle_refund(v_key);
    PERFORM public.throttle_refund(v_key);
    SELECT t.count INTO v_floor FROM public.player_login_throttle t WHERE t.ip_hash = v_key;
    RAISE EXCEPTION USING ERRCODE = 'P0042', MESSAGE = 'signin_pins self-check: undo';
  EXCEPTION WHEN SQLSTATE 'P0042' THEN
    NULL;
  END;
  IF v_before IS DISTINCT FROM 2 OR v_after IS DISTINCT FROM 1 OR v_floor IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'signin_pins check failed: throttle_refund (% -> % -> %)', v_before, v_after, v_floor;
  END IF;
  IF EXISTS (SELECT 1 FROM public.player_login_throttle t WHERE t.ip_hash = v_key) THEN
    RAISE EXCEPTION 'signin_pins check failed: the self-check left a throttle row behind';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'signin_pins' AND column_name = 'deleted_at') THEN
    RAISE EXCEPTION 'signin_pins check failed: no deleted_at column';
  END IF;

  -- signin_pin_line on a line nobody has: one row, all empty.
  SELECT * INTO v_line FROM public.signin_pin_line('strmz.xyz:' || gen_random_uuid()::text);
  IF v_line.expiration_date IS NOT NULL OR v_line.panel_password IS NOT NULL OR v_line.panel_host IS NOT NULL THEN
    RAISE EXCEPTION 'signin_pins check failed: signin_pin_line found a line that does not exist';
  END IF;

  RAISE NOTICE 'signin_pins: all checks passed';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- What the Results pane shows.
SELECT
  (SELECT count(*) FROM public.signin_pins WHERE deleted_at IS NULL) AS signin_pins,
  (SELECT count(*) FROM public.signin_pins WHERE deleted_at IS NULL AND disabled_at IS NULL) AS signin_pins_on,
  (SELECT count(*) FROM public.signin_pins WHERE deleted_at IS NOT NULL) AS signin_pins_deleted;
