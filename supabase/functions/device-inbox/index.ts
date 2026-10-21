// Device inbox: short messages from a Live TV line's owner (or support) to
// the Snow Media Center installs signed into that line. The TVs show them as
// a popup.
//
// POST JSON {action, ...}:
//
//   register {host, username, password, inbox_key, device_label?, app_version?}
//       a TV: no session. Each install makes its own private inbox key and
//       registers it with the line it is signed into. The line is signed in
//       to its panel first, the way capture-player-signin does it, so only a
//       box that knows the line's password can put itself on a line. The key
//       is kept as its sha256 (device_inbox.key_hash), never as it is; a key
//       that registers for another line moves there.
//       → {ok:true} | {ok:false, reason:'bad_request'|'bad_line'|'panel_unreachable'|'rate_limited'}
//   checkin {inbox_key, host, username, watching}
//       a TV: the key is the credential, and host + username name the line the
//       box is signed into now. A key registered for another line hears
//       other_line and gets nothing (nothing is stamped either) until it
//       registers again. Stamps last_seen_at at most every 5 minutes, and
//       watching_at while something plays (cleared when it stops). Hands over
//       up to 5 messages not yet closed, oldest first: new ones, and ones handed
//       over more than 5 minutes ago that the TV never closed (SMC shut before
//       OK was pressed). The app drops any it is already showing.
//       → {ok:true, messages:[{id, body, sender, created_at}]}
//         | {ok:false, reason:'unknown_key'|'other_line'} (the app then registers again)
//   dismiss {inbox_key, id}
//       a TV closed a message. Only that key's own messages. → {ok:true}
//   owner_status {inbox_key, host, username}
//       a TV on that line (its key registered there): whether the line has an
//       email on file (its customer's). Owning a line in the app rests on it,
//       so without one the app offers to send the message through support.
//       → {ok:true, email_on_file} | {ok:false, reason:'unknown_key'|'other_line'}
//   support_request {inbox_key, host, username, password, body}
//       a TV on a line with no email on file: a support ticket (under the
//       Player Reports account, as report-channel files guest tickets) asking
//       support to send `body` to the line's TVs. The password is checked
//       with the panel again (a key outlives a password change). 3 per line
//       an hour.
//       → {ok:true} | {ok:false, reason:'bad_body'|'email_on_file'|'rate_limited'|'bad_line'|
//                                   'panel_unreachable'|'unknown_key'|'other_line'}
//   line_devices {inbox_key, host, username, password}
//       a TV on that line (its key registered there) that also knows the
//       line's password, checked with the panel again (a key outlives a
//       password change): the TVs on the line seen in the last 30 days, the
//       way the owner sees them but without their refs (a TV can't send), and
//       this_tv on its own. All-Pro Streams has no Snow Media account, so this
//       is how its TVs see the line's other TVs. 20 per key and 60 per line an
//       hour, counted before the panel is asked.
//       → {ok:true, devices:[{label, app_version, last_seen_at, watching_now, registered_at, this_tv}]}
//         | {ok:false, reason:'rate_limited'|'bad_line'|'panel_unreachable'|'unknown_key'|'other_line'}
//   devices {host, username}
//       the line's owner or an admin (Authorization: Bearer <user JWT>): the
//       TVs on the line seen in the last 30 days, watching ones first.
//       → {ok:true, devices:[{ref, label, app_version, last_seen_at, watching_now, registered_at}]}
//   send {host, username, refs: string[] | 'all', body}
//       same callers: a 1-200 character message to the line's TVs: those
//       picked (seen in the last 30 days), or all of them seen in the last 7.
//       At most 10 sends per line an hour, however many TVs each reaches.
//       → {ok:true, sent:n} | {ok:false, reason:'bad_body'|'rate_limited'}
//
// The owner of a line is the signed-in account whose customers row
// (customers.user_id) is the line's player_signins.matched_customer_id, the
// link capture-player-signin keeps. Admins are has_role 'admin'. No session
// → 401 not_signed_in; neither → 403 not_owner. Malformed requests and
// unknown actions → 400 bad_request; other refusals are HTTP 200 with
// {ok:false, reason} so a box can read them.
//
// Register attempts are limited per key, per line and per IP in
// player_login_throttle (_shared/requestGuard.ts) before the panel is asked:
// this must not become a way to try passwords against a panel.
//
// verify_jwt = false (see supabase/config.toml): the TVs have no session;
// devices and send check the caller's JWT here. Nothing here logs an inbox
// key, a password or a message.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { clientIp, hashIp, logIpHeadersOnce, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';
import { playerReportsUserId } from '../_shared/playerReports.ts';

