// Device health: what goes wrong on a Snow Media Center box, as the box saw
// it (stalls, player errors, crashes, the app killed, the panel refusing the
// line), and a 7-day deep check an admin switches on per box. Spec:
// DEVICE-HEALTH-SPEC.md (2026-10-28); tables in 20261028120000_device_health.sql.
//
// POST JSON {action, ...}:
//
//   report {inbox_key, host, username, app_version, version_code, device_model, os_version, events}
//       a TV: its device-inbox key is the credential (the same rule as
//       device-inbox checkin: a key not registered → unknown_key, registered
//       for another line → other_line). Up to 20 events per call, each at most
//       4 KB. Strings that look like a URL, a query string with a password /
//       token / username, or an IP address are dropped before anything is
//       stored. A box keeps at most 300 events a day, and at most 40 of them
//       while it is not in a deep check; app_start / sample are kept only in a
//       deep check. Events over a cap or malformed are dropped silently but
//       still counted in `accepted`, so the box never sends them again.
//       A customer-run 30-second check (kind 'check') may carry `samples`
//       (<= 30 rows of <= 8 numbers; ignored on other kinds), may be up to
//       12 KB, works without a deep check, and has its own cap of 6 per box a
//       day (it does not count against the 300 / 40). `ids` lines up with the
//       events sent: the stored event's id, or null for one that was dropped,
//       so the app can quote "Device check: <id>" in a report.
//       → {ok:true, accepted:n, ids:(string|null)[], deep_until: string|null}
//         | {ok:false, reason:'bad_request'|'unknown_key'|'other_line'|'rate_limited'}
//   status {inbox_key, host, username}
//       a TV asks (at start and every 10 minutes) whether it is in a deep check.
//       → {ok:true, deep_until: string|null} | {ok:false, reason: as report}
//
//   Admins (Authorization: Bearer <user JWT>, has_role 'admin', as device-inbox):
//   admin_set_deep {device_ref | key_hash, days?: 1..14 (7)}  → {ok:true, device_ref, deep_until}
//   admin_stop_deep {device_ref | key_hash}                    → {ok:true, device_ref, deep_until:null}
//       device_ref is the device_inbox row id device-inbox `devices` hands out.
//       An unknown box → {ok:false, reason:'unknown_device'}.
//   admin_events {host?, username?, customer_id?, device_ref?, since?, kind?, verdict?, limit?<=500 (100)}
//       → {ok:true, events:[{id, device_ref, label, host, username, customer_id, app_version,
//           version_code, device_model, os_version, kind, verdict, summary, context, title, data,
//           samples, deep, occurred_at, created_at}]} newest first
//   admin_event {id}  → {ok:true, event} (shaped as in admin_events) | {ok:false, reason:'not_found'}
//   admin_devices {host?, username?, customer_id?}
//       → {ok:true, devices:[{device_ref, label, host, username, customer_id, customer_name,
//           app_version, model, last_seen, deep_until, counts:{verdict:n}, problems_7d,
//           problems_30d, last_event:{kind, verdict, summary, title, occurred_at}|null}]}
//       Counts are problems (app_start / sample left out) in the last 30 days.
//       Worst first. With no filter: every box with a problem in 30 days, plus
//       boxes in a deep check now. With a line or a customer: also that line's /
//       customer's boxes with nothing wrong.
//   No session → 401 not_signed_in; not an admin → 403 not_admin.
//
// Malformed requests and unknown actions → 400 bad_request; other refusals are
// HTTP 200 with {ok:false, reason} so a box can read them.
//
// verify_jwt = false (see supabase/config.toml): the TVs have no session; the
// admin_* actions check the caller's JWT here. Nothing here logs an inbox key
// or event text.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

const serviceClient = (url: string, key: string) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Db = ReturnType<typeof serviceClient>;
type Body = Record<string, unknown>;
type Line = { host: string; username: string };

