// Player Login Bridge — signs a user into their Snow Media WEBSITE account
// using their STREAMING (Xtream) credentials, completing the bidirectional
// link: ClaimAccountCard covers app-account -> line; this covers line -> app.
//
// Flow: verify the line SERVER-side against the allowlisted panel, find the
// auth user linked to that exact line (player_signins.supabase_user_id or
// customer_services -> customers.user_id), and when there is none yet but the
// hub has the line on file with an email that has no account yet, create the
// account for that email and tie it to the customer (never attach to an
// existing account by email). When the Player sends the password the member
// chose on the TV, that account is created with it, so one email and one
// password work on the website and on the billing side alike; an account
// that already exists keeps its own. Then mint a one-time magiclink token_hash
// the client consumes with supabase.auth.verifyOtp(). We never return raw
// credentials and never link by guessable data: the line must authenticate
// against the panel, and the email comes from the hub's own record.
//
// verify_jwt = false (see supabase/config.toml). Soft failures return
// HTTP 200 with { ok:false, reason } like capture-player-signin.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// The caller's IP, by the same rule as _shared/clientIp.ts, kept inline so
// this file can be pasted into the dashboard editor as a single unit:
// cf-connecting-ip first (Cloudflare sets it; the first x-forwarded-for entry
// is whatever the caller sent), unless it is a private or Cloudflare address;
// an IPv6 /64 counts as one caller. The old order is the fallback.
const INTERNAL_V4 = [[0, 0, 0, 0, 8], [10, 0, 0, 0, 8], [100, 64, 0, 0, 10], [127, 0, 0, 0, 8], [169, 254, 0, 0, 16], [172, 16, 0, 0, 12], [192, 168, 0, 0, 16]];
const CLOUDFLARE_V4 = [
  [173, 245, 48, 0, 20], [103, 21, 244, 0, 22], [103, 22, 200, 0, 22], [103, 31, 4, 0, 22], [141, 101, 64, 0, 18],
  [108, 162, 192, 0, 18], [190, 93, 240, 0, 20], [188, 114, 96, 0, 20], [197, 234, 240, 0, 22], [198, 41, 128, 0, 17],
  [162, 158, 0, 0, 15], [104, 16, 0, 0, 13], [104, 24, 0, 0, 14], [172, 64, 0, 0, 13], [131, 0, 72, 0, 22],
];
const CLOUDFLARE_V6 = ['2400:cb00:', '2606:4700:', '2803:f800:', '2405:b500:', '2405:8100:', '2c0f:f248:'];

function callerAddress(raw: string | null): string | null {
  const ip = (raw ?? '').trim().toLowerCase();
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const n = v4.slice(1).map(Number);
    if (n.some((x) => x > 255)) return null;
    const num = ((n[0] << 24) >>> 0) + (n[1] << 16) + (n[2] << 8) + n[3];
    const inRange = ([a, b, c, d, bits]: number[]) => {
      const base = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((num & mask) >>> 0) === ((base & mask) >>> 0);
    };
    return INTERNAL_V4.some(inRange) || CLOUDFLARE_V4.some(inRange) ? null : n.join('.');
  }
  if (!ip.includes(':') || !/^[0-9a-f:]+$/.test(ip)) return null;
  if (ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return null;
  if (CLOUDFLARE_V6.some((p) => ip.startsWith(p)) || /^2a06:98c[0-7]:/.test(ip)) return null;
  // A household's IPv6 devices share a /64: key on it.
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  if (groups.length !== 8) return null;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

async function hashClientIp(req: Request): Promise<string | null> {
  const xff = req.headers.get('x-forwarded-for');
  const cf = req.headers.get('cf-connecting-ip');
  const real = req.headers.get('x-real-ip');
  let ip: string | null = callerAddress(cf);
  if (!ip && xff) ip = xff.split(',')[0]?.trim() || null;
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

// ── profile typed on the TV ────────────────────────────────────────────────

interface Profile {
  name: string | null;
  email: string | null;
  phone: string | null;
  /** The password they chose on the TV, for the website account being created. */
  accountPassword: string | null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const cleanText = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || CONTROL_CHARS.test(s)) return null;
  return s.slice(0, max);
};

/** Parse the optional profile: null when absent, 'bad_email' when unusable. */
/**
 * A password is taken as typed — never trimmed, never cleaned, never logged —
 * and only within what GoTrue will accept (bcrypt stops at 72 bytes). Anything
 * outside that is dropped, and the account is simply created without one.
 */
function readAccountPassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < 8 || raw.length > 72) return null;
  if (CONTROL_CHARS.test(raw)) return null;
  return raw;
}

function readProfile(raw: unknown): Profile | null | 'bad_email' {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = cleanText(r.name, 120);
  const emailRaw = cleanText(r.email, 320);
  const phone = cleanText(r.phone, 40)?.replace(/[^\d+()\-.\s]/g, '').trim() || null;
  const accountPassword = readAccountPassword(r.account_password);
  if (emailRaw && !EMAIL_RE.test(emailRaw)) return 'bad_email';
  const email = emailRaw ? emailRaw.toLowerCase() : null;
  if (!name && !email && !phone) return null;
  return { name, email, phone, accountPassword };
}

const LABEL_BY_HOSTNAME: Record<string, string> = { 'dstreams.xyz': 'Dreamstreams', 'strmz.xyz': 'VibezTV' };