// The service-role client as this file makes it (ReturnType<typeof
// createClient> alone resolves to a client the one made here does not fit;
// see player-favorites).
const serviceClient = (url: string, key: string) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Db = ReturnType<typeof serviceClient>;
type Body = Record<string, unknown>;
type Line = { host: string; username: string; typed: string };

// The panels capture-player-signin accepts, so a line here is named the way
// player_signins names it (which is how ownership is decided).
const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'strmz.xyz'] as const;
/** The servers as support knows them (the admin "Line devices" tab's buttons). */
const SERVER_NAMES: Record<string, string> = { 'dstreams.xyz:8080': 'DreamStreams', 'strmz.xyz': 'Vibez' };

const MAX_BODY_BYTES = 8192;
const HOUR_MS = 60 * 60 * 1000;
const REGISTER_PER_KEY_PER_HOUR = 10;
// A household's TVs register on sign-in and when a check-in says the key is
// unknown; wrong passwords count too, so this is also the password guard.
const REGISTER_PER_LINE_PER_HOUR = 30;
const REGISTER_PER_IP_PER_HOUR = 60;
// Per send, not per TV: a busy family line's "all" is one send.
const SENDS_PER_LINE_PER_HOUR = 10;
const SEEN_WITHIN_MS = 30 * 24 * HOUR_MS;
/** "All" is the TVs in use lately, not every box that ever signed in. */
const SEND_ALL_WITHIN_MS = 7 * 24 * HOUR_MS;
const WATCHING_WITHIN_MS = 5 * 60 * 1000;
/** last_seen_at is written at most this often (a box checks in every 2 minutes). */
const STAMP_EVERY_MS = 5 * 60 * 1000;
/** While a TV plays, watching_at is kept fresher than this, well inside WATCHING_WITHIN_MS. */
const WATCHING_STAMP_MS = 90 * 1000;
/** A message handed over but never closed is handed over again after this long. */
const REDELIVER_AFTER_MS = 5 * 60 * 1000;
const MESSAGES_PER_CHECKIN = 5;
const MAX_MESSAGE_CHARS = 200;
const MAX_LABEL_CHARS = 60;
const MAX_VERSION_CHARS = 20;
const MAX_DEVICES = 100;
// Every ticket reaches Discord, the admin inbox and the admins' phones.
const SUPPORT_REQUESTS_PER_LINE_PER_HOUR = 3;
const SUPPORT_REQUESTS_PER_HOUR = 30;
// Each one asks the panel: opening the list now and then, never a loop.
const TV_LISTS_PER_KEY_PER_HOUR = 20;
const TV_LISTS_PER_LINE_PER_HOUR = 60;

const INBOX_KEY = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- the point is to reject control characters
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const badRequest = () => json({ ok: false, reason: 'bad_request' }, 400);
const serverError = () => json({ ok: false, reason: 'error' }, 500);

const sha256 = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Same as capture-player-signin's normalizeHost. */
const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

/** The line a request names: null when malformed, 'not_ours' for a panel
 *  that is not on the allowlist. The username is kept as typed for the
 *  panel and lowercased to name the line (as capture-player-signin does). */