// The panels device-inbox accepts (a key can only be registered on these).
const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'strmz.xyz'] as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// 20 events of up to 4 KB (a check up to 12 KB) plus the envelope.
const MAX_BODY_BYTES = 128 * 1024;
export const MAX_EVENTS_PER_CALL = 20;
const MAX_EVENT_BYTES = 4096;
const MAX_CHECK_BYTES = 12 * 1024;
export const MAX_CHECKS_PER_DAY = 6;
const MAX_SAMPLE_ROWS = 30;
const MAX_SAMPLE_COLS = 8;
export const MAX_EVENTS_PER_DAY = 300;
export const MAX_LIGHT_EVENTS_PER_DAY = 40;
// Light: at most a call per 30 s; deep: a batch a minute plus light flushes.
const REPORTS_PER_KEY_PER_HOUR = 180;
// At start and every 10 minutes; restarts on top.
const STATUS_PER_KEY_PER_HOUR = 30;
const MAX_SUMMARY_CHARS = 200;
const MAX_TITLE_CHARS = 120;
const MAX_DATA_KEYS = 48;
const MAX_DATA_STRING_CHARS = 120;
const MAX_VERSION_CHARS = 20;
const MAX_MODEL_CHARS = 60;
const KEEP_DAYS = 90;
const DEEP_DEFAULT_DAYS = 7;
const DEEP_MAX_DAYS = 14;
const EVENTS_DEFAULT_LIMIT = 100;
const EVENTS_MAX_LIMIT = 500;
const SEEN_WITHIN_MS = 30 * DAY_MS;
const MAX_DEVICES = 200;
/** An occurredAt this far in the future is the box's clock, not news: stamped now. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const KINDS = ['stall', 'player_error', 'crash', 'killed', 'auth_error', 'app_start', 'sample', 'check'] as const;
const DEEP_ONLY_KINDS = new Set(['app_start', 'sample']);
const VERDICTS = ['device_overload', 'internet', 'server', 'account', 'app_crash', 'unknown'] as const;
const CONTEXTS = ['live', 'vod', 'series', 'plex', 'catchup', 'app'] as const;

const INBOX_KEY = /^[A-Za-z0-9_-]{32,128}$/;
const KEY_HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
// eslint-disable-next-line no-control-regex -- the point is to reject control characters
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Text that must never be stored: a URL (anything with ://), a query string
 * carrying a password / token / username (or pass= / pin= / key=), and an
 * IPv4 address (a stream server's). The whole string is dropped, not edited.
 */
const SECRET_LIKE = [
  /:\/\//,
  /(?:^|[?&;\s])(?:password|passwd|pass|pwd|token|access_token|x-plex-token|username|user|pin|key|auth)=/i,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
];
export const unsafeText = (s: string): boolean => SECRET_LIKE.some((re) => re.test(s));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const badRequest = () => json({ ok: false, reason: 'bad_request' }, 400);
const serverError = () => json({ ok: false, reason: 'error' }, 500);

const sha256 = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** Same as device-inbox / capture-player-signin normalizeHost. */
const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

const normalizeUsername = (raw: unknown): string | null => {
  const typed = typeof raw === 'string' ? raw.trim() : '';
  if (!typed || typed.length > 256 || CONTROL_CHARS.test(typed)) return null;
  return typed.toLowerCase();
};

/** As device-inbox lineOf: null when malformed, 'not_ours' for a panel off the allowlist. */
function lineOf(body: Body): Line | 'not_ours' | null {
  const host = normalizeHost(body.host);
  const username = normalizeUsername(body.username);
  if (!host || !username) return null;
  if (!ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) return 'not_ours';
  return { host, username };
}

