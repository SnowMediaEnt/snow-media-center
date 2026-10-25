// Sign-in PINs for the hub and for the server's own hooks (owner, 2026-10-24;
// 20261025120000_signin_pins.sql). One 10-digit PIN per DreamStreams / Vibez
// line; customers type it in SMC's Live TV instead of the username and
// password (pin-signin). There is no password on a PIN row: pin-signin reads
// the line's newest password from customer_services / player_signins.
//
// verify_jwt = false: this function checks the caller itself.
//
// Admin (Authorization: Bearer <hub session>, has_role 'admin'):
//   { action:'list' }                         -> { ok:true, pins: [Pin] }  newest first, deleted ones left out
//   { action:'get', serviceId }               -> { ok:true, pin: Pin | null }  a customer_services line's
//                                                PIN (null: none yet, or deleted)
//   { action:'create', serviceId }            -> { ok:true, pin: Pin }  that line's PIN, made if it
//                                                has none (a deleted one comes back with new digits)
//   { action:'create', server, username, password }
//                                             -> { ok:true, pin: Pin }  a line typed in the hub
//                                                (server 'DreamStreams'|'Vibez'), checked once on
//                                                its panel and recorded in player_signins
//   { action:'new_pin', id }                  -> { ok:true, pin: Pin }  new digits, the old PIN stops
//                                                working (a deleted one comes back)
//   { action:'set_disabled', id, disabled }   -> { ok:true, pin: Pin }
//   { action:'delete', id }                   -> { ok:true }  soft: the row keeps its line, so no hook
//                                                or backfill gives the line a PIN again
//   { action:'ensure_missing' }               -> { ok:true, created, more }  a PIN for every line not
//                                                over that has none ("Create missing PINs")
// Internal (x-internal-secret = INTERNAL_FN_SECRET; capture-player-signin):
//   { action:'ensure', host, username, customer_id?, source? }
//                                             -> { ok:true, pin, created }  idempotent: a line that
//                                                has a PIN keeps it; pin null when it is off or deleted
// Refusals: { ok:false, reason } (HTTP 401 for a caller who may not). reason:
//   unauthorized | invalid | not_found | not_a_line | no_key | bad_key |
//   not_set_up | rate_limited | line_refused | panel_unreachable | error
//
// Pin = { id, server:'DreamStreams'|'Vibez', panel_hostname, panel_username,
//         customer_id, customer_name|null, pin (10 digits),
//         status:'working'|'expired'|'off', expires_at|null (the line's latest
//         expiry, YYYY-MM-DD), last_used_at|null, use_count, created_at, source }
//
// Never logged: a PIN, its HMAC, a username, a password.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { internalSecretOk, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';
import { decPin, pinHmacKey } from '../_shared/signinPin.ts';
import {
  PIN_COLUMNS, PIN_PANELS, cleanUsername, ensureLinePin, ensureMissingPins, lineExpiries, lineExpiry, lineKeyOf,
  missingTable, pinView, readAll, replacePin, serverHostname, serviceHostname,
  type EnsureResult, type PinHostname, type PinRow, type PinSource,
} from '../_shared/signinPinLines.ts';
import { panelExpiryMs, verifyPanelLine } from '../_shared/panelLine.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- typed values reject control bytes.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const MAX_BODY_BYTES = 8192;
// A line typed in the hub asks its panel: 30 per 10 minutes per hub login,
// and the line's own limit (player-login's key and numbers).
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const CREATE_MAX = 30;
const LINE_WINDOW_MS = 5 * 60 * 1000;
const LINE_MAX = 6;
// "Create missing PINs" stops in time to answer.
const ENSURE_MISSING_BUDGET_MS = 100_000;

class Refusal extends Error {
  constructor(readonly reason: string) { super(reason); }
}
function refuse(reason: string): never { throw new Refusal(reason); }
const dbRefusal = (e: unknown): never => refuse(missingTable(e as { code?: string }) ? 'not_set_up' : 'error');

function refuseEnsure(r: Extract<EnsureResult, { ok: false }>): never {
  if (r.reason === 'bad_line') refuse('not_a_line');
  if (r.reason === 'no_key' || r.reason === 'not_set_up') refuse(r.reason);
  refuse('error');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The admin's user id, or null for anyone else. */
async function adminCaller(admin: SupabaseClient, authHeader: string | null): Promise<string | null> {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role !== 'authenticated') return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    const { data: isAdmin, error: roleErr } = await admin.rpc('has_role', { _user_id: data.user.id, _role: 'admin' });
    if (roleErr || isAdmin !== true) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function customerNames(admin: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data } = await admin.from('customers').select('id, name, email').in('id', unique.slice(i, i + 200));
    for (const c of (data ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
      out.set(c.id, c.name || c.email || null);
    }
  }
  return out;
}