function lineOf(body: Body): Line | 'not_ours' | null {
  const host = normalizeHost(body.host);
  const typed = typeof body.username === 'string' ? body.username.trim() : '';
  if (!host || !typed || typed.length > 256 || CONTROL_CHARS.test(typed)) return null;
  if (!ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) return 'not_ours';
  return { host, typed, username: typed.toLowerCase() };
}

/** A label or version: control characters out, spaces collapsed, cut to `max` characters. */
const shortText = (v: string, max: number): string =>
  // eslint-disable-next-line no-control-regex -- the point is to drop control characters
  Array.from(v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();

/** A message: line breaks kept, other control characters dropped, trimmed;
 *  null unless 1..200 characters (counted as Postgres char_length counts). */
function messageText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex -- the point is to drop control characters
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  const n = Array.from(s).length;
  return n >= 1 && n <= MAX_MESSAGE_CHARS ? s : null;
}

// ── panel verification (mirrors capture-player-signin / player-login) ───────

const REQUEST_TIMEOUT_MS = 12_000;
/** Every attempt gets its own timeout; this caps the search as a whole. */
const TOTAL_BUDGET_MS = 20_000;
// Ports a panel is commonly served over TLS on.
const TLS_PORTS = new Set(['443', '2053', '2083', '2087', '2096', '8443']);

/** Base URLs to try for a panel, best first (see player-login). */
function panelBases(rawHost: string): string[] {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/(.+)$/i.exec(trimmed);
  const bare = (m ? m[2] : trimmed).replace(/\/+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1];
  const first = m ? m[1].toLowerCase() : (port ? (TLS_PORTS.has(port) ? 'https' : 'http') : 'https');
  const second = first === 'https' ? 'http' : 'https';
  return [`${first}://${bare}`, `${second}://${bare}`];
}

// cPanel-style ports serve the panel's login page, not its player API: try
// the streaming ports on the same hostname too.
const PANEL_ONLY_PORTS = new Set(['2082', '2083', '2086', '2087']);
const STREAM_FALLBACKS: Array<[string, string]> = [
  ['http', '8080'], ['https', '2096'], ['http', '8000'], ['http', '25461'],
];

/** Every base worth trying for this host, best first, de-duplicated. */
function candidateBases(rawHost: string): string[] {
  const out: string[] = [];
  const push = (b: string) => { if (!out.includes(b)) out.push(b); };
  for (const b of panelBases(rawHost)) push(b);
  const bare = rawHost.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const name = bare.replace(/:\d+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1] ?? '';
  if (name && (!port || PANEL_ONLY_PORTS.has(port))) {
    for (const [scheme, p] of STREAM_FALLBACKS) push(`${scheme}://${name}:${p}`);
  }
  return out;
}

// Agents a panel's gateway lets through; decided from the BODY, since a
// gateway's HTML 401 is not a wrong password (see player-login).
const PANEL_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)',
  'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
  'VLC/3.0.20 LibVLC/3.0.20',
  'okhttp/4.12.0',
];

/** The panel's player_api user_info.auth for this line. An expired line
 *  still answers auth 1: it is still that line. */