/** Control characters out, spaces collapsed, cut to `max` characters. */
const shortText = (v: string, max: number): string =>
  // eslint-disable-next-line no-control-regex -- the point is to drop control characters
  Array.from(v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();

/** A string field: tidied, cut, and dropped ('') if it looks like a secret. */
const safeText = (v: unknown, max: number): string => {
  if (typeof v !== 'string') return '';
  const s = shortText(v, 1000);
  return s && !unsafeText(s) ? Array.from(s).slice(0, max).join('').trim() : '';
};

// ── events ──────────────────────────────────────────────────────────────────

export type EventRow = {
  kind: string; verdict: string; summary: string; context: string | null; title: string | null;
  data: Record<string, number | string | boolean | null>; samples: number[][] | null; occurred_at: string;
};

/**
 * One event as it will be stored, or null when it is malformed or too big.
 * The data map is flat (numbers, short strings, booleans, null); any string
 * value in it, the summary or the title that looks like a secret is dropped.
 */
export function cleanEvent(raw: unknown, nowMs: number): EventRow | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(raw)).length;
  } catch {
    return null;
  }
  const e = raw as Record<string, unknown>;
  if (!KINDS.includes(e.kind as (typeof KINDS)[number])) return null;
  if (size > (e.kind === 'check' ? MAX_CHECK_BYTES : MAX_EVENT_BYTES)) return null;

  // Samples: only on a check (ignored elsewhere); malformed ones drop the event.
  let samples: number[][] | null = null;
  if (e.kind === 'check' && e.samples !== undefined && e.samples !== null) {
    const rows = e.samples;
    if (!Array.isArray(rows) || rows.length > MAX_SAMPLE_ROWS) return null;
    if (!rows.every((r) => Array.isArray(r) && r.length <= MAX_SAMPLE_COLS
      && r.every((n) => typeof n === 'number' && Number.isFinite(n)))) return null;
    samples = rows as number[][];
  }
  const verdict = VERDICTS.includes(e.verdict as (typeof VERDICTS)[number]) ? (e.verdict as string) : 'unknown';
  const context = CONTEXTS.includes(e.context as (typeof CONTEXTS)[number]) ? (e.context as string) : null;
  const title = safeText(e.title, MAX_TITLE_CHARS) || null;
  const summary = safeText(e.summary, MAX_SUMMARY_CHARS);

  const data: EventRow['data'] = {};
  if (e.data !== undefined && e.data !== null) {
    if (typeof e.data !== 'object' || Array.isArray(e.data)) return null;
    let n = 0;
    for (const [k, v] of Object.entries(e.data as Record<string, unknown>)) {
      if (n >= MAX_DATA_KEYS) break;
      if (!DATA_KEY.test(k)) continue;
      if (v === null || typeof v === 'boolean') data[k] = v;
      else if (typeof v === 'number') {
        if (!Number.isFinite(v)) continue;
        data[k] = v;
      } else if (typeof v === 'string') {
        const s = safeText(v, MAX_DATA_STRING_CHARS);
        if (!s) continue;
        data[k] = s;
      } else continue; // nested objects / arrays: not flat
      n++;
    }
  }

  // The box's clock: unreadable or in the future → now; older than we keep → dropped.
  const at = typeof e.occurredAt === 'string' ? Date.parse(e.occurredAt) : NaN;
  let occurredMs = Number.isFinite(at) ? at : nowMs;
  if (occurredMs > nowMs + CLOCK_SKEW_MS) occurredMs = nowMs;
  if (occurredMs < nowMs - KEEP_DAYS * DAY_MS) return null;

  return { kind: e.kind as string, verdict, summary, context, title, data, samples, occurred_at: new Date(occurredMs).toISOString() };
}

// ── the TV side ─────────────────────────────────────────────────────────────

type Device = { id: string; key_hash: string; panel_host: string; panel_username: string };

/**
 * The box an inbox key belongs to, on the line it names (device-inbox
 * tvOnLine): unknown_key if the key is not registered, other_line if it is
 * registered for another line.
 */
async function tvOnLine(admin: Db, body: Body): Promise<{ device: Device; line: Line } | Response> {
  const line = lineOf(body);
  const inboxKey = typeof body.inbox_key === 'string' ? body.inbox_key : '';
  if (!line || !INBOX_KEY.test(inboxKey)) return badRequest();
  const keyHash = await sha256(inboxKey);
  const { data, error } = await admin.from('device_inbox')
    .select('id, panel_host, panel_username').eq('key_hash', keyHash).maybeSingle();
  if (error) throw new Error(`device lookup: ${error.message}`);
  const device = data as Omit<Device, 'key_hash'> | null;
  if (!device) return json({ ok: false, reason: 'unknown_key' });
  if (line === 'not_ours' || line.host !== device.panel_host || line.username !== device.panel_username) {
    return json({ ok: false, reason: 'other_line' });
  }
  return { device: { ...device, key_hash: keyHash }, line };
}

