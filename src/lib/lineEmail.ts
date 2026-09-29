import { supabase } from '@/integrations/supabase/client';
import type { XtreamCreds } from '@/lib/xtream';
import i18n from '@/i18n';

/**
 * Mail a customer the streaming login they just received.
 *
 * The billing API sends nothing at all (docs/billing/API.md: "No email is
 * involved anywhere"), so without this the username and password exist only
 * on the TV screen — gone the moment the viewer walks away or the box is
 * wiped. The edge function verifies the line against the panel before it
 * sends, composes the body itself, and throttles per line and per IP.
 *
 * Every failure here is non-fatal by design: the credentials are already on
 * screen and already saved to the device, so a bounced email must never block
 * someone from watching. Callers surface the message and move on.
 */

/**
 * A flat shape rather than a discriminated union: this project compiles with
 * `strict: false`, where narrowing on an `ok: true | false` discriminant does
 * not hold, so callers would have to cast to read `message`.
 */
export interface EmailLineOutcome {
  ok: boolean;
  /** Set when ok is false: the server's stable error code. */
  code?: string;
  /** Set when ok is false: the sentence to show the viewer. */
  message?: string;
}

// The server's error codes, each with a message key (liveAccount.email.<code>).
const CODES = new Set([
  'not_deployed', 'auth_required', 'invalid_email', 'missing_credentials', 'invalid_credentials',
  'panel_unreachable', 'rate_limited', 'email_unavailable', 'send_failed',
]);

/** The sentence for a code, in the app's language (translated when it is asked for). */
const friendly = (code: string): string =>
  i18n.t(CODES.has(code) ? `liveAccount.email.${code}` : 'liveAccount.email.send_failed');

/** Marks a line as already mailed, so re-entering a screen does not send again. */
const sentKey = (host: string, username: string) =>
  `smc:line-emailed:${host.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase()}|${username.trim().toLowerCase()}`;

export function wasLineEmailed(creds: Pick<XtreamCreds, 'host' | 'username'>): boolean {
  try {
    return localStorage.getItem(sentKey(creds.host, creds.username)) === '1';
  } catch {
    return false;
  }
}

function markLineEmailed(creds: Pick<XtreamCreds, 'host' | 'username'>): void {
  try {
    localStorage.setItem(sentKey(creds.host, creds.username), '1');
  } catch {
    /* private mode — worst case we offer to send it again */
  }
}

export async function emailLineCredentials(input: {
  email: string;
  creds: Pick<XtreamCreds, 'host' | 'username' | 'password'>;
  serverLabel?: string | null;
  planName?: string | null;
  /** ISO or already-formatted expiry, shown as-is in the email. */
  expiresAt?: string | null;
}): Promise<EmailLineOutcome> {
  const email = input.email.trim();
  if (!email || !email.includes('@')) return { ok: false, code: 'invalid_email', message: friendly('invalid_email') };

  try {
    const { data, error } = await supabase.functions.invoke('email-line-credentials', {
      body: {
        email,
        host: input.creds.host,
        username: input.creds.username,
        password: input.creds.password,
        serverLabel: input.serverLabel ?? undefined,
        planName: input.planName ?? undefined,
        expiresAt: input.expiresAt ?? undefined,
      },
    });

    if (!error) {
      // A 2xx can still carry an error code in the body.
      const code = (data as { error?: string } | null)?.error;
      if (code) return { ok: false, code, message: friendly(code) };
      markLineEmailed(input.creds);
      return { ok: true };
    }

    // functions.invoke collapses every non-2xx into one opaque error, which
    // made a function that was never deployed look identical to a mail
    // provider outage. The Response is on the error, so read the status and
    // the body and say which it actually is — the two have completely
    // different fixes and only one of them is ours.
    const res = (error as { context?: Response }).context;
    const status = res?.status;
    if (status === 404) return { ok: false, code: 'not_deployed', message: friendly('not_deployed') };
    // 401 here means the function is deployed with Verify JWT still on: a
    // customer who signed up through billing has no Supabase session to send.
    if (status === 401 || status === 403) return { ok: false, code: 'auth_required', message: friendly('auth_required') };

    let bodyCode: string | null = null;
    try {
      const parsed = res ? await res.clone().json() : null;
      const c = (parsed as { error?: unknown } | null)?.error;
      if (typeof c === 'string') bodyCode = c;
    } catch {
      /* not JSON — fall back to the generic failure below */
    }
    const resolved = bodyCode || 'send_failed';
    return { ok: false, code: resolved, message: friendly(resolved) };
  } catch {
    return { ok: false, code: 'send_failed', message: friendly('send_failed') };
  }
}