async function verifyLine(host: string, username: string, password: string): Promise<'ok' | 'auth_failed' | 'unreachable'> {
  const query = `/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const base of candidateBases(host)) {
    for (const ua of PANEL_AGENTS) {
      if (Date.now() > deadline) break;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let text: string;
      try {
        const res = await fetch(base + query, { signal: ctrl.signal, headers: { 'User-Agent': ua, Accept: 'application/json' } });
        text = (await res.text()).trim();
      } catch {
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!text.startsWith('{')) continue;
      let data: unknown;
      try { data = JSON.parse(text); } catch { continue; }
      const ui = (data as { user_info?: Record<string, unknown> })?.user_info;
      if (!ui || typeof ui !== 'object') continue;
      const auth = ui.auth;
      return auth === 1 || auth === '1' || auth === true ? 'ok' : 'auth_failed';
    }
  }
  console.warn('[device-inbox] no JSON from any base or agent — wrong host, or a gateway block?');
  return 'unreachable';
}

// ── the TV side ─────────────────────────────────────────────────────────────

async function register(admin: Db, req: Request, body: Body): Promise<Response> {
  const inboxKey = typeof body.inbox_key === 'string' ? body.inbox_key : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const line = lineOf(body);
  if (!INBOX_KEY.test(inboxKey) || !line || !password || password.length > 512) return badRequest();
  if (line === 'not_ours') return json({ ok: false, reason: 'bad_line' });
  const keyHash = await sha256(inboxKey);

  // Limits first, so a wrong password costs a try before the panel is asked.
  logIpHeadersOnce('device-inbox', req.headers);
  const ipHash = await hashIp(clientIp(req.headers));
  const db = admin as unknown as ThrottleDb;
  if (!(await throttle(db, `dib:key:${keyHash}`, REGISTER_PER_KEY_PER_HOUR, HOUR_MS))
    || !(await throttle(db, `dib:line:${line.host}:${line.username}`, REGISTER_PER_LINE_PER_HOUR, HOUR_MS))
    || !(await throttle(db, ipHash && `dib:ip:${ipHash}`, REGISTER_PER_IP_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }

  const verdict = await verifyLine(line.host, line.typed, password);
  if (verdict === 'auth_failed') return json({ ok: false, reason: 'bad_line' });
  if (verdict === 'unreachable') return json({ ok: false, reason: 'panel_unreachable' });

  // New, or moved from another line: it starts over on this one.
  const { data: existing, error: readErr } = await admin.from('device_inbox')
    .select('panel_host, panel_username').eq('key_hash', keyHash).maybeSingle();
  if (readErr) {
    console.error('[device-inbox] register read failed:', readErr.message);
    return serverError();
  }
  const prev = existing as { panel_host?: string; panel_username?: string } | null;
  const moved = !prev || prev.panel_host !== line.host || prev.panel_username !== line.username;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { key_hash: keyHash, panel_host: line.host, panel_username: line.username, last_seen_at: now };
  if (moved) Object.assign(row, { registered_at: now, watching_at: null });
  // Optional: a box that leaves one out keeps what it sent before.
  if (typeof body.device_label === 'string') row.device_label = shortText(body.device_label, MAX_LABEL_CHARS);
  if (typeof body.app_version === 'string') row.app_version = shortText(body.app_version, MAX_VERSION_CHARS);
  const { error } = await admin.from('device_inbox').upsert(row, { onConflict: 'key_hash' });
  if (error) {
    console.error('[device-inbox] register failed:', error.message);
    return serverError();
  }
  return json({ ok: true });
}

type Device = {
  id: string; panel_host: string; panel_username: string;
  last_seen_at?: string | null; watching_at?: string | null; device_label?: string | null; app_version?: string | null;
};

/** The device an inbox key belongs to; 'bad' for a malformed key. Throws on a DB error. */
async function deviceForKey(admin: Db, raw: unknown): Promise<Device | null | 'bad'> {
  const inboxKey = typeof raw === 'string' ? raw : '';
  if (!INBOX_KEY.test(inboxKey)) return 'bad';
  const { data, error } = await admin.from('device_inbox')
    .select('id, panel_host, panel_username, last_seen_at, watching_at, device_label, app_version')
    .eq('key_hash', await sha256(inboxKey)).maybeSingle();
  if (error) throw new Error(`device lookup: ${error.message}`);
  return (data as Device | null) ?? null;
}

/**
 * A TV asking about the line it names: its key must be registered on that
 * line. A box signed into another line than the one its key is on hears
 * other_line, and nothing of the old line's, until it registers on the new one.
 */
async function tvOnLine(admin: Db, body: Body): Promise<{ device: Device; line: Line } | Response> {
  const line = lineOf(body);
  if (!line) return badRequest();
  const device = await deviceForKey(admin, body.inbox_key);
  if (device === 'bad') return badRequest();
  if (!device) return json({ ok: false, reason: 'unknown_key' });
  if (line === 'not_ours' || line.host !== device.panel_host || line.username !== device.panel_username) {
    return json({ ok: false, reason: 'other_line' });
  }
  return { device, line };
}

async function checkin(admin: Db, body: Body): Promise<Response> {
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  const { device } = tv;

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const age = (t: string | null | undefined): number => {
    const at = t ? Date.parse(t) : NaN;
    return Number.isFinite(at) ? nowMs - at : Infinity;
  };
  // Written only when the owner's list would show something different.
  const watching = body.watching === true;
  let stamp: Record<string, string | null> | null = null;
  if (watching && age(device.watching_at) > WATCHING_STAMP_MS) stamp = { last_seen_at: now, watching_at: now };
  else if (!watching && age(device.watching_at) <= WATCHING_WITHIN_MS) stamp = { last_seen_at: now, watching_at: null };
  else if (age(device.last_seen_at) > STAMP_EVERY_MS) stamp = { last_seen_at: now };
  if (stamp) await admin.from('device_inbox').update(stamp).eq('id', device.id);

  // Not closed yet, and either never handed over or handed over a while ago
  // (the TV may have been switched off before OK). Only messages sent to the
  // line the box is on now.
  const cutoff = new Date(nowMs - REDELIVER_AFTER_MS).toISOString();
  const { data: waiting, error } = await admin.from('device_messages')
    .select('id, delivered_at')
    .eq('device_id', device.id).eq('panel_host', device.panel_host).eq('panel_username', device.panel_username)
    .is('dismissed_at', null).gt('expires_at', now).or(`delivered_at.is.null,delivered_at.lt."${cutoff}"`)
    .order('created_at', { ascending: true }).limit(MESSAGES_PER_CHECKIN);
  if (error) {
    console.error('[device-inbox] checkin read failed:', error.message);
    return serverError();
  }
  const rows = (waiting ?? []) as Array<{ id: string; delivered_at: string | null }>;
  if (!rows.length) return json({ ok: true, messages: [] });

  // Stamped only while still not held, and handed over only if this call
  // stamped it: two check-ins at once never both get a message. Two plain
  // updates (new ones, ones handed over before): PostgREST refuses an or()
  // filter on an update ("column device_messages.delivered_at does not exist").
  const take = (ids: string[], held: boolean) => {
    const q = admin.from('device_messages').update({ delivered_at: now })
      .in('id', ids).eq('device_id', device.id).is('dismissed_at', null);
    return (held ? q.lt('delivered_at', cutoff) : q.is('delivered_at', null)).select('id, body, sender, created_at');
  };
  const fresh = rows.filter((r) => !r.delivered_at).map((r) => r.id);
  const again = rows.filter((r) => r.delivered_at).map((r) => r.id);
  const results = await Promise.all([fresh.length ? take(fresh, false) : null, again.length ? take(again, true) : null]);
  const takeErr = results.find((r) => r?.error)?.error;
  if (takeErr) {
    console.error('[device-inbox] checkin mark failed:', takeErr.message);
    return serverError();
  }
  const taken = results.flatMap((r) => (r?.data ?? []) as unknown[]);
  const messages = ((taken ?? []) as Array<{ id: string; body: string; sender: string; created_at: string }>)
    .map((m) => ({ id: m.id, body: m.body, sender: m.sender, created_at: m.created_at }))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  return json({ ok: true, messages });
}

async function dismiss(admin: Db, body: Body): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID.test(id)) return badRequest();
  const device = await deviceForKey(admin, body.inbox_key);
  if (device === 'bad') return badRequest();
  if (!device) return json({ ok: false, reason: 'unknown_key' });
  const { error } = await admin.from('device_messages')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id).eq('device_id', device.id).is('dismissed_at', null);
  if (error) {
    console.error('[device-inbox] dismiss failed:', error.message);
    return serverError();
  }
  return json({ ok: true });
}

/** Whether the line's customer has an email on file: what owning the line in the app rests on. Throws on a DB error. */
async function emailOnFile(admin: Db, line: Line): Promise<boolean> {
  const { data: signin, error } = await admin.from('player_signins')
    .select('matched_customer_id').eq('panel_host', line.host).eq('panel_username', line.username).maybeSingle();
  if (error) throw new Error(`signin lookup: ${error.message}`);
  const customerId = (signin as { matched_customer_id?: string | null } | null)?.matched_customer_id;
  if (typeof customerId !== 'string' || !customerId) return false;
  const { data: customer, error: custErr } = await admin.from('customers').select('email').eq('id', customerId).maybeSingle();
  if (custErr) throw new Error(`customer lookup: ${custErr.message}`);
  const email = (customer as { email?: string | null } | null)?.email;
  return typeof email === 'string' && email.includes('@');
}

async function ownerStatus(admin: Db, body: Body): Promise<Response> {
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  return json({ ok: true, email_on_file: await emailOnFile(admin, tv.line) });
}

/** For a ticket: the backticks out, so nothing breaks out of Discord's code block (notify-ticket). */
const ticketText = (v: string): string => v.replace(/`/g, "'");

