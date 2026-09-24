// The caller's address, for the per-caller limits (free AI, sign-in
// captures, channel reports). No imports, so the app's tests can load it.
//
// Requests reach the functions through Cloudflare. Cloudflare sets
// cf-connecting-ip to the address that connected to it, replacing anything
// the caller sent, but it APPENDS that address to whatever x-forwarded-for
// the caller sent. So the first x-forwarded-for entry is the caller's to
// choose, and a script that sends a new one with every request never meets a
// per-IP limit keyed on it.
//
// cf-connecting-ip therefore wins when it holds a public address. It is
// passed over when it holds a private or Cloudflare address: that would be a
// hop inside the platform, not the caller, and using it would put every
// viewer into one bucket and turn a per-IP limit into a global one. The old
// order (first x-forwarded-for entry, then x-real-ip) is the fallback, so
// nothing changes where the header is missing.
//
// IPv6 is keyed by its /64: a household's devices share one, and a single
// machine can pick any address inside it.

type HeaderSource = { get(name: string): string | null };

type Parsed = { v: 4; bytes: number[] } | { v: 6; bytes: number[] };

function parseV4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const out = m.slice(1).map(Number);
  return out.every((n) => n <= 255) ? out : null;
}

function parseV6(s: string): number[] | null {
  let text = s.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  // An IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const v4Tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4Tail) {
    const b = parseV4(v4Tail[2]);
    if (!b) return null;
    text = `${v4Tail[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  return bytes;
}

export function parseIp(raw: string | null | undefined): Parsed | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const v4 = parseV4(s);
  if (v4) return { v: 4, bytes: v4 };
  const v6 = parseV6(s);
  if (!v6) return null;
  // IPv4-mapped (::ffff:a.b.c.d) is really IPv4.
  if (v6.slice(0, 10).every((b) => b === 0) && v6[10] === 0xff && v6[11] === 0xff) {
    return { v: 4, bytes: v6.slice(12) };
  }
  return { v: 6, bytes: v6 };
}

function inCidr(bytes: number[], base: number[], bits: number): boolean {
  for (let i = 0; i < base.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
}

const cidr = (text: string): { v: 4 | 6; base: number[]; bits: number } => {
  const [addr, bits] = text.split('/');
  const p = parseIp(addr)!;
  return { v: p.v, base: p.bytes, bits: Number(bits) };
};

// Not a caller: private, loopback, link-local, carrier NAT, unspecified.
const INTERNAL = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '::/127', 'fc00::/7', 'fe80::/10',
].map(cidr);

// Cloudflare's own ranges (cloudflare.com/ips).
const CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
].map(cidr);

const matches = (p: Parsed, list: Array<{ v: 4 | 6; base: number[]; bits: number }>) =>
  list.some((c) => c.v === p.v && inCidr(p.bytes, c.base, c.bits));

/** True for an address a caller could be connecting from. */
export function isCallerAddress(p: Parsed): boolean {
  return !matches(p, INTERNAL) && !matches(p, CLOUDFLARE);
}

/** One key per caller: the IPv4 address, or the IPv6 /64. */
export function ipBucket(p: Parsed): string {
  if (p.v === 4) return p.bytes.join('.');
  const g: string[] = [];
  for (let i = 0; i < 8; i += 2) g.push(((p.bytes[i] << 8) | p.bytes[i + 1]).toString(16));
  return `${g.join(':')}::/64`;
}

/**
 * The key the per-IP limits count by, or null when the request carries no
 * address at all.
 */
export function clientIpKey(headers: HeaderSource): string | null {
  const cf = parseIp(headers.get('cf-connecting-ip'));
  if (cf && isCallerAddress(cf)) return ipBucket(cf);
  const xff = headers.get('x-forwarded-for');
  const first = xff ? xff.split(',')[0]?.trim() || null : null;
  const raw = first || headers.get('cf-connecting-ip')?.trim() || headers.get('x-real-ip')?.trim() || null;
  if (!raw) return null;
  const p = parseIp(raw);
  return p ? ipBucket(p) : raw;
}

/** Hex SHA-256 of clientIpKey (with an optional prefix), or null. */
export async function hashClientIpKey(headers: HeaderSource, prefix = ''): Promise<string | null> {
  const key = clientIpKey(headers);
  if (!key) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prefix + key));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
