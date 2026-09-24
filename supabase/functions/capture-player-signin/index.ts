// Player Sign-in Capture — records EVERY Xtream sign-in (including anonymous
// leads not signed into a Snow Media account) into public.player_signins via
// a SECURITY DEFINER function.
//
// Nothing is written until the line has signed in to its panel FROM HERE.
// The capture feeds the CRM: capture_player_signin links the line to a
// customer and link_player_signin_to_crm copies its password, expiry and
// status into that customer's customer_services row (a later expiry can also
// earn a giveaway entry). It used to take all of that from the request, so
// anyone who knew a line's username (for VibezTV that is the customer's
// email) could overwrite that customer's stored password, push their expiry
// forward, or invent customers. Now a password is required, the line is
// checked against the allowlisted panel the way player-login checks it, and
// expiry, status, connections and trial come from the panel's answer, never
// from the request. A capture the panel does not accept writes nothing.
//
// verify_jwt = false (see supabase/config.toml). We NEVER 500 on normal cases;
// soft failures return HTTP 200 with { ok:false, reason }.

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

const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'strmz.xyz'] as const;

const LABEL_BY_HOST: Record<string, string> = {
  'dstreams.xyz:8080': 'Dreamstreams',
  'strmz.xyz': 'VibezTV',
};

const MAX_BODY_BYTES = 4096;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX = 30;
// Each capture now asks the panel, so a line is also limited on its own:
// this endpoint must not become a way to try passwords against a panel.
// A household's boxes reconcile a line a few times an hour at most.
const THROTTLE_MAX_PER_LINE = 8;
const REQUEST_TIMEOUT_MS = 12_000;

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const clampText = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!s) return null;
  if (CONTROL_CHARS.test(s)) return null;
  return s.slice(0, max);
};

const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

// ── panel verification (mirrors player-login; kept inline so this file can
// be pasted into the dashboard as a single unit) ───────────────────────────

// Ports a panel is commonly served over TLS on.
const TLS_PORTS = new Set(['443', '2053', '2083', '2087', '2096', '8443']);

/** Base URLs to try for a panel, best first (see player-login). */
function panelBases(rawHost: string): string[] {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/(.+)$/i.exec(trimmed);
  const bare = (m ? m[2] : trimmed).replace(/\/+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1];
  const first = m ? m[1].toLowerCase() : (port ? (TLS_PORTS.has(port) ? 'https' : 'http') : 'https');
  const second = first === 'https' ? 'http' : 'https';
  return [`${first}://${bare}`, `${second}://${bare}`];
}

// cPanel-style ports serve the panel's login page, not its player API: try
// the streaming ports on the same hostname too.
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
  if (name && (!port || PANEL_ONLY_PORTS.has(port))) {
    for (const [scheme, p] of STREAM_FALLBACKS) push(`${scheme}://${name}:${p}`);
  }
  return out;
}

/** Every attempt gets its own timeout; this caps the search as a whole. */
const TOTAL_BUDGET_MS = 20000;

// Agents a panel's gateway lets through; decided from the BODY, since a
// gateway's HTML 401 is not a wrong password (see player-login).
const PANEL_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)',
  'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
  'VLC/3.0.20 LibVLC/3.0.20',
  'okhttp/4.12.0',
];

// An expired or disabled line still answers auth 1 with its status, which
// is exactly what the capture records (a renewal shows up this way).
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
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (!text.startsWith('{')) continue;
      let data: unknown;
      try { data = JSON.parse(text); } catch { continue; }
      const ui = (data as { user_info?: Record<string, unknown> })?.user_info;
      if (!ui || typeof ui !== 'object') continue;
      const auth = ui.auth;
      const authed = auth === 1 || auth === '1' || auth === true;
      return authed ? { kind: 'ok', userInfo: ui } : { kind: 'auth_failed' };
    }
  }
  console.warn('[capture-player-signin] no JSON from any base or agent — wrong host, or a gateway block?');
  return { kind: 'unreachable' };
}