const expIsoDate = (raw: unknown): string | null => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
};

/**
 * Make or complete the hub's record of this member from what they typed:
 * the customer (name, email, phone — blanks filled, nothing overwritten) and
 * the line under them. An email that already names a customer adopts that
 * customer, exactly as the QR claim does. Returns the customer, or null when
 * nothing could be recorded.
 */
async function recordCustomer(
  admin: ReturnType<typeof createClient>,
  existing: LineCustomer | null,
  profile: Profile,
  host: string,
  username: string,
  userInfo: Record<string, unknown>,
): Promise<LineCustomer | null> {
  let customer = existing;
  if (!customer && profile.email) {
    const { data } = await admin.from('customers').select('id, email, user_id').eq('email', profile.email).maybeSingle();
    customer = (data as LineCustomer | null) ?? null;
  }
  if (!customer) {
    const { data, error } = await admin
      .from('customers')
      .insert({
        name: profile.name ?? (profile.email ? profile.email.split('@')[0] : username),
        email: profile.email,
        phone: profile.phone,
        notes: 'created from the Player sign-in',
      })
      .select('id, email, user_id')
      .single();
    if (error) throw error;
    customer = data as LineCustomer;
  } else {
    // Fill in what the hub was missing; never replace what it already has.
    const { data: row } = await admin.from('customers').select('name, email, phone').eq('id', customer.id).maybeSingle();
    const patch: Record<string, string> = {};
    if (profile.name && !(row as { name?: string | null } | null)?.name) patch.name = profile.name;
    if (profile.email && !(row as { email?: string | null } | null)?.email) patch.email = profile.email;
    if (profile.phone && !(row as { phone?: string | null } | null)?.phone) patch.phone = profile.phone;
    if (Object.keys(patch).length) {
      await admin.from('customers').update(patch).eq('id', customer.id);
      if (patch.email) customer = { ...customer, email: patch.email };
    }
  }
  // The line under the customer, in the shape the rest of the app reads.
  const { error: linkErr } = await admin.rpc('link_claimed_panel_line', {
    p_customer_id: customer.id,
    p_supabase_user_id: customer.user_id,
    p_panel_username: username,
    p_panel_host: host,
    p_server_label: LABEL_BY_HOSTNAME[hostnameOf(host)] ?? null,
    p_expiration_date: expIsoDate(userInfo.exp_date),
    p_max_connections: Number.isFinite(Number(userInfo.max_connections)) ? Number(userInfo.max_connections) : null,
    p_is_trial: userInfo.is_trial === 1 || userInfo.is_trial === '1' || userInfo.is_trial === true,
  });
  if (linkErr) console.warn('[player-login] link_claimed_panel_line failed:', linkErr.message);
  return customer;
}

// A NEW website account for the hub's email, confirmed because the hub
// vouches for it and the line just authenticated. Deliberately never attaches
// to an account that already exists for that email: a mistyped email in the
// hub must not hand a line holder someone else's account. In that case the
// member signs in with their email as before and links from the Player.
//
// When the member chose a password on the TV, the account is created with it,
// so the email and password they typed work on the website as well as on the
// billing side. Without one — the "finish your account" form asks for contact
// details only — the account is created password-less as before and they use
// "Forgot password" to set one. An existing account's password is never
// touched: this only ever runs for an account that does not exist yet.
async function createUserIfAbsent(
  admin: ReturnType<typeof createClient>,
  email: string,
  password?: string | null,
): Promise<string | null> {
  const created = await admin.auth.admin.createUser(
    password ? { email, password, email_confirm: true } : { email, email_confirm: true },
  );
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
    // Optional: the member finishing their account from the Player. Name,
    // email or phone, typed on the TV. Only used once the line has proven
    // itself against the panel below.
    const profile = readProfile(body.profile);
    if (profile === 'bad_email') return jsonResponse({ ok: false, reason: 'bad_email' });

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
    //
    //     With a profile from the Player, the hub record is made or completed
    //     first: the customer (name, email, phone) and the line under them,
    //     written through the same link_claimed_panel_line the QR claim uses.
    //     That is the provider's "I set them up with a username and password"
    //     done by the member, with the details the provider never had.
    let savedProfile = false;
    let emailInUse = false;
    if (!userId) {
      try {
        let customer = await customerForLine(admin, host, username);
        if (profile) {
          customer = await recordCustomer(admin, customer, profile, host, username, verdict.userInfo);
          savedProfile = !!customer;
        }
        if (customer?.user_id) {
          userId = customer.user_id;
        } else if (customer && customer.email) {
          const email = customer.email.trim().toLowerCase();
          const created = await createUserIfAbsent(admin, email, profile?.accountPassword ?? null);
          if (created) {
            userId = created;
            await admin.from('customers').update({ user_id: userId }).eq('id', customer.id).is('user_id', null);
          } else {
            emailInUse = true;
          }
        }
      } catch (e) {
        console.warn('[player-login] customer link failed:', e);
      }
    }
    if (!userId) {
      if (profile && savedProfile) {
        // Recorded in the hub, but no website session: either no email was
        // given (phone only), or that email already has an account of its own.
        return jsonResponse({ ok: false, reason: emailInUse ? 'email_in_use' : 'no_email', saved: true });
      }
      return jsonResponse({ ok: false, reason: 'not_linked' });
    }

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
