// Live TV sign-in with a 10-digit PIN (the pin-signin edge function on SMC's
// Supabase project). The server matches the PIN to its line and answers with
// that line's real username and password; the form then signs in with them
// exactly as if they had been typed (CredentialsForm signInWith).
//
// The PIN itself goes to pin-signin and nowhere else: it is never stored,
// logged, put in analytics or sent to the panel. Only the line that comes back
// is used, and only through the normal sign-in path.

import { supabase } from '@/integrations/supabase/client';
import { SERVERS, hostNameOf, type XtreamServer } from '@/lib/servers';

export const PIN_LENGTH = 10;

/** Why a PIN did not sign in, as pin-signin says it ('error' also covers no answer at all). */
export type PinFailReason = 'invalid_pin' | 'not_found' | 'expired' | 'rate_limited' | 'error';

export interface PinLine {
  /** The app's own entry for the line's service, from the host / server the function returned. */
  server: XtreamServer;
  username: string;
  password: string;
}

/** ok with the line, or not ok with the reason. */
export interface PinOutcome {
  ok: boolean;
  line?: PinLine;
  reason?: PinFailReason;
}

const REASONS: readonly PinFailReason[] = ['invalid_pin', 'not_found', 'expired', 'rate_limited', 'error'];

/** Digits only, at most 10 ("12345 67890" → "1234567890"). */
export const pinDigits = (raw: string): string => String(raw ?? '').replace(/\D/g, '').slice(0, PIN_LENGTH);

/** As the field shows it: "1234567890" → "12345 67890" (a space after the fifth digit once there is a sixth). */
export const formatPin = (digits: string): string =>
  digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;

/**
 * The app's server for the line pin-signin returned: matched on the host name
 * first ('http://strmz.xyz' is our https Vibez entry), then on the server name.
 */
export function serverForLine(host: unknown, server: unknown): XtreamServer | null {
  const name = hostNameOf(typeof host === 'string' ? host : '');
  if (name) {
    const byHost = SERVERS.find((s) => hostNameOf(s.host) === name);
    if (byHost) return byHost;
  }
  const label = typeof server === 'string' ? server.trim().toLowerCase() : '';
  if (label) {
    const byLabel = SERVERS.find((s) => s.label.toLowerCase() === label);
    if (byLabel) return byLabel;
  }
  return null;
}

type Reply = { ok?: unknown; reason?: unknown; line?: unknown };

const failure = (reason: unknown): PinOutcome => ({
  ok: false,
  reason: REASONS.includes(reason as PinFailReason) ? (reason as PinFailReason) : 'error',
});

function readReply(data: unknown): PinOutcome {
  if (!data || typeof data !== 'object') return failure('error');
  const r = data as Reply;
  if (r.ok !== true) return failure(r.reason);
  const line = r.line && typeof r.line === 'object' ? (r.line as Record<string, unknown>) : null;
  const username = typeof line?.username === 'string' ? line.username.trim() : '';
  const password = typeof line?.password === 'string' ? line.password : '';
  const server = line ? serverForLine(line.host, line.server) : null;
  if (!username || !password || !server) return failure('error');
  return { ok: true, line: { server, username, password } };
}

/**
 * Ask pin-signin for the line behind `raw` (spaces and other non-digits are
 * dropped). A PIN that is not 10 digits never leaves the box. Never throws.
 */
