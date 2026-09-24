// Pairing codes, the caller's address and the phone's kind, for the
// phone-remote function. No imports, so the app's tests can load it.

// Eight letters from twenty consonants: no digits, no vowels (so no 0/O,
// 1/I/L mix-ups and no words), typed on a phone's letter keyboard without
// switching to numbers. 20^8 is about 2.6e10 codes.
export const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE_LENGTH = 8;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A fresh random code (uniform over the alphabet). */
export function newCode(): string {
  let out = '';
  const buf = new Uint8Array(16);
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      // 240 = 12 × 20: bytes above it would favour the first letters.
      if (b < 240 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** What the phone typed, as a code, or null when it can't be one. */
export function normalizeCode(raw: unknown): string | null {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return CODE_RE.test(s) ? s : null;
}

// ── the caller's address ───────────────────────────────────────────────────
//
// Requests reach the function through Cloudflare. It sets cf-connecting-ip
// to the address that connected to it, replacing whatever the caller sent,
// but it APPENDS that address to any X-Forwarded-For the caller sent
// ("forged, real"). So the first X-Forwarded-For entry is the caller's to
// choose and never counts here. cf-connecting-ip wins; without it, the
// right-most X-Forwarded-For entry that is a public, non-Cloudflare address
// (the one the platform added). An IPv6 /64 is one caller: a single machine
// can use any address inside it.

type Headers_ = { get(name: string): string | null };

function v4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((n) => n <= 255) ? b : null;
}

function v6(s: string): number[] | null {
  let t = s.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(t);
  if (tail) {
    const b = v4(tail[2]);
    if (!b) return null;
    t = `${tail[1]}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const out: number[] = [];
  for (const g of groups) { const n = parseInt(g, 16); out.push(n >> 8, n & 0xff); }
  return out;
}

type Ip = { v: 4 | 6; b: number[] };
export function parseIp(raw: string | null | undefined): Ip | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const a = v4(s);
  if (a) return { v: 4, b: a };
  const c = v6(s);
  if (!c) return null;
  // ::ffff:a.b.c.d is IPv4.
  if (c.slice(0, 10).every((x) => x === 0) && c[10] === 0xff && c[11] === 0xff) return { v: 4, b: c.slice(12) };
  return { v: 6, b: c };
}

const cidr = (text: string) => { const [a, bits] = text.split('/'); const p = parseIp(a)!; return { v: p.v, b: p.b, bits: Number(bits) }; };
const inCidr = (ip: Ip, c: { v: 4 | 6; b: number[]; bits: number }) => {
  if (ip.v !== c.v) return false;
  for (let i = 0, bits = c.bits; i < c.b.length && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((ip.b[i] & mask) !== (c.b[i] & mask)) return false;
  }
  return true;
};
// Private, loopback, link-local, carrier NAT, unspecified: a hop inside the
// platform, not a caller. Cloudflare's own ranges (cloudflare.com/ips) too.
const NOT_A_CALLER = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '::/127', 'fc00::/7', 'fe80::/10',
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
].map(cidr);
const isCaller = (ip: Ip) => !NOT_A_CALLER.some((c) => inCidr(ip, c));

const bucket = (ip: Ip): string => {
  if (ip.v === 4) return ip.b.join('.');
  const g: string[] = [];
  for (let i = 0; i < 8; i += 2) g.push(((ip.b[i] << 8) | ip.b[i + 1]).toString(16));
  return `${g.join(':')}::/64`;
};

/**
 * The key the per-address limits count by ('unknown' when there is none),
 * and which header it came from (for a log line; never the address itself).
 */
export function clientIp(headers: Headers_): { key: string; from: 'cf-connecting-ip' | 'x-forwarded-for' | 'x-real-ip' | 'none' } {
  const cf = parseIp(headers.get('cf-connecting-ip'));
  if (cf && isCaller(cf)) return { key: bucket(cf), from: 'cf-connecting-ip' };
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => parseIp(s)).filter((p): p is Ip => !!p);
  for (let i = hops.length - 1; i >= 0; i--) if (isCaller(hops[i])) return { key: bucket(hops[i]), from: 'x-forwarded-for' };
  const real = parseIp(headers.get('x-real-ip'));
  if (real && isCaller(real)) return { key: bucket(real), from: 'x-real-ip' };
  return { key: 'unknown', from: 'none' };
}
export const clientIpKey = (headers: Headers_): string => clientIp(headers).key;

// ── what the TV shows about the phone ──────────────────────────────────────
// Worked out here from the browser's User-Agent, one of a few fixed phrases,
// so nothing the caller types ever appears on the TV.
export const PHONE_KINDS = ['An iPhone', 'An iPad', 'An Android phone', 'An Android tablet', 'A phone or computer'] as const;
export function phoneKind(ua: string | null | undefined): (typeof PHONE_KINDS)[number] {
  const s = String(ua ?? '');
  if (/iPhone|iPod/i.test(s)) return 'An iPhone';
  if (/iPad/i.test(s) || (/Macintosh/i.test(s) && /Mobile/i.test(s))) return 'An iPad';
  if (/Android/i.test(s)) return /Mobile/i.test(s) ? 'An Android phone' : 'An Android tablet';
  return 'A phone or computer';
}
