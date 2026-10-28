// A customer's own sign-in PIN, from inside SMC (owner, 2026-10-26).
//
// A box already signed in to Live TV (DreamStreams or Vibez) asks for its line's
// 10-digit PIN so the customer can save it and sign in on their other devices
// with it (pin-signin). The box proves it has the line by sending the line's
// username and password, which are checked on the line's panel first — the PIN
// is no more than what the caller already holds. One PIN per line, shared by
// every device on it: a line that has one gets the same digits back; a line
// without one gets one made now (source 'capture', as a player sign-in does).
//
//   POST { host, username, password }
//     -> { ok:true, pin:'1234567890', created:boolean, expires_at:'YYYY-MM-DD'|null }
//     -> { ok:false, reason }
//   reason: invalid | rate_limited | line_refused | expired | panel_unreachable |
//           pin_off (switched off or deleted in the hub; the hub brings it back) |
//           not_set_up | no_key | error
//
// verify_jwt = false (the line is the credential). Throttled per address and
// per line before the panel is asked, fail closed. The panel's answer is
// recorded in player_signins like any sign-in, so pin-signin reads the newest
// password. Never logged: a PIN, a username, a password.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { clientIp, hashIp, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';
import { PIN_PANELS, cleanUsername, ensureLinePin, lineExpiry, pinHostname } from '../_shared/signinPinLines.ts';
import { panelExpiryMs, panelSaysOver, verifyPanelLine } from '../_shared/panelLine.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const no = (reason: string) => json({ ok: false, reason });

// eslint-disable-next-line no-control-regex -- typed values reject control bytes.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_BODY_BYTES = 4096;
// An address: 10 asks per 10 minutes (a household with a few TVs, with room
// to spare). A line: 6 per 5 minutes (player-login's numbers).
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 10;
const LINE_WINDOW_MS = 5 * 60 * 1000;
const LINE_MAX = 6;

/** pin-signin's address bucket: an IPv6 /64 counts as its /48. */
function addressBucket(ip: string | null): string | null {
  if (!ip) return null;
  const v6 = /^([0-9a-f]+):([0-9a-f]+):([0-9a-f]+):[0-9a-f]+::\/64$/i.exec(ip);
  return v6 ? `${v6[1]}:${v6[2]}:${v6[3]}::/48` : ip;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return no('invalid');
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return no('invalid');
    body = parsed as Record<string, unknown>;
  } catch {
    return no('invalid');
  }

  const hostname = pinHostname(body.host);
  const username = cleanUsername(body.username);
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!hostname || !username || !password || password.length > 512 || CONTROL_CHARS.test(password)) return no('invalid');
  const panel = PIN_PANELS[hostname];

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!url || !serviceKey) return no('error');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const db = admin as unknown as ThrottleDb;

    // 1. Throttle before anything reaches the panel: this address, then this line.
    const ipHash = await hashIp(addressBucket(clientIp(req.headers))).catch(() => null);
    if (!(await throttle(db, `my-pin:${ipHash ?? 'ip:unknown'}`, IP_MAX, IP_WINDOW_MS, 'deny'))) return no('rate_limited');
    const lineHash = (await hashIp(`${panel.panelHost}:${username.toLowerCase()}`).catch(() => null)) ?? 'unknown';
    if (!(await throttle(db, `my-pin:line:${lineHash}`, LINE_MAX, LINE_WINDOW_MS, 'deny'))) return no('rate_limited');

    // 2. The line has to be this one, and still running.
    const verdict = await verifyPanelLine(panel.panelHost, username, password, 'my-signin-pin');
    if (verdict.kind === 'auth_failed') return no('line_refused');
    if (verdict.kind === 'unreachable') return no('panel_unreachable');
    const info = verdict.kind === 'ok' ? verdict.userInfo : {};
    if (panelSaysOver(info)) return no('expired');

    // 3. Recorded like any sign-in, so pin-signin hands out this password.
    const expMs = panelExpiryMs(info.exp_date);
    const maxConn = Number(info.max_connections);
    const trial = info.is_trial;
    const { error: recErr } = await admin.from('player_signins').upsert({
      panel_host: panel.panelHost,
      panel_username: username.toLowerCase(),
      panel_password: password,
      server_label: panel.label,
      expiration_date: expMs !== null ? new Date(expMs).toISOString().slice(0, 10) : null,
      xtream_status: typeof info.status === 'string' ? info.status.slice(0, 256) : null,
      max_connections: Number.isFinite(maxConn) ? Math.max(0, Math.min(99, Math.trunc(maxConn))) : null,
      is_trial: trial === 1 || trial === '1' || trial === true,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'panel_host,panel_username' });
    if (recErr) return no('error');

    // 4. The line's PIN: the same digits if it has one, else a new one.
    const r = await ensureLinePin(admin, { host: hostname, username, source: 'capture' });
    if (!r.ok) {
      if (r.reason === 'deleted') return no('pin_off');
      if (r.reason === 'no_key' || r.reason === 'not_set_up') return no(r.reason);
      return no('error');
    }
    if (r.row.disabled_at) return no('pin_off');
    if (!r.pin) return no('no_key');
    return json({ ok: true, pin: r.pin, created: r.created, expires_at: await lineExpiry(admin, r.row.line_key) });
  } catch (e) {
    console.error('[my-signin-pin] unexpected:', e instanceof Error ? e.name : 'error');
    return no('error');
  }
});