export async function pinSignIn(raw: string): Promise<PinOutcome> {
  const pin = String(raw ?? '').replace(/\D/g, '');
  if (pin.length !== PIN_LENGTH) return { ok: false, reason: 'invalid_pin' };
  try {
    const { data, error } = await supabase.functions.invoke('pin-signin', { body: { pin } });
    if (!error) return readReply(data);
    // A non-2xx comes back as data: null and an error carrying the Response;
    // its body may still say why ({ ok: false, reason }).
    const res = (error as { context?: Response }).context;
    try {
      const parsed = res && typeof res.clone === 'function' ? await res.clone().json() : null;
      if (parsed && typeof parsed === 'object' && typeof (parsed as Reply).reason === 'string') {
        return failure((parsed as Reply).reason);
      }
    } catch { /* not JSON */ }
    if (res?.status === 429) return { ok: false, reason: 'rate_limited' };
    return { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ── the line's own PIN, from a box already signed in (my-signin-pin) ────────

/** Why my-signin-pin did not give the PIN ('error' also covers no answer at all). */
export type MyPinFailReason = 'rate_limited' | 'line_refused' | 'expired' | 'panel_unreachable' | 'pin_off' | 'error';

export interface MyPinOutcome {
  ok: boolean;
  /** The 10 digits. */
  pin?: string;
  reason?: MyPinFailReason;
}

const MY_PIN_REASONS: readonly MyPinFailReason[] = ['rate_limited', 'line_refused', 'expired', 'panel_unreachable', 'pin_off', 'error'];
const myPinFailure = (reason: unknown): MyPinOutcome => ({
  ok: false,
  reason: MY_PIN_REASONS.includes(reason as MyPinFailReason) ? (reason as MyPinFailReason) : 'error',
});

/**
 * The 10-digit PIN for the line this box is signed into, so the customer can
 * sign in on their other devices with it. The function checks the username
 * and password on the line's panel first, then hands back the line's PIN
 * (made now if the line has none; the same digits on every device and every
 * renewal). The PIN is shown, never logged, and kept only in memory for
 * this run of the app (My Account fetches it on every open, and the function
 * allows a line 6 asks per 5 minutes). Never throws.
 */
export async function fetchMyPin(line: { host: string; username: string; password: string }): Promise<MyPinOutcome> {
  if (!line.host || !line.username || !line.password) return { ok: false, reason: 'error' };
  const key = pinLineKey(line.host, line.username);
  const known = pinMemory.get(key);
  if (known) return { ok: true, pin: known };
  const r = await askMyPin(line);
  if (r.ok && r.pin) pinMemory.set(key, r.pin);
  return r;
}

/** This run's PINs, by line. Gone when the app closes. */
const pinMemory = new Map<string, string>();

async function askMyPin(line: { host: string; username: string; password: string }): Promise<MyPinOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('my-signin-pin', {
      body: { host: line.host, username: line.username, password: line.password },
    });
    let reply: unknown = data;
    if (error) {
      const res = (error as { context?: Response }).context;
      try { reply = res && typeof res.clone === 'function' ? await res.clone().json() : null; } catch { reply = null; }
      if (!reply) return { ok: false, reason: res?.status === 429 ? 'rate_limited' : 'error' };
    }
    const r = reply as { ok?: unknown; pin?: unknown; reason?: unknown } | null;
    if (!r || typeof r !== 'object') return { ok: false, reason: 'error' };
    if (r.ok !== true) return myPinFailure(r.reason);
    const pin = typeof r.pin === 'string' ? pinDigits(r.pin) : '';
    return pin.length === PIN_LENGTH ? { ok: true, pin } : { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ── lines signed in with a PIN ──────────────────────────────────────────────
//
// A line signed in with a PIN shows only its PIN — never the username and
// password the PIN stands for (owner, 2026-10-28). The box still holds both
// (it needs them to play), but the screens show the PIN instead. Typing the
// username and password for the same line takes the mark off: they know them.

const PIN_LINES_KEY = 'snow-pin-lines-v1';

/** 'dstreams.xyz|joe': one line, whatever scheme or port the host came with. */
export const pinLineKey = (host: string, username: string): string =>
  `${hostNameOf(host)}|${String(username ?? '').trim().toLowerCase()}`;

function readPinLines(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(PIN_LINES_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

/** Remember how this line was signed in: with a PIN, or with its username and password. */
export function markPinLine(host: string, username: string, viaPin: boolean): void {
  if (!host || !username) return;
  const key = pinLineKey(host, username);
  const rest = readPinLines().filter((k) => k !== key);
  try { localStorage.setItem(PIN_LINES_KEY, JSON.stringify(viaPin ? [...rest, key].slice(-20) : rest)); } catch { /* ignore */ }
}

/** Was this line signed in with a PIN (so only the PIN is shown)? */
export function isPinLine(line: { host?: string | null; username?: string | null } | null | undefined): boolean {
  if (!line?.host || !line.username) return false;
  return readPinLines().includes(pinLineKey(line.host, line.username));
}