/** The box's deep check end, if it is on now. Throws on a DB error. */
async function deepUntil(admin: Db, keyHash: string): Promise<string | null> {
  const { data, error } = await admin.from('device_health_checks')
    .select('deep_until').eq('key_hash', keyHash).maybeSingle();
  if (error) throw new Error(`check lookup: ${error.message}`);
  const until = (data as { deep_until?: string | null } | null)?.deep_until;
  return until && Date.parse(until) > Date.now() ? until : null;
}

/**
 * The CRM customer a line belongs to: player_signins.matched_customer_id (the
 * link capture-player-signin keeps, as device-inbox uses), else the newest
 * customer_services row with that panel username on that server (as
 * giveaway-bridge looks it up). Null when neither knows it; never throws.
 */
async function customerForLine(admin: Db, line: Line): Promise<string | null> {
  try {
    const { data: signin } = await admin.from('player_signins')
      .select('matched_customer_id').eq('panel_host', line.host).eq('panel_username', line.username).maybeSingle();
    const cid = (signin as { matched_customer_id?: string | null } | null)?.matched_customer_id;
    if (typeof cid === 'string' && UUID.test(cid)) return cid;
    const escLike = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);
    const hostName = line.host.replace(/:\d+$/, '');
    const { data: svcs } = await admin.from('customer_services')
      .select('customer_id').ilike('panel_username', escLike(line.username)).ilike('panel_host', `%${escLike(hostName)}%`)
      .order('expiration_date', { ascending: false }).limit(1);
    const sid = ((svcs ?? []) as Array<{ customer_id?: string | null }>)[0]?.customer_id;
    return typeof sid === 'string' && UUID.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

/**
 * How many events this box sent in the last 24 h: all of them and the light
 * (non-deep) ones, both without checks, and its checks (their own cap).
 */
async function countsToday(admin: Db, keyHash: string): Promise<{ all: number; light: number; checks: number }> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const count = () => admin.from('device_health_events').select('id', { count: 'exact', head: true })
    .eq('key_hash', keyHash).gte('created_at', since);
  const [all, light, checks] = await Promise.all([
    count().neq('kind', 'check'),
    count().neq('kind', 'check').eq('deep', false),
    count().eq('kind', 'check'),
  ]);
  const err = all.error ?? light.error ?? checks.error;
  if (err) throw new Error(`count: ${(err as { message?: string }).message ?? 'failed'}`);
  return { all: all.count ?? 0, light: light.count ?? 0, checks: checks.count ?? 0 };
}

