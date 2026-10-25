// Sign-in PINs, the table side (20261025120000_signin_pins.sql). One PIN per
// line, keyed by line_key = '<hostname>:<lower(username)>':
//
//   pinHostname        a stored or typed host -> 'dstreams.xyz' | 'strmz.xyz' | null
//   ensureLinePin      the line's PIN, made if it has none (idempotent: a line
//                      that has one keeps it, so a renewal keeps the digits)
//   ensureMissingPins  a PIN for every line in the CRM that is not over and
//                      has none yet ("Create missing PINs", and the end of
//                      each refresh-player-signins run)
//   recordLineExpiry   a later expiry the panel gave, onto the stored rows
//   lineExpiries       each line's latest expiry across both tables
//   pinView            a row as the hub reads it
//
// A deleted PIN is a soft delete (deleted_at): the row keeps its line_key,
// so the hooks and the backfill never make the line a PIN again. Only an
// explicit hub create / new_pin brings the line back, with new digits.
//
// Used by signin-pins, pin-signin, giveaway-bridge and refresh-player-signins.
// Never logs a PIN, its HMAC, a username or a password.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { decPin, encPin, newPin, pinHmac, pinHmacKey } from './signinPin.ts';

export type PinHostname = 'dstreams.xyz' | 'strmz.xyz';
export type PinSource = 'line-created' | 'site-provision' | 'capture' | 'hub' | 'backfill';
export const PIN_SOURCES: readonly PinSource[] = ['line-created', 'site-provision', 'capture', 'hub', 'backfill'];

/** What the app is told about each panel (pin-signin's line.server / line.host). */
export const PIN_PANELS: Record<PinHostname, { server: 'DreamStreams' | 'Vibez'; host: string; panelHost: string; label: string }> = {
  'dstreams.xyz': { server: 'DreamStreams', host: 'http://dstreams.xyz:8080', panelHost: 'dstreams.xyz:8080', label: 'Dreamstreams' },
  'strmz.xyz': { server: 'Vibez', host: 'http://strmz.xyz', panelHost: 'strmz.xyz', label: 'VibezTV' },
};

/** A host as stored or typed ('http://dstreams.xyz:8080/', 'strmz.xyz') -> its panel, or null. */
export function pinHostname(raw: unknown): PinHostname | null {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[:/].*$/, '');
  return h === 'dstreams.xyz' || h === 'strmz.xyz' ? h : null;
}

/** 'DreamStreams' / 'Vibez' (as the hub and the app name them) -> the panel. */
export function serverHostname(raw: unknown): PinHostname | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
  if (s.startsWith('dream')) return 'dstreams.xyz';
  if (s.startsWith('vibez')) return 'strmz.xyz';
  return pinHostname(raw);
}

/** A customer_services row's panel: its host, or (no host) the panel its service type names. */
export function serviceHostname(panelHost: unknown, serviceType: unknown): PinHostname | null {
  if (typeof panelHost === 'string' && panelHost.trim()) return pinHostname(panelHost);
  return serverHostname(serviceType);
}

// eslint-disable-next-line no-control-regex -- usernames reject control bytes.
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/** A line username as stored on the PIN row: trimmed, 1-256 characters, no control bytes. */
export function cleanUsername(raw: unknown): string | null {
  const u = typeof raw === 'string' ? raw.trim() : '';
  return u && u.length <= 256 && !CONTROL_CHARS.test(u) ? u : null;
}

export const lineKeyOf = (hostname: PinHostname, username: string): string => `${hostname}:${username.toLowerCase()}`;

export type PinRow = {
  id: string;
  panel_hostname: PinHostname;
  panel_username: string;
  line_key: string;
  customer_id: string | null;
  pin_enc: string;
  source: PinSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  deleted_at: string | null;
  last_used_at: string | null;
  use_count: number | null;
};