async function viewOf(admin: SupabaseClient, row: PinRow, plainPin?: string | null) {
  const pin = plainPin ?? await decPin(row.pin_enc);
  if (!pin) refuse('bad_key');
  const names = row.customer_id ? await customerNames(admin, [row.customer_id]) : new Map<string, string | null>();
  return pinView(row, pin, row.customer_id ? names.get(row.customer_id) ?? null : null, await lineExpiry(admin, row.line_key));
}

/** A PIN row by id; a deleted one only when `deleted` (new_pin brings it back). */
async function readPin(admin: SupabaseClient, id: unknown, deleted = false): Promise<PinRow> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) refuse('invalid');
  const { data, error } = await admin.from('signin_pins').select(PIN_COLUMNS).eq('id', id as string).maybeSingle();
  if (error) dbRefusal(error);
  const row = data as PinRow | null;
  if (!row || (row.deleted_at && !deleted)) refuse('not_found');
  return row as PinRow;
}

type ServiceLine = { customerId: string; hostname: PinHostname; username: string };

async function serviceLine(admin: SupabaseClient, serviceId: unknown): Promise<ServiceLine> {
  if (typeof serviceId !== 'string' || !UUID_RE.test(serviceId)) refuse('invalid');
  const { data, error } = await admin.from('customer_services')
    .select('id, customer_id, panel_host, panel_username, service_type')
    .eq('id', serviceId as string)
    .maybeSingle();
  if (error) refuse('error');
  if (!data) refuse('not_found');
  const s = data as { customer_id: string; panel_host: string | null; panel_username: string | null; service_type: string | null };
  const hostname = serviceHostname(s.panel_host, s.service_type);
  const username = cleanUsername(s.panel_username);
  if (!hostname || !username) refuse('not_a_line');
  return { customerId: s.customer_id, hostname: hostname!, username: username! };
}

async function list(admin: SupabaseClient) {
  if (!(await pinHmacKey())) refuse('no_key');
  const { rows, error } = await readAll<PinRow>((a, b) =>
    admin.from('signin_pins').select(PIN_COLUMNS).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id').range(a, b));
  if (error) dbRefusal(error);
  const names = await customerNames(admin, rows.map((r) => r.customer_id).filter((x): x is string => !!x));
  const expiries = await lineExpiries(admin, new Set(rows.map((r) => r.line_key)));
  const pins = [];
  for (const row of rows) {
    // An unreadable one (the key changed) is listed with pin null.
    pins.push(pinView(row, await decPin(row.pin_enc), row.customer_id ? names.get(row.customer_id) ?? null : null,
      expiries.get(row.line_key) ?? null));
  }
  return { ok: true, pins };
}

async function get(admin: SupabaseClient, serviceId: unknown) {
  const line = await serviceLine(admin, serviceId);
  const { data, error } = await admin.from('signin_pins').select(PIN_COLUMNS)
    .eq('line_key', lineKeyOf(line.hostname, line.username)).maybeSingle();
  if (error) dbRefusal(error);
  const row = data as PinRow | null;
  return { ok: true, pin: row && !row.deleted_at ? await viewOf(admin, row) : null };
}

async function create(admin: SupabaseClient, uid: string, body: Record<string, unknown>) {
  if (!(await pinHmacKey())) refuse('no_key');

  if (body.serviceId !== undefined) {
    const line = await serviceLine(admin, body.serviceId);
    const r = await ensureLinePin(admin, {
      host: line.hostname, username: line.username, customerId: line.customerId, source: 'hub', createdBy: uid, revive: true,
    });
    if (!r.ok) refuseEnsure(r);
    return { ok: true, pin: await viewOf(admin, r.row, r.pin) };
  }

  // A line typed in the hub: checked once on its panel, then recorded where
  // pin-signin reads a line's password (player_signins, as a capture is).
  const hostname = serverHostname(body.server);
  if (!hostname) refuse('invalid');
  const username = cleanUsername(body.username);
  if (!username) refuse('invalid');
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!password || password.length > 512 || CONTROL_CHARS.test(password)) refuse('invalid');
  const panel = PIN_PANELS[hostname!];
  const db = admin as unknown as ThrottleDb;
  if (!(await throttle(db, `signin-pins:${uid}`, CREATE_MAX, CREATE_WINDOW_MS, 'deny'))) refuse('rate_limited');
  if (!(await throttle(db, `line:${panel.panelHost}:${username!.toLowerCase()}`, LINE_MAX, LINE_WINDOW_MS, 'deny'))) {
    refuse('rate_limited');
  }
  const verdict = await verifyPanelLine(panel.panelHost, username!, password, 'signin-pins');
  if (verdict.kind === 'auth_failed') refuse('line_refused');
  if (verdict.kind === 'unreachable') refuse('panel_unreachable');
  const info = verdict.kind === 'ok' ? verdict.userInfo : {};
  const expMs = panelExpiryMs(info.exp_date);
  const maxConn = Number(info.max_connections);
  const trial = info.is_trial;
  const { error: recErr } = await admin.from('player_signins').upsert({
    panel_host: panel.panelHost,
    panel_username: username!.toLowerCase(),
    panel_password: password,
    server_label: panel.label,
    expiration_date: expMs !== null ? new Date(expMs).toISOString().slice(0, 10) : null,
    xtream_status: typeof info.status === 'string' ? info.status.slice(0, 256) : null,
    max_connections: Number.isFinite(maxConn) ? Math.max(0, Math.min(99, Math.trunc(maxConn))) : null,
    is_trial: trial === 1 || trial === '1' || trial === true,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'panel_host,panel_username' });
  if (recErr) refuse('error');

  const r = await ensureLinePin(admin, { host: hostname, username, source: 'hub', createdBy: uid, revive: true });
  if (!r.ok) refuseEnsure(r);
  return { ok: true, pin: await viewOf(admin, r.row, r.pin) };
}

