// Sign in with a PIN (owner, 2026-10-24; 20261025120000_signin_pins.sql).
// Every DreamStreams / Vibez line has one 10-digit PIN (signin-pins makes
// them). The app sends only the PIN and gets the line back, then signs in
// with it exactly as if the customer had typed the username and password.
//
// POST { pin }   (verify_jwt = false: a box has no session)
// 200 { ok:true, line: { server: 'DreamStreams'|'Vibez',
//                        host: 'http://dstreams.xyz:8080'|'http://strmz.xyz',
//                        username, password } }
// 200 { ok:false, reason } with reason one of:
//   invalid_pin   not 10 digits (spaces and dashes are dropped first);
//   not_found     no such PIN, or it is switched off or deleted (one answer
//                 for every miss: nothing about a PIN leaks);
//   expired       the PIN is right but its line is over (only ever after a
//                 match);
//   rate_limited  too many wrong PINs from this address (5 per 10 minutes),
//                 or from everyone together (300 per 10 minutes: PIN sign-in
//                 pauses for everyone until the window ends; Discord is told);
//   error         our side failed (no key, the database, a password on file
//                 that can't be read).
//
// The limits count WRONG PINs only: every attempt is counted first (one
// atomic statement, so parallel guesses can't all slip under), and a PIN
// that matched is given its counts back (throttle_refund). The limits fail
// closed: a throttle outage refuses rather than lifting them.
//
// Expiry: a line whose latest stored expiry is still ahead signs in without
// asking anyone. When it has passed (or is today, or is not known), its
// panel is asked once, at most once per line per 15 minutes, and a later
// expiry it gives is stored. No grace period.
//
// Never logged: the PIN, its HMAC, the username, the password.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { decryptMaybe } from '../_shared/panelcrypto.ts';
import { clientIp, hashIp, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';
import { normalizePin, pinHmac } from '../_shared/signinPin.ts';
import { PIN_PANELS, recordLineExpiry, type PinHostname } from '../_shared/signinPinLines.ts';
import { PANEL_HOSTS, bareHost, panelExpiryMs, panelSaysOver, verifyPanelLine } from '../_shared/panelLine.ts';

const MAX_BODY_BYTES = 1024;

// Wrong PINs: 5 per 10 minutes per address; 300 per 10 minutes from everyone
// together pauses PIN sign-in for all.
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_PER_IP = 5;
const PIN_MAX_GLOBAL = 300;
const PIN_GLOBAL_KEY = 'pin:all';
const PIN_ALERT_KEY = 'pin:alert';
// The panel is asked about one line at most once per 15 minutes.
const RECHECK_WINDOW_MS = 15 * 60 * 1000;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const no = (reason: 'invalid_pin' | 'not_found' | 'expired' | 'rate_limited' | 'error') =>
  jsonResponse({ ok: false, reason });

type PinMatch = {
  id: string; line_key: string; panel_hostname: PinHostname; panel_username: string;
  disabled_at: string | null; deleted_at: string | null;
};
type LineRow = { expiration_date: string | null; panel_password: string | null; panel_host: string | null };

type EdgeRuntimeLike = { waitUntil?: (p: Promise<unknown>) => void };
const inBackground = (p: Promise<unknown>) => {
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p); else p.catch(() => {});
};

