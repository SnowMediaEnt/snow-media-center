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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const db = admin as unknown as ThrottleDb;
    const okIp = await throttle(db, ip ? `emailip:${ip}` : null, MAX_PER_IP);
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
