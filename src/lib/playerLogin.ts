// Client half of the player-login bridge: exchange verified Xtream credentials
// for a website session when the line is already linked to an app account.
import { supabase } from '@/integrations/supabase/client';
import { pickServerForUsername } from '@/lib/xtream';
import { wasWebsiteSignedOut, clearWebsiteSignedOut } from '@/lib/websiteSession';

export interface PlayerLoginResult {
  ok: boolean;
  /** 'not_linked' | 'auth_failed' | 'rate_limited' | 'panel_unreachable' | 'no_email' | 'email_in_use' | ... */
  reason?: string;
  /** Masked email of the account that was signed in (j***@gmail.com). */
  emailMasked?: string;
  /** With a profile: the hub record was written even though no session was minted. */
  saved?: boolean;
}

/** What a member types on the TV to finish their account. All optional. */
export interface PlayerProfile { name?: string; email?: string; phone?: string }

/**
 * Try to establish a Supabase session from streaming credentials. Safe to call
 * speculatively: every failure is a soft { ok:false, reason } — the caller
 * decides whether to surface it or fall back to normal flows.
 *
 * With a `profile`, the server also records the member in the hub (customer
 * + line) and creates the website account for the email, so this is the one
 * call behind "finish your account" on the TV.
 */
export async function signInWithPlayerCredentials(
  username: string,
  password: string,
  profile?: PlayerProfile,
): Promise<PlayerLoginResult> {
  try {
    const server = pickServerForUsername(username.trim());
    const host = server.host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const { data, error } = await supabase.functions.invoke('player-login', {
      body: { host, username: username.trim(), password: password.trim(), ...(profile ? { profile } : {}) },
    });
    if (error) return { ok: false, reason: 'network' };
    const payload = data as { ok?: boolean; reason?: string; token_hash?: string; email_masked?: string; saved?: boolean };
    if (!payload?.ok || !payload.token_hash) {
      return { ok: false, reason: payload?.reason || 'error', saved: !!payload?.saved };
    }
    const { error: otpErr } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: payload.token_hash,
    });
    if (otpErr) return { ok: false, reason: 'otp_failed' };
    return { ok: true, emailMasked: payload.email_masked };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ── the shared attempt ─────────────────────────────────────────────────────
//
// Two places want to run the bridge: CredentialsForm right after a streaming
// sign-in, and Support when it opens without a website session. Both used to
// call signInWithPlayerCredentials directly, so a user who signed into the
// Player and went straight to Support made two player-login calls in a row —
// and player-login's per-line throttle is six per five minutes, because it
// mints sessions. This is the one door they both go through:
//
//   • one in-flight request per line, shared by every caller;
//   • every non-ok outcome remembered in sessionStorage — ten minutes for
//     the definitive ones (not linked, wrong password, throttled), one minute
//     for the transient ones (network, panel down) — so a remount does not
//     re-issue the same request;
//   • silence after a deliberate website sign-out (see websiteSession.ts).

const HARD_TTL_MS = 10 * 60 * 1000;
const SOFT_TTL_MS = 60 * 1000;
const HARD_REASONS = new Set(['not_linked', 'auth_failed', 'rate_limited']);

const inflight = new Map<string, Promise<PlayerLoginResult>>();

const lineOf = (username: string): string => {
  const server = pickServerForUsername(username.trim());
  const host = server.host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `${host}|${username.trim().toLowerCase()}`;
};
const cacheKey = (line: string) => `player-bridge:${line}`;

const readCached = (line: string): PlayerLoginResult | null => {
  try {
    const raw = sessionStorage.getItem(cacheKey(line));
    if (!raw) return null;
    const { reason, until } = JSON.parse(raw) as { reason?: string; until?: number };
    if (typeof until !== 'number' || until <= Date.now()) return null;
    return { ok: false, reason: reason || 'error' };
  } catch {
    return null;
  }
};

const writeCached = (line: string, reason: string): void => {
  const ttl = HARD_REASONS.has(reason) ? HARD_TTL_MS : SOFT_TTL_MS;
  try { sessionStorage.setItem(cacheKey(line), JSON.stringify({ reason, until: Date.now() + ttl })); } catch { /* ignore */ }
};

/**
 * Try to restore the website session from streaming credentials, at most
 * once per line at a time and never more often than the outcome cache allows.
 * Returns { ok:false, reason:'signed_out' } without a request when the user
 * signed out of the website on purpose.
 */
export function tryPlayerBridge(username: string, password: string): Promise<PlayerLoginResult> {
  if (wasWebsiteSignedOut()) return Promise.resolve({ ok: false, reason: 'signed_out' });
  const line = lineOf(username);
  const existing = inflight.get(line);
  if (existing) return existing;
  const cached = readCached(line);
  if (cached) return Promise.resolve(cached);

  const p = signInWithPlayerCredentials(username, password)
    .then((r) => {
      if (r.ok) {
        try { sessionStorage.removeItem(cacheKey(line)); } catch { /* ignore */ }
        clearWebsiteSignedOut();
      } else {
        writeCached(line, r.reason || 'error');
      }
      return r;
    })
    .finally(() => { inflight.delete(line); });
  inflight.set(line, p);
  return p;
}

/** Heuristic: an input that can't be an email is likely an Xtream username.
 *  NOTE Vibez usernames CONTAIN '@' by design, so '@' alone proves nothing —
 *  only use this to pick which flow to try FIRST, never to block a flow. */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