async function report(admin: Db, body: Body): Promise<Response> {
  const events = body.events;
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_CALL) return badRequest();
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  const { device, line } = tv;

  if (!(await throttle(admin as unknown as ThrottleDb, `dhr:key:${device.id}`, REPORTS_PER_KEY_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }

  const until = await deepUntil(admin, device.key_hash);
  const deep = until !== null;
  if (!events.length) return json({ ok: true, accepted: 0, ids: [], deep_until: until });

  const nowMs = Date.now();
  // Malformed ones are dropped but counted: the box must not send them again.
  const cleaned = events.map((e) => {
    const c = cleanEvent(e, nowMs);
    return c && (deep || !DEEP_ONLY_KINDS.has(c.kind)) ? c : null;
  });
  // Each kept event gets its id here, so `ids` lines up with what was sent.
  const ids: Array<string | null> = cleaned.map(() => null);
  const keep: Array<EventRow & { id: string }> = [];
  if (cleaned.some((c) => c !== null)) {
    const today = await countsToday(admin, device.key_hash);
    let room = Math.max(0, Math.min(
      MAX_EVENTS_PER_DAY - today.all,
      deep ? Infinity : MAX_LIGHT_EVENTS_PER_DAY - today.light,
    ));
    let checkRoom = Math.max(0, MAX_CHECKS_PER_DAY - today.checks);
    cleaned.forEach((c, i) => {
      if (!c) return;
      if (c.kind === 'check') {
        if (checkRoom <= 0) return;
        checkRoom--;
      } else {
        if (room <= 0) return;
        room--;
      }
      const id = crypto.randomUUID();
      ids[i] = id;
      keep.push({ id, ...c });
    });
  }

  if (keep.length) {
    const customerId = await customerForLine(admin, line);
    const versionCode = typeof body.version_code === 'number' && Number.isInteger(body.version_code)
      && body.version_code >= 0 && body.version_code <= 2_147_483_647 ? body.version_code : null;
    const common = {
      key_hash: device.key_hash,
      host: line.host,
      username: line.username,
      customer_id: customerId,
      app_version: safeText(body.app_version, MAX_VERSION_CHARS),
      version_code: versionCode,
      device_model: safeText(body.device_model, MAX_MODEL_CHARS),
      os_version: safeText(body.os_version, MAX_VERSION_CHARS),
      deep,
    };
    const { error } = await admin.from('device_health_events').insert(keep.map((e) => ({ ...common, ...e })));
    if (error) {
      console.error('[device-health] report insert failed:', (error as { message?: string }).message);
      return serverError();
    }
  }
  return json({ ok: true, accepted: events.length, ids, deep_until: until });
}

async function status(admin: Db, body: Body): Promise<Response> {
  const tv = await tvOnLine(admin, body);
  if (tv instanceof Response) return tv;
  if (!(await throttle(admin as unknown as ThrottleDb, `dhs:key:${tv.device.id}`, STATUS_PER_KEY_PER_HOUR, HOUR_MS))) {
    return json({ ok: false, reason: 'rate_limited' });
  }
  return json({ ok: true, deep_until: await deepUntil(admin, tv.device.key_hash) });
}

// ── the admin side ──────────────────────────────────────────────────────────

/** The signed-in admin's id, or the refusal (as device-inbox lineAction checks it). */
async function adminCaller(admin: Db, req: Request): Promise<string | Response> {
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
  const { data: adminFlag } = await admin.rpc('has_role', { _user_id: caller.id, _role: 'admin' });
  if (adminFlag !== true) return json({ ok: false, reason: 'not_admin' }, 403);
  return caller.id;
}

type InboxRow = {
  id: string; key_hash: string; panel_host: string; panel_username: string;
  device_label: string | null; app_version: string | null; last_seen_at: string | null;
};
const INBOX_COLS = 'id, key_hash, panel_host, panel_username, device_label, app_version, last_seen_at';

/** device_inbox rows for these key hashes, by hash. Throws on a DB error. */
async function inboxByHash(admin: Db, hashes: string[]): Promise<Map<string, InboxRow>> {
  const out = new Map<string, InboxRow>();
  const unique = [...new Set(hashes)];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await admin.from('device_inbox').select(INBOX_COLS).in('key_hash', unique.slice(i, i + 100));
    if (error) throw new Error(`inbox lookup: ${(error as { message?: string }).message}`);
    for (const r of (data ?? []) as InboxRow[]) out.set(r.key_hash, r);
  }
  return out;
}

/** The box a request names by device_ref (device_inbox id) or key_hash; 'bad' when neither is well-formed. */
async function boxOf(admin: Db, body: Body): Promise<InboxRow | null | 'bad'> {
  const ref = typeof body.device_ref === 'string' ? body.device_ref.toLowerCase() : '';
  const hash = typeof body.key_hash === 'string' ? body.key_hash.toLowerCase() : '';
  if (!UUID.test(ref) && !KEY_HASH.test(hash)) return 'bad';
  const q = admin.from('device_inbox').select(INBOX_COLS);
  const { data, error } = UUID.test(ref) ? await q.eq('id', ref).maybeSingle() : await q.eq('key_hash', hash).maybeSingle();
  if (error) throw new Error(`box lookup: ${(error as { message?: string }).message}`);
  return (data as InboxRow | null) ?? null;
}