/** Discord, once per window, when everyone together hit the limit. Never blocks. */
async function alertGlobalLimit(db: ThrottleDb): Promise<void> {
  try {
    if (!(await throttle(db, PIN_ALERT_KEY, 1, PIN_WINDOW_MS, 'deny'))) return;
    const hook = Deno.env.get('DISCORD_WEBHOOK_URL');
    if (!hook) return;
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🔒 PIN SIGN-IN PAUSED — more than ${PIN_MAX_GLOBAL} wrong PINs in 10 minutes from everyone together. ` +
          'Sign-in with a PIN is refused for everyone until the window ends (username + password still work).',
      }),
    });
  } catch {
    console.warn('[pin-signin] limit alert not sent');
  }
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const db = admin as unknown as ThrottleDb;

    // 1. Throttle first: this address, then everyone together. No address at
    //    all shares one allowance, never none.
    const ipHash = await hashIp(clientIp(req.headers)).catch(() => null);
    const ipKey = `pin:${ipHash ?? 'ip:unknown'}`;
    if (!(await throttle(db, ipKey, PIN_MAX_PER_IP, PIN_WINDOW_MS, 'deny'))) return no('rate_limited');
    const refund = async (keys: string[]) => {
      for (const key of keys) {
        try {
          const { error } = await admin.rpc('throttle_refund', { p_key: key });
          if (error) console.warn('[pin-signin] throttle_refund failed:', (error as { code?: string }).code ?? 'error');
        } catch {
          console.warn('[pin-signin] throttle_refund threw');
        }
      }
    };
    if (!(await throttle(db, PIN_GLOBAL_KEY, PIN_MAX_GLOBAL, PIN_WINDOW_MS, 'deny'))) {
      // Paused for everyone: this address didn't get to try a PIN.
      await refund([ipKey]);
      inBackground(alertGlobalLimit(db));
      return no('rate_limited');
    }

    // 2. The PIN.
    const raw = await req.text();
    // No PIN in it at all (too big, not JSON): nothing to look up.
    if (raw.length > MAX_BODY_BYTES) return no('invalid_pin');
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return no('invalid_pin'); }
    if (!body || typeof body !== 'object') return no('invalid_pin');
    const pin = normalizePin(body.pin);
    if (!pin) return no('invalid_pin');
    const hmac = await pinHmac(pin);
    if (!hmac) {
      await refund([ipKey, PIN_GLOBAL_KEY]);
      console.error('[pin-signin] PANEL_CRED_KEY missing or unusable: no PIN can be checked');
      return no('error');
    }

    // 3. One read, the same for every miss.
    const { data, error: readErr } = await admin
      .from('signin_pins')
      .select('id, line_key, panel_hostname, panel_username, disabled_at, deleted_at')
      .eq('pin_hmac', hmac)
      .maybeSingle();
    if (readErr) {
      // Not a wrong PIN: our side failed (the migration not run, the database down).
      await refund([ipKey, PIN_GLOBAL_KEY]);
      console.error('[pin-signin] PIN read failed:', (readErr as { code?: string }).code ?? 'error');
      return no('error');
    }
    const row = data as PinMatch | null;
    const panel = row ? PIN_PANELS[row.panel_hostname] : undefined;
    if (!row || row.disabled_at || row.deleted_at || !panel) return no('not_found');

    // A match: not one of the wrong PINs the limits count.
    await refund([ipKey, PIN_GLOBAL_KEY]);

    // 4. The line: its latest expiry and newest password on file.
    const { data: lineData, error: lineErr } = await admin.rpc('signin_pin_line', { p_line_key: row.line_key });
    if (lineErr) {
      console.error('[pin-signin] line read failed:', (lineErr as { code?: string }).code ?? 'error');
      return no('error');
    }
    const line = (Array.isArray(lineData) ? lineData[0] : lineData) as LineRow | null;
    let password: string | null = null;
    try {
      password = (await decryptMaybe(line?.panel_password ?? null))?.trim() || null;
    } catch {
      password = null;
    }
    if (!password) {
      console.error('[pin-signin] no readable password on file for a PIN line');
      return no('error');
    }
    const username = row.panel_username;

    // 5. Over? The stored expiry first; the panel once when that has passed.
    const today = todayUtc();
    const exp = typeof line?.expiration_date === 'string' ? line.expiration_date.slice(0, 10) : null;
    if (!exp || exp <= today) {
      const mayAsk = await throttle(db, `pin-recheck:${row.line_key}`, 1, RECHECK_WINDOW_MS, 'deny');
      let decided: 'ok' | 'expired' | null = null;
      if (mayAsk) {
        const stored = bareHost(line?.panel_host);
        const host = PANEL_HOSTS.has(stored) && stored.startsWith(row.panel_hostname) ? stored : panel.panelHost;
        const verdict = await verifyPanelLine(host, username, password, 'pin-signin');
        if (verdict.kind === 'auth_failed') {
          decided = 'expired';
        } else if (verdict.kind === 'ok') {
          decided = panelSaysOver(verdict.userInfo) ? 'expired' : 'ok';
          const ms = panelExpiryMs(verdict.userInfo.exp_date);
          const newExp = ms !== null ? new Date(ms).toISOString().slice(0, 10) : null;
          if (newExp && (!exp || newExp > exp)) await recordLineExpiry(admin, row.panel_hostname, username, newExp);
        }
      }
      // Not asked (asked in the last 15 minutes) or no answer: the stored
      // expiry decides. A day already gone is over; the last day, or none
      // known, is not (the panel stays the real gate).
      if (decided === null) decided = exp && exp < today ? 'expired' : 'ok';
      if (decided === 'expired') return no('expired');
    }

    // 6. Used: when and how often. Never blocks the sign-in.
    try {
      const { error } = await admin.rpc('signin_pin_used', { p_id: row.id });
      if (error) console.warn('[pin-signin] use not recorded');
    } catch {
      console.warn('[pin-signin] use not recorded');
    }

    return jsonResponse({ ok: true, line: { server: panel.server, host: panel.host, username, password } });
  } catch (e) {
    console.error('[pin-signin] unexpected:', e instanceof Error ? e.name : 'error');
    return no('error');
  }
});
