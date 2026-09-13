// Player Login Bridge — signs a user into their Snow Media WEBSITE account
// using their STREAMING (Xtream) credentials, completing the bidirectional
// link: ClaimAccountCard covers app-account -> line; this covers line -> app.
//
// Flow: verify the line SERVER-side against the allowlisted panel, find the
// auth user linked to that exact line (player_signins.supabase_user_id or
// customer_services -> customers.user_id), and when there is none yet but the
// hub has the line on file with an email that has no account yet, create the
// account for that email and tie it to the customer (never attach to an
// existing account by email). Then mint a one-time magiclink token_hash
// the client consumes with supabase.auth.verifyOtp(). We never return raw
// credentials and never link by guessable data: the line must authenticate
// against the panel, and the email comes from the hub's own record.
//
// verify_jwt = false (see supabase/config.toml). Soft failures return
// HTTP 200 with { ok:false, reason } like capture-player-signin.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Same as _shared/ai-guard.ts hashClientIp, kept inline so this file can be
// pasted into the dashboard editor as a single unit.
async function hashClientIp(req: Request): Promise<string | null> {
  const xff = req.headers.get('x-forwarded-for');
  const cf = req.headers.get('cf-connecting-ip');
  const real = req.headers.get('x-real-ip');
  let ip: string | null = null;
  if (xff) ip = xff.split(',')[0]?.trim() || null;
  if (!ip && cf) ip = cf.trim();
  if (!ip && real) ip = real.trim();
  if (!ip) return null;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'dstreams.xyz:2083', 'strmz.xyz'] as const;
const MAX_BODY_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 12_000;

// Stricter than capture-player-signin: this endpoint mints sessions, so it is
// a credential-stuffing target. 10 attempts / 5 min / IP, and 6 per line.
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX_PER_IP = 10;
const THROTTLE_MAX_PER_LINE = 6;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
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


const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

// Panels commonly sit behind an nginx rule that rejects anything that does not
// look like a media player, answering 401 with an HTML page. Judged by status
// alone that is indistinguishable from a wrong password, so a working line was
// reported as bad credentials. Ask with agents a panel expects, and decide
// from the BODY: only JSON carrying user_info can say a login is wrong.
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

async function verifyLine(host: string, username: string, password: string): Promise<
  { kind: 'ok'; userInfo: Record<string, unknown> } | { kind: 'auth_failed' } | { kind: 'unreachable' }
> {
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
      const authed = auth === 1 || auth === '1' || auth === true;
      return authed ? { kind: 'ok', userInfo: ui } : { kind: 'auth_failed' };
    }
  }
  console.warn('[player-login] no JSON from any base or agent — wrong host, or a gateway block?');
  return { kind: 'unreachable' };
}


// ── line → customer (as the hub records it) ────────────────────────────────
// Same rule as capture-player-signin: hostnames compared without scheme or
// port, usernames case-insensitively and then exactly, newest row wins.
const hostnameOf = (h: string | null | undefined): string =>
  String(h ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

interface LineCustomer { id: string; email: string | null; user_id: string | null }

async function customerForLine(
  admin: ReturnType<typeof createClient>,
  host: string,
  username: string,
): Promise<LineCustomer | null> {
  const pattern = username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await admin
    .from('customer_services')
    .select('customer_id, panel_host, panel_username, created_at')
    .ilike('panel_username', pattern)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  const want = hostnameOf(host);
  const rows = (data ?? []) as Array<{ customer_id: string; panel_host: string | null; panel_username: string | null }>;
  const exact = rows.filter((r) => String(r.panel_username ?? '').trim().toLowerCase() === username);
  const onHost = exact.find((r) => hostnameOf(r.panel_host) === want) ?? exact.find((r) => !hostnameOf(r.panel_host));
  if (!onHost) return null;
  const { data: cust, error: custErr } = await admin
    .from('customers')
    .select('id, email, user_id')
    .eq('id', onHost.customer_id)
    .maybeSingle();
  if (custErr) throw custErr;
  return (cust as LineCustomer | null) ?? null;
}

// A NEW website account for the hub's email, confirmed because the hub
// vouches for it and the line just authenticated. Deliberately never attaches
// to an account that already exists for that email: a mistyped email in the
// hub must not hand a line holder someone else's account. In that case the
// member signs in with their email as before and links from the Player.
// A member who later wants a password uses "Forgot password".
async function createUserIfAbsent(admin: ReturnType<typeof createClient>, email: string): Promise<string | null> {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data?.user?.id) {
    if (!/already|exists|registered/i.test(created.error?.message ?? '')) {
      console.warn('[player-login] createUser failed:', created.error?.message);
    }
    return null;
  }
  return created.data.user.id;
}