async function setDeep(admin: Db, callerId: string, body: Body, on: boolean): Promise<Response> {
  let days = DEEP_DEFAULT_DAYS;
  if (on && body.days !== undefined && body.days !== null) {
    if (typeof body.days !== 'number' || !Number.isInteger(body.days) || body.days < 1 || body.days > DEEP_MAX_DAYS) return badRequest();
    days = body.days;
  }
  const box = await boxOf(admin, body);
  if (box === 'bad') return badRequest();
  if (!box) return json({ ok: false, reason: 'unknown_device' });
  const now = new Date();
  if (on) {
    const until = new Date(now.getTime() + days * DAY_MS).toISOString();
    const { error } = await admin.from('device_health_checks').upsert(
      { key_hash: box.key_hash, deep_until: until, requested_by: callerId, requested_at: now.toISOString() },
      { onConflict: 'key_hash' },
    );
    if (error) {
      console.error('[device-health] set deep failed:', (error as { message?: string }).message);
      return serverError();
    }
    return json({ ok: true, device_ref: box.id, deep_until: until });
  }
  // Stopped now: the row stays (who asked, when), ended.
  const { error } = await admin.from('device_health_checks')
    .update({ deep_until: now.toISOString() }).eq('key_hash', box.key_hash).gt('deep_until', now.toISOString());
  if (error) {
    console.error('[device-health] stop deep failed:', (error as { message?: string }).message);
    return serverError();
  }
  return json({ ok: true, device_ref: box.id, deep_until: null });
}

/** The optional line / customer filters an admin list takes; null when one is malformed. */
function adminFilters(body: Body): { host: string | null; username: string | null; customerId: string | null } | null {
  const host = body.host === undefined || body.host === null || body.host === '' ? null : normalizeHost(body.host);
  const username = body.username === undefined || body.username === null || body.username === '' ? null : normalizeUsername(body.username);
  const customerId = body.customer_id === undefined || body.customer_id === null || body.customer_id === ''
    ? null : (typeof body.customer_id === 'string' && UUID.test(body.customer_id) ? body.customer_id.toLowerCase() : undefined);
  if ((body.host && !host) || (body.username && !username) || customerId === undefined) return null;
  return { host, username, customerId: customerId ?? null };
}

const EVENT_COLS = 'id, key_hash, host, username, customer_id, app_version, version_code, device_model, os_version, kind, verdict, summary, context, title, data, samples, deep, occurred_at, created_at';
type EventDbRow = Record<string, unknown> & { key_hash: string };

/** Events as the page gets them: the hash stays here; each carries the ref device-inbox hands out. */
async function withRefs(admin: Db, rows: EventDbRow[]): Promise<Array<Record<string, unknown>>> {
  const boxes = await inboxByHash(admin, rows.map((r) => r.key_hash));
  return rows.map(({ key_hash, ...r }) => {
    const box = boxes.get(key_hash);
    return { ...r, device_ref: box?.id ?? null, label: box?.device_label ?? '' };
  });
}

async function adminEvents(admin: Db, body: Body): Promise<Response> {
  const f = adminFilters(body);
  if (!f) return badRequest();
  let limit = EVENTS_DEFAULT_LIMIT;
  if (body.limit !== undefined && body.limit !== null) {
    if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1) return badRequest();
    limit = Math.min(body.limit, EVENTS_MAX_LIMIT);
  }
  if (body.kind !== undefined && body.kind !== null && !KINDS.includes(body.kind as (typeof KINDS)[number])) return badRequest();
  if (body.verdict !== undefined && body.verdict !== null && !VERDICTS.includes(body.verdict as (typeof VERDICTS)[number])) return badRequest();
  let since: string | null = null;
  if (body.since !== undefined && body.since !== null) {
    const at = typeof body.since === 'string' ? Date.parse(body.since) : NaN;
    if (!Number.isFinite(at)) return badRequest();
    since = new Date(at).toISOString();
  }
  let keyHash: string | null = null;
  if (body.device_ref !== undefined && body.device_ref !== null) {
    const box = await boxOf(admin, { device_ref: body.device_ref });
    if (box === 'bad') return badRequest();
    if (!box) return json({ ok: true, events: [] });
    keyHash = box.key_hash;
  }

  let q = admin.from('device_health_events').select(EVENT_COLS);
  if (keyHash) q = q.eq('key_hash', keyHash);
  if (f.host) q = q.eq('host', f.host);
  if (f.username) q = q.eq('username', f.username);
  if (f.customerId) q = q.eq('customer_id', f.customerId);
  if (typeof body.kind === 'string') q = q.eq('kind', body.kind);
  if (typeof body.verdict === 'string') q = q.eq('verdict', body.verdict);
  if (since) q = q.gte('occurred_at', since);
  const { data, error } = await q.order('occurred_at', { ascending: false }).limit(limit);
  if (error) {
    console.error('[device-health] events failed:', (error as { message?: string }).message);
    return serverError();
  }
  return json({ ok: true, events: await withRefs(admin, (data ?? []) as EventDbRow[]) });
}

