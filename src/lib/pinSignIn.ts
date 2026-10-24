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
