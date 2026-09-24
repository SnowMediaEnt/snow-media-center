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

// ── The caller's address ────────────────────────────────────────────────────
// Only an address someone could be calling from counts: a private, loopback,
// carrier-NAT or Cloudflare address is a hop inside the platform, and keying
// a limit on one would put every viewer in one bucket, turning a per-IP limit
// into a global one.

/** 16 bytes (IPv4 as ::ffff:a.b.c.d), or null if it is not an address. */
function ipBytes(raw: string): number[] | null {
  const s = raw.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const b = v4.slice(1).map(Number);
    return b.every((n) => n <= 255) ? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, ...b] : null;
  }
  if (!s.includes(':')) return null;
  let text = s;
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text); // ::ffff:1.2.3.4
  if (tail) {
    const b = ipBytes(tail[2]);
    if (!b) return null;
    text = `${tail[1]}${((b[12] << 8) | b[13]).toString(16)}:${((b[14] << 8) | b[15]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(Math.max(0, fill)).fill('0'), ...rest];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 0xff]; });
}

const isV4 = (b: number[]) => b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff;

/** CIDR list as [bytes, prefix bits], IPv4 ones in their ::ffff: form. */
const nets = (list: string[]) => list.map((c) => {
  const [a, bits] = c.split('/');
  return [ipBytes(a)!, Number(bits) + (a.includes(':') ? 0 : 96)] as const;
});
const inNet = (b: number[], [base, bits]: readonly [number[], number]) => {
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((b[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
};
const NOT_A_CALLER = nets([
  // unspecified, private, carrier NAT, loopback, link-local
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '::/127', 'fc00::/7', 'fe80::/10',
  // Cloudflare (cloudflare.com/ips)
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]);

/** The bucket for a caller address (IPv4 as is, IPv6 by its /64: one
 *  machine can pick any address inside it), or null for anything else. */
function callerBucket(raw: string | null | undefined): string | null {
  const b = raw ? ipBytes(raw) : null;
  if (!b || NOT_A_CALLER.some((n) => inNet(b, n))) return null;
  if (isV4(b)) return b.slice(12).join('.');
  const g: string[] = [];
  for (let i = 0; i < 8; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return `${g.join(':')}::/64`;
}

function pickClientIp(headers: Headers): { ip: string | null; from: string } {
  const cf = callerBucket(headers.get('cf-connecting-ip'));
  if (cf) return { ip: cf, from: 'cf-connecting-ip' };
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = callerBucket(hops[i]);
    if (ip) return { ip, from: `x-forwarded-for hop ${i + 1} of ${hops.length}` };
  }
  const real = callerBucket(headers.get('x-real-ip'));
  return real ? { ip: real, from: 'x-real-ip' } : { ip: null, from: 'none (not limited)' };
}

/**
 * The caller's IP, as the key for per-IP limits. Cloudflare sets
 * cf-connecting-ip itself, so it comes first. Failing that, x-forwarded-for
 * read from the right: each proxy appends the address it saw, so the last
 * caller address in it is the nearest one the platform saw, and anything
 * before it is whatever the caller sent. (The older copies of this, ai-guard
 * hashClientIp and friends, take the first entry, which the caller chooses.)
 * Null when there is no caller address at all: the throttle then lets the
 * call through rather than lump everyone together.
 */
export function clientIp(headers: Headers): string | null {
  return pickClientIp(headers).ip;
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
/** Once per instance: which address headers arrive and which one the per-IP
 *  limits used (never the addresses themselves), so the owner can check it
 *  in the logs. */
export function logIpHeadersOnce(tag: string, headers: Headers): void {
  if (ipHeadersLogged) return;
  ipHeadersLogged = true;
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').filter((s) => s.trim()).length;
  console.log(`[${tag}] ip headers: cf-connecting-ip=${headers.has('cf-connecting-ip') ? 'yes' : 'no'} x-forwarded-for=${hops} hop(s) x-real-ip=${headers.has('x-real-ip') ? 'yes' : 'no'}; limits use: ${pickClientIp(headers).from}`);
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