async function adminEvent(admin: Db, body: Body): Promise<Response> {
  const id = typeof body.id === 'string' ? body.id.toLowerCase() : '';
  if (!UUID.test(id)) return badRequest();
  const { data, error } = await admin.from('device_health_events').select(EVENT_COLS).eq('id', id).maybeSingle();
  if (error) {
    console.error('[device-health] event failed:', (error as { message?: string }).message);
    return serverError();
  }
  if (!data) return json({ ok: false, reason: 'not_found' });
  return json({ ok: true, event: (await withRefs(admin, [data as EventDbRow]))[0] });
}

type Summary = {
  key_hash: string; host: string; username: string; customer_id: string | null; device_model: string | null;
  app_version: string | null; counts: Record<string, number> | null; problems_7d: number; problems_30d: number;
  last_kind: string | null; last_verdict: string | null; last_summary: string | null; last_title: string | null; last_at: string | null;
};

async function adminDevices(admin: Db, body: Body): Promise<Response> {
  const f = adminFilters(body);
  if (!f) return badRequest();

  const { data: sum, error: sumErr } = await admin.rpc('device_health_box_summary', {
    p_host: f.host, p_username: f.username, p_customer_id: f.customerId, p_limit: MAX_DEVICES,
  });
  if (sumErr) {
    console.error('[device-health] summary failed:', (sumErr as { message?: string }).message);
    return serverError();
  }
  const summaries = (Array.isArray(sum) ? sum : []) as Summary[];
  const byHash = new Map(summaries.map((s) => [s.key_hash, s]));
  const nowIso = new Date().toISOString();

  // Boxes with nothing wrong that the admin should still see: those on the
  // line / of the customer asked about (seen in 30 days), and, unfiltered,
  // the ones in a deep check now.
  const extraHashes: string[] = [];
  const inbox = new Map<string, InboxRow>();
  const seenSince = new Date(Date.now() - SEEN_WITHIN_MS).toISOString();
  const addInbox = (rows: InboxRow[]) => { for (const r of rows) { inbox.set(r.key_hash, r); extraHashes.push(r.key_hash); } };
  if (f.host || f.username) {
    let q = admin.from('device_inbox').select(INBOX_COLS).gte('last_seen_at', seenSince);
    if (f.host) q = q.eq('panel_host', f.host);
    if (f.username) q = q.eq('panel_username', f.username);
    const { data, error } = await q.order('last_seen_at', { ascending: false }).limit(MAX_DEVICES);
    if (error) throw new Error(`line boxes: ${(error as { message?: string }).message}`);
    addInbox((data ?? []) as InboxRow[]);
  }
  if (f.customerId && !f.host && !f.username) {
    const { data: signins, error } = await admin.from('player_signins')
      .select('panel_host, panel_username').eq('matched_customer_id', f.customerId).limit(20);
    if (error) throw new Error(`customer lines: ${(error as { message?: string }).message}`);
    for (const s of (signins ?? []) as Array<{ panel_host: string; panel_username: string }>) {
      const { data, error: boxErr } = await admin.from('device_inbox').select(INBOX_COLS)
        .eq('panel_host', s.panel_host).eq('panel_username', s.panel_username).gte('last_seen_at', seenSince).limit(MAX_DEVICES);
      if (boxErr) throw new Error(`customer boxes: ${(boxErr as { message?: string }).message}`);
      addInbox((data ?? []) as InboxRow[]);
    }
  }

  // Deep checks on now (for every listed box, and unfiltered: those boxes too).
  const { data: checks, error: checkErr } = await admin.from('device_health_checks')
    .select('key_hash, deep_until').gt('deep_until', nowIso).limit(500);
  if (checkErr) throw new Error(`checks: ${(checkErr as { message?: string }).message}`);
  const deepByHash = new Map(((checks ?? []) as Array<{ key_hash: string; deep_until: string }>).map((c) => [c.key_hash, c.deep_until]));
  if (!f.host && !f.username && !f.customerId) extraHashes.push(...deepByHash.keys());

  const missing = [...new Set([...summaries.map((s) => s.key_hash), ...extraHashes])].filter((h) => !inbox.has(h));
  for (const [h, r] of await inboxByHash(admin, missing)) inbox.set(h, r);

  const hashes = [...new Set([...summaries.map((s) => s.key_hash), ...extraHashes])]
    // A filtered list shows only that line's / customer's boxes.
    .filter((h) => byHash.has(h) || inbox.has(h))
    .slice(0, MAX_DEVICES);

  // Customer names for the list (the line → customer link as report stored it).
  const customerIds = [...new Set(summaries.map((s) => s.customer_id).filter((c): c is string => !!c))];
  if (f.customerId) customerIds.push(f.customerId);
  const names = new Map<string, string>();
  if (customerIds.length) {
    const { data: custs } = await admin.from('customers').select('id, name').in('id', [...new Set(customerIds)].slice(0, 200));
    for (const c of (custs ?? []) as Array<{ id: string; name: string | null }>) names.set(c.id, c.name ?? '');
  }

  const devices = hashes.map((h) => {
    const s = byHash.get(h);
    const box = inbox.get(h);
    const customerId = s?.customer_id ?? (f.customerId && !s ? f.customerId : null);
    return {
      device_ref: box?.id ?? null,
      label: box?.device_label ?? '',
      host: s?.host ?? box?.panel_host ?? '',
      username: s?.username ?? box?.panel_username ?? '',
      customer_id: customerId,
      customer_name: customerId ? names.get(customerId) ?? null : null,
      app_version: box?.app_version || s?.app_version || '',
      model: s?.device_model ?? '',
      last_seen: box?.last_seen_at ?? null,
      deep_until: deepByHash.get(h) ?? null,
      counts: s?.counts ?? {},
      problems_7d: s?.problems_7d ?? 0,
      problems_30d: s?.problems_30d ?? 0,
      last_event: s && s.last_at
        ? { kind: s.last_kind, verdict: s.last_verdict, summary: s.last_summary ?? '', title: s.last_title, occurred_at: s.last_at }
        : null,
    };
  });
  // Worst first; boxes with nothing wrong after, latest seen first.
  devices.sort((a, b) => b.problems_7d - a.problems_7d || b.problems_30d - a.problems_30d
    || Date.parse(b.last_event?.occurred_at ?? b.last_seen ?? '0') - Date.parse(a.last_event?.occurred_at ?? a.last_seen ?? '0'));
  return json({ ok: true, devices });
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
    switch (body.action) {
      case 'report': return await report(admin, body);
      case 'status': return await status(admin, body);
      case 'admin_set_deep':
      case 'admin_stop_deep':
      case 'admin_events':
      case 'admin_event':
      case 'admin_devices': {
        const caller = await adminCaller(admin, req);
        if (caller instanceof Response) return caller;
        if (body.action === 'admin_set_deep') return await setDeep(admin, caller, body, true);
        if (body.action === 'admin_stop_deep') return await setDeep(admin, caller, body, false);
        if (body.action === 'admin_events') return await adminEvents(admin, body);
        if (body.action === 'admin_event') return await adminEvent(admin, body);
        return await adminDevices(admin, body);
      }
      default: return badRequest();
    }
  } catch (e) {
    console.error('[device-health] unexpected:', e instanceof Error ? e.message : 'unknown');
    return serverError();
  }
});