async function supportRequest(admin: Db, req: Request, body: Body): Promise<Response> {
  const text = messageText(body.body);
  if (text === null) return json({ ok: false, reason: 'bad_body' }, 400);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 512) return badRequest();
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  const { device, line } = tv;
  // A line with an email on file has an owner who can send it (signed in).
  if (await emailOnFile(admin, line)) return json({ ok: false, reason: 'email_on_file' });
  // Per line first: one line asking too often never uses up everyone's hour.
  const db = admin as unknown as ThrottleDb;
  if (!(await throttle(db, `dih:line:${line.host}:${line.username}`, SUPPORT_REQUESTS_PER_LINE_PER_HOUR, HOUR_MS))
    || !(await throttle(db, 'dih:all', SUPPORT_REQUESTS_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }
  // The key was registered with the line's password once; it may have changed since.
  logIpHeadersOnce('device-inbox', req.headers);
  const verdict = await verifyLine(line.host, line.typed, password);
  if (verdict === 'auth_failed') return json({ ok: false, reason: 'bad_line' });
  if (verdict === 'unreachable') return json({ ok: false, reason: 'panel_unreachable' });

  const userId = await playerReportsUserId(admin as unknown as Parameters<typeof playerReportsUserId>[0]);
  const server = SERVER_NAMES[line.host] ?? line.host;
  const from = ticketText(device.device_label || 'a TV');
  // What support needs first (and what the push and Discord previews show);
  // the TV's own words last, quoted, so they can't pass for these lines.
  const message = [
    `Line: ${ticketText(line.typed)} (${server}). It has no email on file, so its owner can't message its TVs from the app; a TV on the line asks support to send this message to them.`,
    `To send it: Support dashboard → Line devices, username ${ticketText(line.typed)}, server ${server}. Pick all the TVs, or the ones the message names. The TVs show it as "Message from Snow Media": send it only if it reads right.`,
    `Asked from: ${from}${device.app_version ? `, Snow Media Center ${ticketText(device.app_version)}` : ''}`,
    '',
    'Message (typed on the TV, not checked):',
    ...ticketText(text).split('\n').map((l) => `> ${l}`),
  ].join('\n');
  const { data: ticket, error: ticketErr } = await admin.from('support_tickets')
    .insert({ user_id: userId, subject: `[Line Message] Send to the TVs on ${ticketText(line.typed)}`.slice(0, 200), status: 'open', priority: 'normal', admin_has_unread: true })
    .select('id').single();
  if (ticketErr || !ticket) {
    console.error('[device-inbox] support ticket failed:', ticketErr?.message ?? 'no row');
    return serverError();
  }
  const ticketId = (ticket as { id: string }).id;
  // notify-ticket runs on the ticket's first message (notify_ticket_on_first_message).
  const { error: msgErr } = await admin.from('support_messages')
    .insert({ ticket_id: ticketId, user_id: userId, sender_type: 'user', message });
  if (msgErr) {
    console.error('[device-inbox] support message failed:', msgErr.message);
    // No empty ticket left behind (nobody was told about it).
    await admin.from('support_tickets').delete().eq('id', ticketId);
    return serverError();
  }
  return json({ ok: true });
}

type LineDevice = { ref: string; label: string; app_version: string; last_seen_at: string; watching_now: boolean; registered_at: string };

/** The TVs on a line seen in the last 30 days, watching ones first, then the latest seen. Null on a DB error. */
async function lineDevices(admin: Db, line: Line): Promise<LineDevice[] | null> {
  const { data, error } = await admin.from('device_inbox')
    .select('id, device_label, app_version, last_seen_at, watching_at, registered_at')
    .eq('panel_host', line.host).eq('panel_username', line.username)
    .gte('last_seen_at', new Date(Date.now() - SEEN_WITHIN_MS).toISOString())
    .order('last_seen_at', { ascending: false }).limit(MAX_DEVICES);
  if (error) {
    console.error('[device-inbox] devices failed:', error.message);
    return null;
  }
  const nowMs = Date.now();
  type Row = { id: string; device_label: string | null; app_version: string | null; last_seen_at: string; watching_at: string | null; registered_at: string };
  return ((data ?? []) as Row[])
    .map((d) => ({
      ref: d.id,
      label: d.device_label ?? '',
      app_version: d.app_version ?? '',
      last_seen_at: d.last_seen_at,
      watching_now: !!d.watching_at && nowMs - Date.parse(d.watching_at) <= WATCHING_WITHIN_MS,
      registered_at: d.registered_at,
    }))
    .sort((a, b) => Number(b.watching_now) - Number(a.watching_now) || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at));
}