async function throttle(
  admin: ReturnType<typeof createClient>,
  key: string | null,
  max: number,
): Promise<boolean> {
  if (!key) return true;
  try {
    const windowStart = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString();
    const { data } = await admin
      .from('player_login_throttle')
      .select('count, window_start')
      .eq('ip_hash', key)
      .maybeSingle();
    if (!data || data.window_start < windowStart) {
      await admin
        .from('player_login_throttle')
        .upsert({ ip_hash: key, window_start: new Date().toISOString(), count: 1 }, { onConflict: 'ip_hash' });
      return true;
    }
    const nextCount = (data.count ?? 0) + 1;
    await admin.from('player_login_throttle').update({ count: nextCount }).eq('ip_hash', key);
    return nextCount <= max;
  } catch (e) {
    console.warn('[player-login] throttle fail-open:', e);
    return true;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, reason: 'body_too_large' });
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return jsonResponse({ ok: false, reason: 'bad_json' }); }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const host = normalizeHost(body.host);
    if (!host || !ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
      return jsonResponse({ ok: false, reason: 'host_not_allowed' });
    }
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password.trim() : '';
    if (!username || username.length > 256 || !password || password.length > 512) {
      return jsonResponse({ ok: false, reason: 'bad_credentials' });
    }

    // Throttle by IP and by line BEFORE touching the upstream panel, so this
    // endpoint cannot be used to brute-force the panels either.
    const ipHash = await hashClientIp(req).catch(() => null);
    if (!(await throttle(admin, ipHash, THROTTLE_MAX_PER_IP))) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }
    const lineKey = `line:${host}:${username}`;
    if (!(await throttle(admin, lineKey, THROTTLE_MAX_PER_LINE))) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }

    // 1. The line itself must authenticate. Server-side — client claims count
    //    for nothing on a session-minting path.
    const verdict = await verifyLine(host, username, password);
    if (verdict.kind === 'unreachable') return jsonResponse({ ok: false, reason: 'panel_unreachable' });
    if (verdict.kind === 'auth_failed') return jsonResponse({ ok: false, reason: 'auth_failed' });

    // 2. Find the app account this exact line is linked to. Trusted sources
    //    only: supabase_user_id stamped at an authed sign-in or completed
    //    claim. We deliberately do NOT match by email-shaped usernames or
    //    unverified claim_account_manual rows here.
    let userId: string | null = null;
    try {
      const { data } = await admin
        .from('player_signins')
        .select('supabase_user_id, matched_customer_id')
        .eq('panel_host', host)
        .eq('panel_username', username)
        .maybeSingle();
      userId = (data?.supabase_user_id as string) ?? null;
      if (!userId && data?.matched_customer_id) {
        const { data: cust } = await admin
          .from('customers')
          .select('user_id')
          .eq('id', data.matched_customer_id)
          .maybeSingle();
        userId = (cust?.user_id as string) ?? null;
      }
    } catch (e) {
      console.warn('[player-login] link lookup failed:', e);
    }

    // 2b. No link yet. The hub records every customer's line (customer_services)
    //     and email (customers). A verified line that maps to a customer with an
    //     email IS that person, so a website account is created for that email
    //     here and tied to the customer — one login for members, instead of a
    //     second account they have to make and then link. Only a NEW account is
    //     ever created (see createUserIfAbsent): an email that already has one
    //     stays not_linked, as does a line the hub does not know or a customer
    //     with no email on file, and the app offers the email sign-in as before.
    if (!userId) {
      try {
        const customer = await customerForLine(admin, host, username);
        if (customer?.user_id) {
          userId = customer.user_id;
        } else if (customer && customer.email) {
          const email = customer.email.trim().toLowerCase();
          const created = await createUserIfAbsent(admin, email);
          if (created) {
            userId = created;
            await admin.from('customers').update({ user_id: userId }).eq('id', customer.id).is('user_id', null);
          }
        }
      } catch (e) {
        console.warn('[player-login] customer link failed:', e);
      }
    }
    if (!userId) return jsonResponse({ ok: false, reason: 'not_linked' });

    // 3. Privileged accounts can never be entered through a shared IPTV line.
    try {
      const { data: roles } = await admin
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .limit(1);
      if (roles && roles.length > 0) return jsonResponse({ ok: false, reason: 'not_linked' });
    } catch (e) {
      console.error('[player-login] role check failed — refusing:', e);
      return jsonResponse({ ok: false, reason: 'error' });
    }

    // 4. Mint the one-time token for the linked account's email.
    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(userId);
    const email = userData?.user?.email;
    if (userErr || !email) return jsonResponse({ ok: false, reason: 'not_linked' });

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error('[player-login] generateLink failed:', linkErr?.message);
      return jsonResponse({ ok: false, reason: 'error' });
    }

    const masked = email.replace(/^(.).*(@.*)$/, '$1***$2');
    return jsonResponse({ ok: true, token_hash: tokenHash, email_masked: masked });
  } catch (e) {
    console.error('[player-login] unexpected:', e);
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
