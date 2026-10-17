// Email a customer the streaming login they just got.
//
// WHY THIS EXISTS: the SMC Account API deliberately sends nothing —
// docs/billing/API.md is explicit, "Creates the WHMCS client (no email is
// sent)" and "No email is involved anywhere; everything the app needs is in
// the JSON responses." So after a trial or a purchase the username and
// password exist only on the TV screen. If the viewer walks away, or the box
// is wiped, that line is gone. This mails them a copy.
//
// WHY IT IS NOT send-custom-email: that function has no config.toml entry, so
// it requires a Supabase JWT. A customer who signed up through the billing
// account has a WHMCS account, not a Supabase session — they have no JWT to
// send. It also takes caller-supplied `html`, which must never be reachable
// anonymously.
//
// AUTH MODEL — the same one player-favorites uses, and for the same reason:
// there is no session to check, so the credentials themselves are the proof.
// The line is verified against the panel before anything is sent. The body is
// composed HERE; the caller supplies no markup, only where to send it. So the
// worst a caller can do is mail a copy of a line they already hold to an
// address of their choosing, at a throttled rate — not use this as an open
// relay.
//
// Nothing here logs the password, the email body, or the address.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { Resend } from 'npm:resend@4.0.0';

const REQUEST_TIMEOUT_MS = 8000;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_IP = 10;   // a household setting up several boxes
const MAX_PER_LINE = 3;  // one send, plus a couple of "it didn't arrive" retries

// Verified sender if the operator has set one up in Resend; otherwise Resend's
// shared sandbox address, which only delivers to the Resend account owner.
const FROM = Deno.env.get('EMAIL_FROM') || 'Snow Media <onboarding@resend.dev>';

// The From is a no-reply on a sending subdomain, so point replies at a mailbox
// that is actually read. A customer whose login does not work will hit Reply
// before they find the support page.
const REPLY_TO = Deno.env.get('EMAIL_REPLY_TO') || 'support@snowmediaent.com';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Ports a panel is commonly served over TLS on. dstreams is handed to us as
// dstreams.xyz:2083 — asking that over plain http gets the gateway's HTML
// error page, which is exactly what made a live line read as a wrong password.
const TLS_PORTS = new Set(['443', '2053', '2083', '2087', '2096', '8443']);

/**
 * Base URLs to try for a panel, best first.
 *
 * A scheme the caller supplied wins: the billing API returns a full
 * credentials.host and knows better than any guess made here. Without one the
 * port decides, and a host with no port at all is assumed to be TLS. The other
 * scheme is kept as a fallback because getting this wrong is SILENT — the
 * gateway answers with an HTML error page, not a redirect.
 */
function panelBases(rawHost: string): string[] {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/(.+)$/i.exec(trimmed);
  const bare = (m ? m[2] : trimmed).replace(/\/+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1];
  const first = m ? m[1].toLowerCase() : (port ? (TLS_PORTS.has(port) ? 'https' : 'http') : 'https');
  const second = first === 'https' ? 'http' : 'https';
  return [`${first}://${bare}`, `${second}://${bare}`];
}

// A panel's admin UI and its player API are different doors on the same
// machine. cPanel-style ports serve the login page and answer 404 for
// player_api.php, so a host recorded from the panel address can never verify
// a line no matter which scheme is used. When the host we are handed looks
// like that, try the streaming ports on the same hostname before giving up.
const PANEL_ONLY_PORTS = new Set(['2082', '2083', '2086', '2087']);
const STREAM_FALLBACKS: Array<[string, string]> = [
  ['http', '8080'], ['https', '2096'], ['http', '8000'], ['http', '25461'],
];

/** Every base worth trying for this host, best first, de-duplicated. */
function candidateBases(rawHost: string): string[] {
  const out: string[] = [];
  const push = (b: string) => { if (!out.includes(b)) out.push(b); };
  for (const b of panelBases(rawHost)) push(b);
  const bare = rawHost.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const name = bare.replace(/:\d+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1] ?? '';
  // Only ever the hostname we were already given — the port is the guess.
  if (name && (!port || PANEL_ONLY_PORTS.has(port))) {
    for (const [scheme, p] of STREAM_FALLBACKS) push(`${scheme}://${name}:${p}`);
  }
  return out;
}

/** Every attempt gets its own timeout; this caps the search as a whole. */
const TOTAL_BUDGET_MS = 20000;


/** Scheme-less form, used only as a throttle key so http/https share a bucket. */
const bareHost = (h: string) => h.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');

// Deliberately conservative: this address is handed straight to the mail
// provider, so anything exotic is rejected rather than escaped.
const EMAIL_RE = /^[^\s@,;<>"']{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const HTML_ESCAPES: Record<string, string> = {
  '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
};
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => HTML_ESCAPES[c] ?? c);

