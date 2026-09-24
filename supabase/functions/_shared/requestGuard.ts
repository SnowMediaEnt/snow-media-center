// Small guards for the edge functions anyone can reach (verify_jwt = false,
// or only the public anon key needed). No Deno APIs here, so the app's tests
// can import it.
//
//   internalSecretOk  server-to-server calls: pg_net triggers and other edge
//                     functions send x-internal-secret = INTERNAL_FN_SECRET.
//   clientIp          the caller's address for per-IP limits.
//   throttle          a counter per key in public.player_login_throttle.
//   htmlToText        what an HTML body says, as plain text to escape again.

/** Both sides trimmed, so a secret pasted with a trailing newline still
 *  matches. An unset secret never matches anything. */
export function internalSecretOk(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const want = (expected ?? '').trim();
  const got = (provided ?? '').trim();
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/**
 * The caller's IP. Cloudflare sets cf-connecting-ip itself, so it comes
 * first. Failing that, the LAST x-forwarded-for entry: the edge appends the
 * address it saw, and anything before it is whatever the caller sent. The
 * other copies of this (ai-guard hashClientIp and friends) take the first
 * entry, which the caller chooses.
 */
export function clientIp(headers: Headers): string | null {
  const cf = headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return headers.get('x-real-ip')?.trim() || null;
}

/** sha256 hex of the IP, so the throttle table never holds an address. */
export async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

let ipHeadersLogged = false;
/** Once per instance: which address headers arrive (never their values), so
 *  the owner can see from the logs which one the per-IP limits use. */
export function logIpHeadersOnce(tag: string, headers: Headers): void {
  if (ipHeadersLogged) return;
  ipHeadersLogged = true;
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').filter((s) => s.trim()).length;
  console.log(`[${tag}] ip headers: cf-connecting-ip=${headers.has('cf-connecting-ip') ? 'yes' : 'no'} x-forwarded-for=${hops} hop(s) x-real-ip=${headers.has('x-real-ip') ? 'yes' : 'no'}`);
}

// The slice of a service-role client the throttle uses, typed by shape (see
// player-favorites for why not ReturnType<typeof createClient>).
interface ThrottleRow { count: number | null; window_start: string }
export interface ThrottleDb {
  from: (table: 'player_login_throttle') => {
    select: (cols: string) => {
      eq: (col: string, v: string) => { maybeSingle: () => PromiseLike<{ data: ThrottleRow | null }> };
    };
    upsert: (row: Record<string, unknown>, opts: { onConflict: string }) => PromiseLike<unknown>;
    update: (row: Record<string, unknown>) => { eq: (col: string, v: string) => PromiseLike<unknown> };
  };
}

/**
 * Counts one call against `key` and says whether it is within `max` per
 * `windowMs`. Shares player_login_throttle with player-login and the others,
 * each under its own key prefix. A missing key (no IP) is let through, and so
 * is a table error: a throttle outage must not take the feature down.
 */
export async function throttle(db: ThrottleDb, key: string | null, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  if (!key) return true;
  try {
    const windowStart = new Date(now - windowMs).toISOString();
    const { data } = await db.from('player_login_throttle').select('count, window_start').eq('ip_hash', key).maybeSingle();
    if (!data || data.window_start < windowStart) {
      await db.from('player_login_throttle').upsert({ ip_hash: key, window_start: new Date(now).toISOString(), count: 1 }, { onConflict: 'ip_hash' });
      return max >= 1;
    }
    const next = (data.count ?? 0) + 1;
    await db.from('player_login_throttle').update({ count: next }).eq('ip_hash', key);
    return next <= max;
  } catch (e) {
    console.warn('[throttle] fail-open:', e instanceof Error ? e.message : String(e));
    return true;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** The text of an HTML fragment: <br> and block ends become line breaks
 *  (source newlines are just spaces, as in a browser); tags and links go. */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/\s+/g, ' ')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (_, e: string) => ENTITIES[e] ?? '')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const escapeHtml = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