// ── line → customer ────────────────────────────────────────────────────────
// The hub stores a customer's line in customer_services as panel_host +
// panel_username. Hosts are recorded however the hub was handed them
// (scheme, port, or neither), so compare hostnames only; usernames are
// compared case-insensitively, then re-checked exactly so LIKE wildcards in
// a username ('_' is common) cannot pull in a neighbour's row. Newest row
// wins when the same line was entered twice.
const hostnameOf = (h: string | null | undefined): string =>
  String(h ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

async function customerForLine(
  admin: ReturnType<typeof createClient>,
  host: string,
  username: string,
): Promise<string | null> {
  try {
    const pattern = username.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await admin
      .from('customer_services')
      .select('customer_id, panel_host, panel_username, created_at')
      .ilike('panel_username', pattern)
      .order('created_at', { ascending: false })
      .limit(20);
    const want = hostnameOf(host);
    const rows = (data ?? []) as Array<{ customer_id: string; panel_host: string | null; panel_username: string | null }>;
    const exact = rows.filter((r) => String(r.panel_username ?? '').trim().toLowerCase() === username);
    const onHost = exact.find((r) => hostnameOf(r.panel_host) === want) ?? exact.find((r) => !hostnameOf(r.panel_host));
    return onHost?.customer_id ?? null;
  } catch (e) {
    console.warn('[capture-player-signin] line lookup failed:', e);
    return null;
  }
}

const parseExpirationDate = (raw: unknown): string | null => {
  if (raw === null || raw === undefined || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const parseIntClamp = (raw: unknown, min: number, max: number): number | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
};

const toBool = (raw: unknown): boolean | null => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const s = raw.toLowerCase();
    if (s === '1' || s === 'true') return true;
    if (s === '0' || s === 'false') return false;
  }
  return null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';
    return JSON.parse(atob(payload)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function throttle(
  admin: ReturnType<typeof createClient>,
  ipHash: string | null,
  max = THROTTLE_MAX,
): Promise<{ allowed: boolean }> {
  if (!ipHash) return { allowed: true };
  try {
    const { data } = await admin
      .from('player_signin_throttle')
      .select('window_start, count')
      .eq('ip_hash', ipHash)
      .maybeSingle();

    const now = Date.now();
    if (!data) {
      await admin.from('player_signin_throttle').insert({ ip_hash: ipHash, count: 1 });
      return { allowed: true };
    }
    const started = new Date(data.window_start as string).getTime();
    if (Number.isFinite(started) && now - started > THROTTLE_WINDOW_MS) {
      await admin
        .from('player_signin_throttle')
        .update({ window_start: new Date().toISOString(), count: 1 })
        .eq('ip_hash', ipHash);
      return { allowed: true };
    }
    const nextCount = (data.count as number) + 1;
    await admin
      .from('player_signin_throttle')
      .update({ count: nextCount })
      .eq('ip_hash', ipHash);
    return { allowed: nextCount <= max };
  } catch (e) {
    console.warn('[capture-player-signin] throttle fail-open:', e);
    return { allowed: true };
  }
}

async function resolveSupabaseUser(
  admin: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role !== 'authenticated') return null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user.id;
  } catch (e) {
    console.warn('[capture-player-signin] getUser threw:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' });
  }

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ ok: false, reason: 'body_too_large' });
    }
    let body: Record<string, unknown> = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return jsonResponse({ ok: false, reason: 'bad_json' });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // a. Throttle (fail-open).
    const ipHash = await hashClientIp(req).catch(() => null);
    const t = await throttle(admin, ipHash);
    if (!t.allowed) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }

    // b. Optional Supabase auth (fail-closed to anonymous, never 500).
    const supabaseUserId = await resolveSupabaseUser(admin, req.headers.get('Authorization'));

    // c. Host allowlist + server_label.
    const host = normalizeHost(body.host);
    if (!host || !ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
      return jsonResponse({ ok: false, reason: 'host_not_allowed' });
    }
    const serverLabel = LABEL_BY_HOST[host] ?? null;

    // d. Validate/clamp text + primitive fields. The username is stored
    //    lowercased (as always) but checked with the panel as it was typed.
    const typedUsername = clampText(typeof body.username === 'string' ? body.username.trim() : '', 256);
    const username = typedUsername ? typedUsername.toLowerCase() : null;
    if (!typedUsername || !username) {
      return jsonResponse({ ok: false, reason: 'bad_username' });
    }
    const password = clampText(body.password, 512);
    if (!password) {
      return jsonResponse({ ok: false, reason: 'not_verified' });
    }
    const deviceId = clampText(body.device_id, 256);
    const reasonRaw = typeof body.reason === 'string' ? body.reason : 'signin';
    const reason = reasonRaw === 'reconcile' ? 'reconcile' : 'signin';
    // Optional tenant tag — RPC validates it against tenants.code and rejects
    // the SMC/canvas/ask reserved codes. Anything invalid becomes null server-side.
    const tenantCodeRaw = clampText(body.tenant_code, 64);
    const tenantCode = tenantCodeRaw ? tenantCodeRaw.trim().toLowerCase() : null;

    // e. The line must sign in to its panel from here before anything is
    //    written. Limited per line first, so this cannot be used to try
    //    passwords. What the capture records about the line comes from the
    //    panel's answer; the request's exp_date/status/etc. are ignored.
    const lineAllowed = await throttle(admin, `capture-line:${host}:${username}`, THROTTLE_MAX_PER_LINE);
    if (!lineAllowed.allowed) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }
    const verdict = await verifyLine(host, typedUsername, password);
    if (verdict.kind !== 'ok') {
      return jsonResponse({ ok: false, reason: 'not_verified' });
    }
    const info = verdict.userInfo;
    const status = clampText(typeof info.status === 'string' ? info.status : null, 256);
    const maxConnections = parseIntClamp(info.max_connections, 0, 99);
    const isTrial = toBool(info.is_trial);
    const expirationDate = parseExpirationDate(info.exp_date);

    // f. matched_customer_id. A website session names the customer outright.
    //    Without one, the line itself does: the hub records every customer's
    //    line in customer_services (panel_host + panel_username), so a sign-in
    //    with that username on that panel IS that customer. This is what lets
    //    player-login sign the box into the customer's website account later,
    //    and what ties an anonymous sign-in to the person the hub created.
    let matchedCustomerId: string | null = null;
    if (supabaseUserId) {
      try {
        const { data } = await admin
          .from('customers')
          .select('id')
          .eq('user_id', supabaseUserId)
          .maybeSingle();
        matchedCustomerId = (data?.id as string) ?? null;
      } catch (e) {
        console.warn('[capture-player-signin] customer lookup failed:', e);
      }
    }
    if (!matchedCustomerId) {
      matchedCustomerId = await customerForLine(admin, host, username);
    }

    // g. Upsert via SECURITY DEFINER function.
    const { data, error } = await admin.rpc('capture_player_signin', {
      p_host: host,
      p_username: username,
      p_password: password,
      p_expiration_date: expirationDate,
      p_status: status,
      p_max_connections: maxConnections,
      p_is_trial: isTrial,
      p_device_id: deviceId,
      p_server_label: serverLabel,
      p_supabase_user_id: supabaseUserId,
      p_matched_customer_id: matchedCustomerId,
      p_reason: reason,
      p_tenant_code: tenantCode,
    });

    if (error) {
      console.error('[capture-player-signin] rpc error:', error.message);
      return jsonResponse({ ok: false, reason: 'db_error' });
    }
    const linked = Boolean((data as { linked?: boolean } | null)?.linked);
    return jsonResponse({ ok: true, linked });
  } catch (e) {
    console.error('[capture-player-signin] unexpected:', e);
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