interface ThrottleDb {
  rpc(fn: 'throttle_hit', args: { p_key: string; p_window_ms: number }): PromiseLike<{ data: unknown; error: unknown }>;
}

// ── The caller's address (same rule as _shared/requestGuard.ts clientIp +
// hashIp, kept inline so this file can be pasted into the dashboard editor as
// a single unit) ─────────────────────────────────────────────────────────────
// cf-connecting-ip first: Cloudflare sets it, while the first x-forwarded-for
// entry is whatever the caller sent, so keying on that let a script dodge the
// per-IP limit with a new first hop on every call. Then x-forwarded-for read
// from the right, then x-real-ip. A private, loopback, carrier-NAT or
// Cloudflare address is a hop inside the platform and is skipped, or every
// viewer would share one bucket. An IPv6 /64 counts as one caller.

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

/** The bucket for a caller address (IPv4 as is, IPv6 by its /64), or null for anything else. */
function callerBucket(raw: string | null | undefined): string | null {
  const b = raw ? ipBytes(raw) : null;
  if (!b || NOT_A_CALLER.some((n) => inNet(b, n))) return null;
  if (isV4(b)) return b.slice(12).join('.');
  const g: string[] = [];
  for (let i = 0; i < 8; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return `${g.join(':')}::/64`;
}

/** The caller's address for the per-IP limit, or null when there is none (then it is not limited). */
function clientIp(headers: Headers): string | null {
  const cf = callerBucket(headers.get('cf-connecting-ip'));
  if (cf) return cf;
  const hops = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const ip = callerBucket(hops[i]);
    if (ip) return ip;
  }
  return callerBucket(headers.get('x-real-ip'));
}

/** sha256 hex of the IP, so the throttle table never holds an address. */
async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Shares player_login_throttle under its own prefixes, so this never spends player-login's budget. */
async function throttle(admin: ThrottleDb, key: string | null, max: number): Promise<boolean> {
  if (!key) return true;
  try {
    // One statement (public.throttle_hit), so calls arriving together each
    // get their own count instead of all reading the same one.
    const { data, error } = await admin.rpc('throttle_hit', { p_key: key, p_window_ms: THROTTLE_WINDOW_MS });
    if (error) throw new Error((error as { message?: string }).message ?? String(error));
    if (typeof data !== 'number') throw new Error(`throttle_hit returned ${JSON.stringify(data)}`);
    return data <= max;
  } catch (e) {
    // Fail open: a throttle-table outage must not stop a paying customer
    // receiving the line they just bought.
    console.warn('[email-line-credentials] throttle fail-open:', (e as Error).message);
    return true;
  }
}

/** The credentials are the proof of ownership; check them before sending anything. */
// Panels commonly sit behind an nginx rule that rejects anything that does not
// look like a media player, and it answers 401 with an HTML page. Read as a
// status code alone that is indistinguishable from a wrong password — which is
// exactly what went wrong: a real, working line was reported as bad
// credentials and no email was ever sent.
//
// Two changes. Ask with agents a panel expects, trying a device browser and
// then a player. And decide from the BODY, not the status: only JSON that
// actually carries user_info can say a login is wrong. Anything else is the
// panel being unreachable, which is honest and retryable.
// Ordered most-likely-first. The Dalvik agent is what the app's own native
// HTTP sends today, and the app reaches this panel fine — so it is the one
// with direct evidence behind it. The rest cover the usual gateway allowlists.
// Only the failure path costs extra requests: the first agent that gets a JSON
// answer wins and the loop stops.
const PANEL_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)',
  'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
  'VLC/3.0.20 LibVLC/3.0.20',
  'okhttp/4.12.0',
];

/**
 * What to print in the email as the server address.
 *
 * The panel's own reply names the address it wants players to use, and that
 * beats both the base we happened to reach it on and whatever host the caller
 * passed in — a customer who types the panel's login URL into the Player gets
 * nowhere.
 */