async function tvLineDevices(admin: Db, req: Request, body: Body): Promise<Response> {
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 512) return badRequest();
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  const { device, line } = tv;
  // Limits first, so the panel is never asked in a loop.
  const db = admin as unknown as ThrottleDb;
  if (!(await throttle(db, `dil:key:${device.id}`, TV_LISTS_PER_KEY_PER_HOUR, HOUR_MS))
    || !(await throttle(db, `dil:line:${line.host}:${line.username}`, TV_LISTS_PER_LINE_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }
  logIpHeadersOnce('device-inbox', req.headers);
  const verdict = await verifyLine(line.host, line.typed, password);
  if (verdict === 'auth_failed') return json({ ok: false, reason: 'bad_line' });
  if (verdict === 'unreachable') return json({ ok: false, reason: 'panel_unreachable' });
  const devices = await lineDevices(admin, line);
  if (!devices) return serverError();
  return json({ ok: true, devices: devices.map(({ ref, ...d }) => ({ ...d, this_tv: ref === device.id })) });
}

// ── the owner / admin side ──────────────────────────────────────────────────

/** The line's player_signins row names a customer whose account is the caller. */
async function ownsLine(admin: Db, userId: string, line: Line): Promise<boolean> {
  const { data: signin, error } = await admin.from('player_signins')
    .select('matched_customer_id').eq('panel_host', line.host).eq('panel_username', line.username).maybeSingle();
  const customerId = (signin as { matched_customer_id?: string | null } | null)?.matched_customer_id;
  if (error || typeof customerId !== 'string' || !customerId) return false;
  const { data: customer, error: custErr } = await admin.from('customers')
    .select('id').eq('id', customerId).eq('user_id', userId).maybeSingle();
  return !custErr && !!customer;
}

async function lineAction(admin: Db, req: Request, action: 'devices' | 'send', body: Body): Promise<Response> {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let caller: { id: string } | null = null;
  if (bearer) {
    try {
      const { data } = await admin.auth.getUser(bearer);
      caller = data?.user ?? null;
    } catch {
      caller = null;
    }
  }
  if (!caller) return json({ ok: false, reason: 'not_signed_in' }, 401);
  const callerId = caller.id;

  const line = lineOf(body);
  if (!line || line === 'not_ours') return badRequest();

  // What a send carries, checked before anyone is looked up.
  let text: string | null = null;
  let refs: string[] | 'all' = 'all';
  if (action === 'send') {
    text = messageText(body.body);
    if (text === null) return json({ ok: false, reason: 'bad_body' }, 400);
    if (body.refs !== 'all') {
      const list = body.refs;
      if (!Array.isArray(list) || !list.length || list.length > MAX_DEVICES
        || !list.every((r) => typeof r === 'string' && UUID.test(r))) return badRequest();
      refs = [...new Set((list as string[]).map((r) => r.toLowerCase()))];
    }
  }

  const { data: adminFlag } = await admin.rpc('has_role', { _user_id: callerId, _role: 'admin' });
  const isAdmin = adminFlag === true;
  if (!isAdmin && !(await ownsLine(admin, callerId, line))) return json({ ok: false, reason: 'not_owner' }, 403);

  const seenSince = (ms: number) => new Date(Date.now() - ms).toISOString();

  if (action === 'devices') {
    const devices = await lineDevices(admin, line);
    return devices ? json({ ok: true, devices }) : serverError();
  }

  // send: only the line's own TVs; picked ones seen in the last 30 days, "all"
  // the ones seen in the last 7.
  const targetsQuery = admin.from('device_inbox')
    .select('id').eq('panel_host', line.host).eq('panel_username', line.username)
    .gte('last_seen_at', seenSince(refs === 'all' ? SEND_ALL_WITHIN_MS : SEEN_WITHIN_MS));
  const { data: targets, error: targetErr } = refs === 'all'
    ? await targetsQuery.limit(MAX_DEVICES)
    : await targetsQuery.in('id', refs).limit(MAX_DEVICES);
  if (targetErr) {
    console.error('[device-inbox] send lookup failed:', targetErr.message);
    return serverError();
  }
  const ids = ((targets ?? []) as Array<{ id: string }>).map((t) => t.id);
  if (!ids.length) return json({ ok: true, sent: 0 });

  // 10 sends an hour per line, counted only for a send that reaches a TV.
  if (!(await throttle(admin as unknown as ThrottleDb, `dim:send:${line.host}:${line.username}`, SENDS_PER_LINE_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }

  const sender = isAdmin ? 'admin' : 'owner';
  const { error: insErr } = await admin.from('device_messages').insert(ids.map((deviceId) => ({
    device_id: deviceId, panel_host: line.host, panel_username: line.username, body: text, sender, created_by: callerId,
  })));
  if (insErr) {
    console.error('[device-inbox] send failed:', insErr.message);
    return serverError();
  }
  return json({ ok: true, sent: ids.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'bad_request' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ ok: false, reason: 'config' }, 500);

  let body: Body;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return badRequest();
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return badRequest();
    body = parsed as Body;
  } catch {
    return badRequest();
  }

  const admin = serviceClient(url, serviceKey);
  try {
    const action = body.action;
    switch (action) {
      case 'register': return await register(admin, req, body);
      case 'checkin': return await checkin(admin, body);
      case 'dismiss': return await dismiss(admin, body);
      case 'owner_status': return await ownerStatus(admin, body);
      case 'support_request': return await supportRequest(admin, req, body);
      case 'line_devices': return await tvLineDevices(admin, req, body);
      case 'devices':
      case 'send': return await lineAction(admin, req, action, body);
      default: return badRequest();
    }
  } catch (e) {
    console.error('[device-inbox] unexpected:', e instanceof Error ? e.message : 'unknown');
    return serverError();
  }
});