/** New digits; the old PIN stops working. A deleted PIN comes back. */
async function newPin(admin: SupabaseClient, id: unknown) {
  if (!(await pinHmacKey())) refuse('no_key');
  const row = await readPin(admin, id, true);
  const r = await replacePin(admin, row.id, row.deleted_at ? { deleted_at: null } : {});
  if (!r.ok) refuseEnsure(r);
  return { ok: true, pin: await viewOf(admin, r.row, r.pin) };
}

async function setDisabled(admin: SupabaseClient, id: unknown, disabled: unknown) {
  if (typeof disabled !== 'boolean') refuse('invalid');
  const row = await readPin(admin, id);
  // Already so: nothing to write (an off PIN keeps the time it went off).
  if (!!row.disabled_at === disabled) return { ok: true, pin: await viewOf(admin, row) };
  const { data, error } = await admin.from('signin_pins')
    .update({ disabled_at: disabled ? new Date().toISOString() : null })
    .eq('id', row.id)
    .select(PIN_COLUMNS)
    .maybeSingle();
  if (error) refuse('error');
  if (!data) refuse('not_found');
  return { ok: true, pin: await viewOf(admin, data as PinRow) };
}

/** Soft: the row keeps its line_key, so no hook or backfill gives the line a PIN again. */
async function remove(admin: SupabaseClient, id: unknown) {
  const row = await readPin(admin, id);
  const { error } = await admin.from('signin_pins').update({ deleted_at: new Date().toISOString() }).eq('id', row.id);
  if (error) refuse('error');
  return { ok: true };
}

async function ensureMissing(admin: SupabaseClient) {
  const r = await ensureMissingPins(admin, { deadline: Date.now() + ENSURE_MISSING_BUDGET_MS });
  if (!r.ok) refuse(r.reason);
  return { ok: true, created: r.created, more: r.more };
}

const INTERNAL_SOURCES: readonly PinSource[] = ['line-created', 'site-provision', 'capture'];

async function ensureInternal(admin: SupabaseClient, body: Record<string, unknown>) {
  const source = INTERNAL_SOURCES.includes(body.source as PinSource) ? body.source as PinSource : 'line-created';
  const customerId = typeof body.customer_id === 'string' && UUID_RE.test(body.customer_id) ? body.customer_id : null;
  const r = await ensureLinePin(admin, { host: body.host, username: body.username, customerId, source });
  // A line whose PIN was deleted in the hub stays without one.
  if (!r.ok) return r.reason === 'deleted' ? { ok: true, pin: null, created: false } : { ok: false, reason: r.reason };
  return { ok: true, pin: r.row.disabled_at ? null : r.pin, created: r.created };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) return json({ ok: false, reason: 'error' });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, reason: 'invalid' });
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ ok: false, reason: 'invalid' });
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ ok: false, reason: 'invalid' });
  }

  try {
    // Server to server: the internal secret unlocks 'ensure' and nothing else.
    const provided = req.headers.get('x-internal-secret');
    if (provided !== null) {
      if (!internalSecretOk(provided, Deno.env.get('INTERNAL_FN_SECRET')) || body.action !== 'ensure') {
        return json({ ok: false, reason: 'unauthorized' }, 401);
      }
      return json(await ensureInternal(admin, body));
    }

    const uid = await adminCaller(admin, req.headers.get('Authorization'));
    if (!uid) return json({ ok: false, reason: 'unauthorized' }, 401);
    switch (body.action) {
      case 'list': return json(await list(admin));
      case 'get': return json(await get(admin, body.serviceId));
      case 'create': return json(await create(admin, uid, body));
      case 'new_pin': return json(await newPin(admin, body.id));
      case 'set_disabled': return json(await setDisabled(admin, body.id, body.disabled));
      case 'delete': return json(await remove(admin, body.id));
      case 'ensure_missing': return json(await ensureMissing(admin));
      default: return json({ ok: false, reason: 'invalid' });
    }
  } catch (e) {
    if (e instanceof Refusal) return json({ ok: false, reason: e.reason });
    console.error('[signin-pins] unexpected:', e instanceof Error ? e.name : 'error');
    return json({ ok: false, reason: 'error' });
  }
});