function displayHost(data: unknown, base: string): string {
  const si = (data as { server_info?: Record<string, unknown> } | null)?.server_info;
  const url = typeof si?.url === 'string' ? si.url.trim() : '';
  const port = si?.port == null ? '' : String(si.port).trim();
  if (url) return port && port !== '80' ? `${url}:${port}` : url;
  return base.replace(/^https?:\/\//i, '');
}

/**
 * Flat rather than a discriminated union: this project's edge functions are
 * read alongside a `strict: false` app, and a flat shape needs no narrowing.
 */
interface Verdict {
  kind: 'ok' | 'auth_failed' | 'unreachable';
  /** Set when ok: the address the panel says players should use. */
  host?: string;
}

async function verifyLine(host: string, username: string, password: string): Promise<Verdict> {
  const query =
    `/player_api.php?username=` +
    encodeURIComponent(username) + `&password=` + encodeURIComponent(password);
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (const base of candidateBases(host)) {
    for (const ua of PANEL_AGENTS) {
      if (Date.now() > deadline) break;
      // One controller per attempt. A shared one stays aborted after the
      // first timeout, so every later base failed instantly and the fallbacks
      // were never really tried.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
      let text: string;
      try {
        const res = await fetch(base + query, {
          signal: ctrl.signal,
          headers: { 'User-Agent': ua, Accept: 'application/json' },
        });
        text = (await res.text()).trim();
      } catch {
        // Wrong scheme, wrong port, or an agent the gateway refuses.
        continue;
      } finally {
        clearTimeout(timer);
      }
      // An HTML page is the gateway talking, never the panel answering.
      if (!text.startsWith('{')) continue;
      let data: unknown;
      try { data = JSON.parse(text); } catch { continue; }
      const ui = (data as { user_info?: Record<string, unknown> })?.user_info;
      if (!ui) continue;
      const auth = ui.auth;
      if (!(auth === 1 || auth === '1' || auth === true)) return { kind: 'auth_failed' };
      return { kind: 'ok', host: displayHost(data, base) };
    }
  }
  console.warn('[email-line-credentials] no JSON from any base or agent — wrong host, or a gateway block?');
  return { kind: 'unreachable' };
}

function buildHtml(o: {
  username: string; password: string; host: string; serverLabel: string;
  planName: string | null; expiresAt: string | null;
}): string {
  const rows: Array<[string, string]> = [
    ['Username', o.username],
    ['Password', o.password],
    ['Server', o.host],
  ];
  if (o.planName) rows.unshift(['Plan', o.planName]);
  if (o.expiresAt) rows.push(['Expires', o.expiresAt]);

  const cells = rows.map(([k, v]) => `
        <tr>
          <td style="padding:10px 14px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;">${esc(k)}</td>
          <td style="padding:10px 14px;color:#111827;font-size:16px;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;">${esc(v)}</td>
        </tr>`).join('');

  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f6f8;">
  <div style="background:#ffffff;border-radius:12px;padding:28px;box-shadow:0 2px 10px rgba(0,0,0,.08);">
    <h1 style="margin:0 0 6px;color:#0A2147;font-size:22px;">Your ${esc(o.serverLabel)} login</h1>
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Keep this email — it is the only copy of your password we send. Enter these in the Player on your TV.
    </p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">${cells}
    </table>
    <p style="margin:22px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
      Do not share these details. Anyone with them can watch on your connections.
      Need help? <a href="mailto:support@snowmediaent.com" style="color:#2563eb;">support@snowmediaent.com</a>
    </p>
  </div>
</div>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const email = String(body.email ?? '').trim();
  const host = String(body.host ?? '').trim().replace(/\/+$/, '');
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  const serverLabel = String(body.serverLabel ?? '').trim() || 'Snow Media';
  const planName = body.planName ? String(body.planName).trim().slice(0, 120) : null;
  const expiresAt = body.expiresAt ? String(body.expiresAt).trim().slice(0, 60) : null;

  if (!email || !EMAIL_RE.test(email) || email.length > 254) return json({ error: 'invalid_email' }, 400);
  if (!host || !username || !password) return json({ error: 'missing_credentials' }, 400);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('[email-line-credentials] RESEND_API_KEY is not set');
    return json({ error: 'email_unavailable' }, 503);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const admin = url && serviceKey
    ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;

  if (admin) {
    const ipHash = await hashIp(clientIp(req.headers));
    const db = admin as unknown as ThrottleDb;
    const okIp = await throttle(db, ipHash ? `emailip:${ipHash}` : null, MAX_PER_IP);
    const okLine = await throttle(db, `emailline:${bareHost(host)}|${username.toLowerCase()}`, MAX_PER_LINE);
    if (!okIp || !okLine) return json({ error: 'rate_limited' }, 429);
  }

  const verdict = await verifyLine(host, username, password);
  if (verdict.kind === 'auth_failed') return json({ error: 'invalid_credentials' }, 401);
  if (verdict.kind === 'unreachable') return json({ error: 'panel_unreachable' }, 502);
  // Print the address the panel gave us, not the one we were asked about.
  const playerHost = verdict.host || host;

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: [email],
      replyTo: REPLY_TO,
      subject: `Your ${serverLabel} login details`,
      html: buildHtml({ username, password, host: playerHost, serverLabel, planName, expiresAt }),
    });
    if (error) {
      // Message only — never the address or the payload.
      console.error('[email-line-credentials] send failed:', (error as { message?: string }).message ?? 'unknown');
      return json({ error: 'send_failed' }, 502);
    }
  } catch (e) {
    console.error('[email-line-credentials] send threw:', (e as Error).message);
    return json({ error: 'send_failed' }, 502);
  }

  return json({ ok: true });
});
