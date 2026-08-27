// Client half of the player-login bridge: exchange verified Xtream credentials
// for a website session when the line is already linked to an app account.
import { supabase } from '@/integrations/supabase/client';
import { pickServerForUsername } from '@/lib/xtream';

export interface PlayerLoginResult {
  ok: boolean;
  /** 'not_linked' | 'auth_failed' | 'rate_limited' | 'panel_unreachable' | ... */
  reason?: string;
  /** Masked email of the account that was signed in (j***@gmail.com). */
  emailMasked?: string;
}

/**
 * Try to establish a Supabase session from streaming credentials. Safe to call
 * speculatively: every failure is a soft { ok:false, reason } — the caller
 * decides whether to surface it or fall back to normal flows.
 */
export async function signInWithPlayerCredentials(
  username: string,
  password: string,
): Promise<PlayerLoginResult> {
  try {
    const server = pickServerForUsername(username.trim());
    const host = server.host.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const { data, error } = await supabase.functions.invoke('player-login', {
      body: { host, username: username.trim(), password: password.trim() },
    });
    if (error) return { ok: false, reason: 'network' };
    const payload = data as { ok?: boolean; reason?: string; token_hash?: string; email_masked?: string };
    if (!payload?.ok || !payload.token_hash) {
      return { ok: false, reason: payload?.reason || 'error' };
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

/** Heuristic: an input that can't be an email is likely an Xtream username.
 *  NOTE Vibez usernames CONTAIN '@' by design, so '@' alone proves nothing —
 *  only use this to pick which flow to try FIRST, never to block a flow. */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