export const PIN_COLUMNS =
  'id, panel_hostname, panel_username, line_key, customer_id, pin_enc, source, created_by, created_at, updated_at, disabled_at, deleted_at, last_used_at, use_count';

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** 'off' (switched off), 'expired' (its line's latest expiry is a day already gone) or 'working'. */
export function pinStatus(row: Pick<PinRow, 'disabled_at'>, expiresAt: string | null): 'working' | 'expired' | 'off' {
  if (row.disabled_at) return 'off';
  return expiresAt && expiresAt < todayUtc() ? 'expired' : 'working';
}

/** The hub's view of one PIN (signin-pins answers with these; see PLAN.md). */
export function pinView(row: PinRow, pin: string | null, customerName: string | null, expiresAt: string | null) {
  return {
    id: row.id,
    server: PIN_PANELS[row.panel_hostname]?.server ?? null,
    panel_hostname: row.panel_hostname,
    panel_username: row.panel_username,
    customer_id: row.customer_id,
    customer_name: customerName,
    pin,
    status: pinStatus(row, expiresAt),
    expires_at: expiresAt,
    last_used_at: row.last_used_at ?? null,
    use_count: Number(row.use_count ?? 0),
    created_at: row.created_at,
    source: row.source,
  };
}

type DbError = { code?: string; message?: string } | null | undefined;

/** The table (the migration) is not there yet. */
export const missingTable = (e: DbError): boolean => {
  const code = e?.code ?? '';
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || code === '42883';
};
const isDuplicate = (e: DbError): boolean => e?.code === '23505';

// A new PIN that happens to equal one already issued: try another.
const PIN_TRIES = 8;

/** A new PIN: the digits, the lookup key and the ciphertext; null without a usable key. */
export async function freshPin(): Promise<{ pin: string; pin_hmac: string; pin_enc: string } | null> {
  const pin = newPin();
  const hmac = await pinHmac(pin);
  const enc = hmac ? await encPin(pin) : null;
  return hmac && enc ? { pin, pin_hmac: hmac, pin_enc: enc } : null;
}

export type EnsureResult =
  | { ok: true; row: PinRow; pin: string | null; created: boolean }
  | { ok: false; reason: 'bad_line' | 'deleted' | 'no_key' | 'not_set_up' | 'error' };

/**
 * The line's PIN, made when it has none. Idempotent: a line that has a PIN
 * keeps it (a renewal, a second capture, a replayed order). A customer is
 * filled in when the row has none. The username keeps the casing of the
 * latest verified source (a backfill never changes it): line_key is
 * lower-case either way, but the app signs in with this username.
 *
 * A line whose PIN was deleted in the hub gets none ('deleted'), unless
 * `revive` (an explicit hub create): then the row comes back with new digits.
 */
export async function ensureLinePin(
  db: SupabaseClient,
  opts: { host: unknown; username: unknown; customerId?: string | null; source: PinSource; createdBy?: string | null; revive?: boolean },
): Promise<EnsureResult> {
  const hostname = pinHostname(opts.host) ?? serverHostname(opts.host);
  const username = cleanUsername(opts.username);
  if (!hostname || !username) return { ok: false, reason: 'bad_line' };
  const key = lineKeyOf(hostname, username);
  const customerId = typeof opts.customerId === 'string' && UUID_RE.test(opts.customerId) ? opts.customerId : null;

  const readExisting = async (): Promise<{ row: PinRow | null; error: DbError }> => {
    const { data, error } = await db.from('signin_pins').select(PIN_COLUMNS).eq('line_key', key).maybeSingle();
    return { row: (data as PinRow | null) ?? null, error: error as DbError };
  };

  const existing = await readExisting();
  if (existing.error) return { ok: false, reason: missingTable(existing.error) ? 'not_set_up' : 'error' };
  if (existing.row?.deleted_at) {
    return opts.revive ? replacePin(db, existing.row.id, { deleted_at: null }) : { ok: false, reason: 'deleted' };
  }
  if (existing.row) return keep(db, existing.row, username, customerId, opts.source);

  if (!(await pinHmacKey())) return { ok: false, reason: 'no_key' };
  for (let i = 0; i < PIN_TRIES; i++) {
    const fresh = await freshPin();
    if (!fresh) return { ok: false, reason: 'no_key' };
    const { data, error } = await db.from('signin_pins').insert({
      panel_hostname: hostname,
      panel_username: username,
      customer_id: customerId,
      pin_hmac: fresh.pin_hmac,
      pin_enc: fresh.pin_enc,
      source: opts.source,
      created_by: opts.createdBy ?? null,
    }).select(PIN_COLUMNS).single();
    if (isDuplicate(error as DbError)) {
      // Made by a call running alongside this one (the line now has its
      // PIN), or a PIN already issued (try other digits).
      const again = await readExisting();
      if (again.row?.deleted_at) return { ok: false, reason: 'deleted' };
      if (again.row) return keep(db, again.row, username, customerId, opts.source);
      continue;
    }
    if (error || !data) return { ok: false, reason: missingTable(error as DbError) ? 'not_set_up' : 'error' };
    return { ok: true, row: data as PinRow, pin: fresh.pin, created: true };
  }
  return { ok: false, reason: 'error' };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function keep(db: SupabaseClient, row: PinRow, username: string, customerId: string | null, source: PinSource): Promise<EnsureResult> {
  const patch: Record<string, string> = {};
  if (customerId && !row.customer_id) patch.customer_id = customerId;
  if (source !== 'backfill' && row.panel_username !== username) patch.panel_username = username;
  let out = row;
  if (Object.keys(patch).length) {
    const { data, error } = await db.from('signin_pins').update(patch).eq('id', row.id).select(PIN_COLUMNS).maybeSingle();
    if (!error && data) out = data as PinRow;
  }
  return { ok: true, row: out, pin: await decPin(out.pin_enc), created: false };
}

/**
 * New digits for a PIN row (the old PIN stops working at once); `also` is
 * written with them (a hub create or new_pin on a deleted line clears
 * deleted_at).
 */
export async function replacePin(db: SupabaseClient, id: string, also: Record<string, unknown> = {}): Promise<EnsureResult> {
  if (!(await pinHmacKey())) return { ok: false, reason: 'no_key' };
  for (let i = 0; i < PIN_TRIES; i++) {
    const fresh = await freshPin();
    if (!fresh) return { ok: false, reason: 'no_key' };
    const { data, error } = await db.from('signin_pins')
      .update({ ...also, pin_hmac: fresh.pin_hmac, pin_enc: fresh.pin_enc })
      .eq('id', id)
      .select(PIN_COLUMNS)
      .maybeSingle();
    if (isDuplicate(error as DbError)) continue;
    if (error || !data) return { ok: false, reason: 'error' };
    return { ok: true, row: data as PinRow, pin: fresh.pin, created: false };
  }
  return { ok: false, reason: 'error' };
}

const PAGE = 1000;
const READ_CAP = 50_000;

/** Every row of a query, a page at a time (PostgREST hands out 1000 at most). */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ rows: T[]; error: DbError }> {
  const rows: T[] = [];
  for (let from = 0; from < READ_CAP; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { rows, error: error as DbError };
    const got = (Array.isArray(data) ? data : []) as T[];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { rows, error: null };
}

export type EnsureMissingResult =
  | { ok: true; missing: number; created: number; failed: number; more: boolean }
  | { ok: false; reason: 'no_key' | 'not_set_up' | 'error' };

/**
 * A PIN for every DreamStreams / Vibez line in customer_services or
 * player_signins that is not over (its latest expiry is today or later, or
 * not known) and has no PIN yet. Stops at `max` new PINs or the deadline;
 * `more` says lines were left for the next run.
 */
export async function ensureMissingPins(
  db: SupabaseClient,
  opts: { max?: number; deadline?: number } = {},
): Promise<EnsureMissingResult> {
  if (!(await pinHmacKey())) return { ok: false, reason: 'no_key' };
  const max = opts.max ?? 2000;
  const deadline = opts.deadline ?? Date.now() + 60_000;

  const have = await readAll<{ line_key: string }>((a, b) =>
    db.from('signin_pins').select('line_key').order('id').range(a, b));
  if (have.error) return { ok: false, reason: missingTable(have.error) ? 'not_set_up' : 'error' };
  const known = new Set(have.rows.map((r) => r.line_key));

  type Line = { hostname: PinHostname; username: string; customerId: string | null; exp: string | null; expUnknown: boolean };
  const lines = new Map<string, Line>();
  const add = (hostname: PinHostname | null, rawUser: unknown, customerId: unknown, exp: unknown, preferCustomer: boolean) => {
    const username = cleanUsername(rawUser);
    if (!hostname || !username) return;
    const key = lineKeyOf(hostname, username);
    if (known.has(key)) return;
    const e = typeof exp === 'string' && exp ? exp.slice(0, 10) : null;
    const cust = typeof customerId === 'string' && customerId ? customerId : null;
    const line = lines.get(key);
    if (!line) {
      lines.set(key, { hostname, username, customerId: cust, exp: e, expUnknown: !e });
      return;
    }
    if (e && (!line.exp || e > line.exp)) line.exp = e;
    if (!e) line.expUnknown = true;
    if (cust && (preferCustomer || !line.customerId)) line.customerId = cust;
  };

  const services = await readAll<{ customer_id: string | null; panel_host: string | null; panel_username: string | null; service_type: string | null; expiration_date: string | null }>((a, b) =>
    db.from('customer_services')
      .select('customer_id, panel_host, panel_username, service_type, expiration_date')
      .not('panel_username', 'is', null)
      .order('id')
      .range(a, b));
  if (services.error) return { ok: false, reason: 'error' };
  for (const s of services.rows) add(serviceHostname(s.panel_host, s.service_type), s.panel_username, s.customer_id, s.expiration_date, true);

  const signins = await readAll<{ panel_host: string | null; panel_username: string | null; matched_customer_id: string | null; expiration_date: string | null }>((a, b) =>
    db.from('player_signins')
      .select('panel_host, panel_username, matched_customer_id, expiration_date')
      .order('id')
      .range(a, b));
  if (signins.error) return { ok: false, reason: 'error' };
  for (const s of signins.rows) add(pinHostname(s.panel_host), s.panel_username, s.matched_customer_id, s.expiration_date, false);

  // Not over: the latest known expiry is today or later. A line no row gives
  // an expiry for counts as not over (the panel is still the real gate).
  const today = todayUtc();
  const todo = [...lines.values()].filter((l) => (l.exp ? l.exp >= today : l.expUnknown));

  let created = 0;
  let failed = 0;
  let done = 0;
  for (const line of todo) {
    if (created >= max || Date.now() > deadline) break;
    done++;
    const r = await ensureLinePin(db, { host: line.hostname, username: line.username, customerId: line.customerId, source: 'backfill' });
    if (!r.ok) {
      if (r.reason === 'no_key' || r.reason === 'not_set_up') return { ok: false, reason: r.reason };
      if (r.reason !== 'deleted') failed++;
    } else if (r.created) {
      created++;
    }
  }
  return { ok: true, missing: todo.length, created, failed, more: done < todo.length };
}

/**
 * Each line's latest expiry (YYYY-MM-DD) across customer_services and
 * player_signins, by line_key; only the keys asked for. The bulk form of
 * signin_pin_line's expiration_date, for the hub's list.
 */
export async function lineExpiries(db: SupabaseClient, keys: Set<string>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.size) return out;
  const take = (hostname: PinHostname | null, rawUser: unknown, exp: unknown) => {
    const username = cleanUsername(rawUser);
    if (!hostname || !username || typeof exp !== 'string' || !exp) return;
    const key = lineKeyOf(hostname, username);
    if (!keys.has(key)) return;
    const e = exp.slice(0, 10);
    const had = out.get(key);
    if (!had || e > had) out.set(key, e);
  };
  const services = await readAll<{ panel_host: string | null; panel_username: string | null; service_type: string | null; expiration_date: string | null }>((a, b) =>
    db.from('customer_services').select('panel_host, panel_username, service_type, expiration_date')
      .not('panel_username', 'is', null).order('id').range(a, b));
  for (const s of services.rows) take(serviceHostname(s.panel_host, s.service_type), s.panel_username, s.expiration_date);
  const signins = await readAll<{ panel_host: string | null; panel_username: string | null; expiration_date: string | null }>((a, b) =>
    db.from('player_signins').select('panel_host, panel_username, expiration_date').order('id').range(a, b));
  for (const s of signins.rows) take(pinHostname(s.panel_host), s.panel_username, s.expiration_date);
  return out;
}

/** One line's latest expiry (signin_pin_line), or null when none is known or it can't be read. */
export async function lineExpiry(db: SupabaseClient, lineKey: string): Promise<string | null> {
  try {
    const { data, error } = await db.rpc('signin_pin_line', { p_line_key: lineKey });
    if (error) return null;
    const row = (Array.isArray(data) ? data[0] : data) as { expiration_date?: unknown } | null;
    return typeof row?.expiration_date === 'string' ? row.expiration_date.slice(0, 10) : null;
  } catch {
    return null;
  }
}

const escLike = (v: string) => v.replace(/[\\%_]/g, (m) => '\\' + m);

/**
 * A later expiry the panel gave for a line (pin-signin's recheck), onto its
 * customer_services and player_signins rows. Never moves an expiry back.
 */
export async function recordLineExpiry(db: SupabaseClient, hostname: PinHostname, username: string, expDate: string): Promise<void> {
  const lower = username.toLowerCase();
  try {
    const { data: services } = await db.from('customer_services')
      .select('id, panel_host, panel_username, service_type, expiration_date')
      .ilike('panel_username', escLike(lower))
      .limit(20);
    for (const s of (services ?? []) as Array<{ id: string; panel_host: string | null; panel_username: string | null; service_type: string | null; expiration_date: string | null }>) {
      if (String(s.panel_username ?? '').trim().toLowerCase() !== lower) continue;
      if (serviceHostname(s.panel_host, s.service_type) !== hostname) continue;
      if (s.expiration_date && s.expiration_date >= expDate) continue;
      await db.from('customer_services').update({ expiration_date: expDate }).eq('id', s.id);
    }
    const { data: signins } = await db.from('player_signins')
      .select('id, panel_host, panel_username, expiration_date')
      .ilike('panel_username', escLike(lower))
      .limit(20);
    for (const s of (signins ?? []) as Array<{ id: string; panel_host: string | null; panel_username: string | null; expiration_date: string | null }>) {
      if (String(s.panel_username ?? '').trim().toLowerCase() !== lower) continue;
      if (pinHostname(s.panel_host) !== hostname) continue;
      if (s.expiration_date && s.expiration_date >= expDate) continue;
      await db.from('player_signins').update({ expiration_date: expDate }).eq('id', s.id);
    }
  } catch {
    console.warn('[signin-pins] expiry not recorded');
  }
}
