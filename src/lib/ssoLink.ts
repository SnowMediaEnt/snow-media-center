// A sign-in link opened on the box (snowmedia://sso, snowmediaent.com/sso).
//
// Any app on the box, or any page in a browser on it, can open one of these,
// so a link never signs the box in by itself: pages/SsoConsume shows which
// account it is for and waits for OK. Without that, a crafted link could
// quietly move the box onto someone else's account, and the box would then
// save its player line, password included, to that account.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/integrations/supabase/client';

export type SignInOtpType = 'magiclink' | 'signup' | 'invite' | 'recovery' | 'email_change' | 'email';

export type SignInLink =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'otp'; tokenHash: string; type: SignInOtpType };

const OTP_TYPES: SignInOtpType[] = ['magiclink', 'signup', 'invite', 'recovery', 'email_change', 'email'];

/** The two shapes Supabase sends: `#access_token=…&refresh_token=…`, or
 *  `?token_hash=…&type=…`. Null when the link carries neither. */
export function readSignInLink(search: string, hash: string): SignInLink | null {
  const h = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = h.get('access_token');
  const refreshToken = h.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const tokenHash = q.get('token_hash') ?? q.get('token');
  if (!tokenHash) return null;
  const type = q.get('type') as SignInOtpType | null;
  return { kind: 'otp', tokenHash, type: type && OTP_TYPES.includes(type) ? type : 'magiclink' };
}

/** The account a session link is for, asked of the auth server with the
 *  link's own access token, so the name on screen is the server's and not
 *  whatever the token claims. A plain request on purpose: supabase-js's
 *  getUser(jwt) signs the box out when that token's session is gone, so a
 *  stale link would sign the viewer out before they said anything. Null
 *  when the token is no longer good; the link is then offered without a name. */
export async function signInLinkEmail(accessToken: string): Promise<string | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? window.setTimeout(() => ctrl.abort(), 8000) : 0;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: ctrl?.signal,
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { email?: unknown } | null;
    return typeof user?.email === 'string' && user.email ? user.email : null;
  } catch {
    return null;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
