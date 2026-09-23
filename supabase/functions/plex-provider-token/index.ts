// Plex Provider Token — hands a device the PROVIDER's Plex token once its
// Live TV line has been verified against the panel, so a member who is signed
// into DreamStreams or Vibez gets Plex without the "send the code to your
// provider" round trip.
//
// This replaces a manual process, not a security boundary: today every member
// box already holds a token for the provider's Plex account, issued by the
// provider entering each box's PIN at plex.tv/link. The only thing that
// changes is who types.
//
// Flow: verify the line SERVER-side against the allowlisted panel (same rules
// as player-login), require it to be active, and return PLEX_PROVIDER_TOKEN.
// The panel is the source of truth: a live, unexpired line on one of our
// panels gets Plex. The hub is consulted only to say NO — a customer whose
// Plex seat the hub has ended (plex_members) is refused — and is brought up
// to date afterwards: the line's customer_services row is created when the
// hub has none and its expiry refreshed when it has, so the admin sees the
// same date the panel does. That bookkeeping never blocks the token.
// The token lives in this function's env only — never in the database — and
// is never logged. Removing the secret turns the feature off: the app falls
// back to the PIN flow on its own.
//
// SET PLEX_PROVIDER_TOKEN TO A VIEWER ACCOUNT'S TOKEN, NOT THE OWNER'S. Create
// a plain Plex account, share the libraries with it, sign in as it on Plex Web
// and copy the token from a View XML address. A viewer token can browse and
// play; an owner token can change server settings and delete libraries. The
// function refuses to serve a token that owns a server it can see.
//
// verify_jwt = false (see supabase/config.toml). Soft failures return
// HTTP 200 with { ok:false, reason } like player-login.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'dstreams.xyz:2083', 'strmz.xyz'] as const;
const MAX_BODY_BYTES = 4096;
const REQUEST_TIMEOUT_MS = 12_000;
const TOTAL_BUDGET_MS = 20_000;

// A box asks once, then keeps the token, so real traffic is one call per
// device per install. These limits exist so the endpoint cannot be used to
// brute-force the panels: 20 attempts / 5 min / IP, 6 per line.
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX_PER_IP = 20;
const THROTTLE_MAX_PER_LINE = 6;

// The token check hits plex.tv once, then remembers a good verdict for a while.
const OWNER_CHECK_TTL_MS = 10 * 60 * 1000;

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// ── panel verification (mirrors player-login; kept inline so this file can
// be pasted into the dashboard as a single unit) ───────────────────────────

const TLS_PORTS = new Set(['443', '2053', '2083', '2087', '2096', '8443']);

function panelBases(rawHost: string): string[] {
  const trimmed = rawHost.trim().replace(/\/+$/, '');
  const m = /^(https?):\/\/(.+)$/i.exec(trimmed);
  const bare = (m ? m[2] : trimmed).replace(/\/+$/, '');
  const port = /:(\d+)$/.exec(bare)?.[1];
  const first = m ? m[1].toLowerCase() : (port ? (TLS_PORTS.has(port) ? 'https' : 'http') : 'https');
  const second = first === 'https' ? 'http' : 'https';
  return [`${first}://${bare}`, `${second}://${bare}`];
}

const PANEL_ONLY_PORTS = new Set(['2082', '2083', '2086', '2087']);
const STREAM_FALLBACKS: Array<[string, string]> = [
  ['http', '8080'], ['https', '2096'], ['http', '8000'], ['http', '25461'],
];

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

const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

const PANEL_AGENTS = [
  'Dalvik/2.1.0 (Linux; U; Android 9; AFTMM Build/PS7233)',
  'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7233; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
  'VLC/3.0.20 LibVLC/3.0.20',
  'okhttp/4.12.0',
];

type Verdict =
  | { kind: 'ok'; userInfo: Record<string, unknown> }
  | { kind: 'auth_failed' }
  | { kind: 'unreachable' };

async function verifyLine(host: string, username: string, secret: string): Promise<Verdict> {
  const query =
    `/player_api.php?username=` +
    encodeURIComponent(username) + `&password=` + encodeURIComponent(secret);
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
      if (!ui) continue;
      const auth = ui.auth;
      const authed = auth === 1 || auth === '1' || auth === true;
      return authed ? { kind: 'ok', userInfo: ui } : { kind: 'auth_failed' };
    }
  }
  console.warn('[plex-provider-token] no JSON from any base or agent');
  return { kind: 'unreachable' };
}

// The panel says auth:1 for expired and disabled lines too; only the status
// string and exp_date tell them apart. Same rule the app applies at sign-in.
function lineActivity(ui: Record<string, unknown>): { active: true } | { active: false; status: string } {
  const status = String(ui.status ?? '').toLowerCase();
  if (status === 'disabled' || status === 'expired' || status === 'banned') return { active: false, status };
  const exp = Number(ui.exp_date);
  if (Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now()) return { active: false, status: 'expired' };
  return { active: true };
}

// ── line → customer → Plex seat ────────────────────────────────────────────
// The hub records every customer's line in customer_services (panel_host +
// panel_username). Finding the line there names the customer whose Plex seat
// we must respect. Hosts are recorded however the hub was handed them, so
// compare hostnames only; usernames case-insensitively, then re-checked
// exactly so LIKE wildcards in a username ('_' is common) cannot pull in a
// neighbour's row. Newest row wins when the same line was entered twice.
const hostnameOf = (h: string | null | undefined): string =>
  String(h ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

async function customerForLine(
  admin: ReturnType<typeof createClient>,
  host: string,
  username: string,
): Promise<string | null> {
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
  return onHost?.customer_id ?? null;
}

// The hub's Plex Manager keeps a seat per customer in plex_members. No seat
// means nothing has been decided and the line's own status rules; a seat the
// hub has explicitly ended or expired says no. Statuses are matched loosely
// because the hub, not this function, owns that vocabulary.
const SEAT_ENDED = new Set(['disabled', 'expired', 'banned', 'revoked', 'suspended', 'cancelled', 'canceled', 'inactive', 'removed']);

async function plexSeatBlocked(admin: ReturnType<typeof createClient>, customerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('plex_members')
    .select('status, expires_at, updated_at')
    .eq('customer_id', customerId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const status = String((data as { status?: string }).status ?? '').trim().toLowerCase();
  if (SEAT_ENDED.has(status)) return true;
  const exp = (data as { expires_at?: string | null }).expires_at;
  if (exp && new Date(exp).getTime() < Date.now()) return true;
  return false;
}

// ── keep the hub current ───────────────────────────────────────────────────
// After the panel has said yes, make sure the hub knows this line and its
// expiry. A line the hub has never seen gets a customer named after the
// username (email-shaped usernames — Vibez — adopt or create the customer
// with that email, the same rule link_player_signin_to_crm applies); a known
// line has its expiry refreshed through link_claimed_panel_line, whose
// no-regress guard never moves a date backwards. Best-effort: any failure is
// logged and the token is issued anyway.
const LABEL_BY_HOSTNAME: Record<string, string> = { 'dstreams.xyz': 'Dreamstreams', 'strmz.xyz': 'VibezTV' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const expIsoDate = (raw: unknown): string | null => {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
};

async function customerFromSignins(
  admin: ReturnType<typeof createClient>,
  host: string,
  username: string,
): Promise<string | null> {
  // The hub may have matched this line to a customer by hand (player_signins)
  // without a service row yet. player_signins stores the host bare.
  const { data } = await admin
    .from('player_signins')
    .select('matched_customer_id')
    .eq('panel_host', host)
    .eq('panel_username', username)
    .not('matched_customer_id', 'is', null)
    .limit(1)
    .maybeSingle();
  return ((data as { matched_customer_id?: string | null } | null)?.matched_customer_id) ?? null;
}

async function ensureHubRecord(
  admin: ReturnType<typeof createClient>,
  host: string,
  username: string,
  userInfo: Record<string, unknown>,
  known: string | null,
): Promise<void> {
  let customerId = known ?? (await customerFromSignins(admin, host, username));
  let userId: string | null = null;
  const isEmail = EMAIL_RE.test(username);
  const byEmail = async (): Promise<void> => {
    // Hub emails are stored as typed; the username is already lowercased.
    const pattern = username.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data } = await admin.from('customers').select('id, user_id, email').ilike('email', pattern).limit(5);
    const hit = ((data ?? []) as Array<{ id: string; user_id?: string | null; email?: string | null }>)
      .find((r) => String(r.email ?? '').trim().toLowerCase() === username);
    if (hit) { customerId = hit.id; userId = hit.user_id ?? null; }
  };
  if (!customerId && isEmail) await byEmail();
  if (!customerId) {
    const { data, error } = await admin
      .from('customers')
      .insert({
        name: isEmail ? username.split('@')[0] : username,
        email: isEmail ? username : null,
        notes: 'created from the Player sign-in (Plex)',
      })
      .select('id')
      .single();
    if (error) {
      // Unique email: another request created the customer first — adopt it.
      if (isEmail && error.code === '23505') await byEmail();
      if (!customerId) throw error;
    } else {
      customerId = (data as { id: string }).id;
    }
  }
  const { error } = await admin.rpc('link_claimed_panel_line', {
    p_customer_id: customerId,
    p_supabase_user_id: userId,
    p_panel_username: username,
    p_panel_host: host,
    p_server_label: LABEL_BY_HOSTNAME[hostnameOf(host)] ?? null,
    p_expiration_date: expIsoDate(userInfo.exp_date),
    p_max_connections: Number.isFinite(Number(userInfo.max_connections)) ? Number(userInfo.max_connections) : null,
    p_is_trial: userInfo.is_trial === 1 || userInfo.is_trial === '1' || userInfo.is_trial === true,
  });
  if (error) throw error;
}

// ── throttle (shared table with player-login, distinct key prefixes) ───────

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
    console.warn('[plex-provider-token] throttle fail-open:', e);
    return true;
  }
}

// ── owner guard ────────────────────────────────────────────────────────────
// Refuse to hand out a token that OWNS a server. plex.tv answers this from
// the account, so a wrong secret is caught before a single box receives it.
// A plex.tv outage is not a verdict: the box would fail at discovery anyway,
// so we let the request through rather than lock everyone out.


// What plex.tv says about the secret: usable, an owner token (refused), dead
// (401 — the viewer's password changed and the token with it), or seeing no
// server at all (the share was removed). Anything but 'ok' must never be
// handed to a box: a box that receives a dead token shows "Can't reach your
// Plex server" and blames the server. Good verdicts are remembered for a
// while; a bad one is re-checked soon so a fixed secret takes effect quickly.
type TokenVerdict = 'ok' | 'owns' | 'dead' | 'noserver' | 'unknown';
let tokenVerdict: { at: number; verdict: TokenVerdict } | null = null;

async function checkProviderToken(token: string): Promise<TokenVerdict> {
  if (tokenVerdict) {
    const ttl = tokenVerdict.verdict === 'ok' || tokenVerdict.verdict === 'owns' ? OWNER_CHECK_TTL_MS : 60_000;
    if (Date.now() - tokenVerdict.at < ttl) return tokenVerdict.verdict;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'smc-plex-provider-token',
        'X-Plex-Product': 'Snow Media Center',
      },
    });
    if (res.status === 401) {
      console.error('[plex-provider-token] PLEX_PROVIDER_TOKEN rejected by plex.tv (401) — the viewer password changed? Sign the viewer in again and update the secret.');
      tokenVerdict = { at: Date.now(), verdict: 'dead' };
      return 'dead';
    }
    if (!res.ok) return 'unknown';
    const list = (await res.json()) as Array<{ provides?: string; owned?: boolean }>;
    const servers = list.filter((r) => String(r.provides || '').includes('server'));
    let verdict: TokenVerdict = 'ok';
    if (servers.some((r) => !!r.owned)) {
      verdict = 'owns';
      console.error('[plex-provider-token] PLEX_PROVIDER_TOKEN owns a server — refusing to serve it. Use a viewer account.');
    } else if (!servers.length) {
      verdict = 'noserver';
      console.error('[plex-provider-token] PLEX_PROVIDER_TOKEN sees no server — share the library with the viewer account again.');
    }
    tokenVerdict = { at: Date.now(), verdict };
    return verdict;
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

// The Plex accounts many boxes share, so a box can tell whether its own token
// belongs to one of them: the provider token's account, and the Hub's owner
// and link accounts (plex_settings; the Hub links each box's plex.tv/link
// code to one of those, so every such box has its own device token but the
// same account and the same viewing history). Uuid and usernames only —
// never a token. A box on none of these is on the customer's own account.
let providerAccount: { at: number; uuid: string; username: string | null } | null = null;
async function providerAccountUuid(token: string): Promise<string | null> {
  if (providerAccount && Date.now() - providerAccount.at < OWNER_CHECK_TTL_MS) return providerAccount.uuid;
  try {
    const res = await fetch('https://plex.tv/api/v2/user', {
      signal: AbortSignal.timeout(8000),
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': 'smc-plex-provider-token',
        'X-Plex-Product': 'Snow Media Center',
      },
    });
    if (!res.ok) return null;
    const u = await res.json() as { uuid?: string; username?: string };
    if (!u?.uuid) return null;
    providerAccount = { at: Date.now(), uuid: String(u.uuid), username: u.username ? String(u.username) : null };
    return providerAccount.uuid;
  } catch {
    return null;
  }
}

// ── handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ ok: false, reason: 'method_not_allowed' });

  try {
    const token = (Deno.env.get('PLEX_PROVIDER_TOKEN') ?? '').trim();
    if (!token) return jsonResponse({ ok: false, reason: 'disabled' });

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return jsonResponse({ ok: false, reason: 'body_too_large' });
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return jsonResponse({ ok: false, reason: 'bad_json' }); }

    // No line needed: account ids and usernames give nothing away.
    if (body.action === 'account') {
      const uuid = await providerAccountUuid(token);
      if (!uuid) return jsonResponse({ ok: false, reason: 'unknown' });
      const usernames = new Set<string>();
      if (providerAccount?.username) usernames.add(providerAccount.username.toLowerCase());
      try {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data } = await admin.from('plex_settings').select('account_username,link_account_username');
        for (const r of (data ?? []) as Array<{ account_username: string | null; link_account_username: string | null }>) {
          if (r.account_username) usernames.add(r.account_username.toLowerCase());
          if (r.link_account_username) usernames.add(r.link_account_username.toLowerCase());
        }
      } catch (e) {
        // Without the Hub's accounts the answer is incomplete: say so, and the
        // box treats itself as shared.
        console.warn('[plex-provider-token] plex_settings read failed:', String((e as Error)?.message || e));
        return jsonResponse({ ok: false, reason: 'unknown' });
      }
      return jsonResponse({ ok: true, uuid, usernames: [...usernames] });
    }

    const host = normalizeHost(body.host);
    if (!host || !ALLOWED_HOSTS.includes(host as (typeof ALLOWED_HOSTS)[number])) {
      return jsonResponse({ ok: false, reason: 'host_not_allowed' });
    }
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const secret = typeof body.password === 'string' ? body.password.trim() : '';
    if (!username || username.length > 256 || !secret || secret.length > 512) {
      return jsonResponse({ ok: false, reason: 'bad_credentials' });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const ipHash = await hashClientIp(req).catch(() => null);
    if (!(await throttle(admin, ipHash ? `plexip:${ipHash}` : null, THROTTLE_MAX_PER_IP))) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }
    if (!(await throttle(admin, `plexline:${host}:${username}`, THROTTLE_MAX_PER_LINE))) {
      return jsonResponse({ ok: false, reason: 'rate_limited' });
    }

    const verdict = await verifyLine(host, username, secret);
    if (verdict.kind === 'unreachable') return jsonResponse({ ok: false, reason: 'panel_unreachable' });
    if (verdict.kind === 'auth_failed') return jsonResponse({ ok: false, reason: 'auth_failed' });

    const activity = lineActivity(verdict.userInfo);
    if (!activity.active) return jsonResponse({ ok: false, reason: 'line_inactive', status: activity.status });

    // The panel said the line is real and active — that is the rule. The hub
    // only gets a veto: a customer it knows whose Plex seat it has ended.
    let customerId: string | null = null;
    try {
      customerId = await customerForLine(admin, host, username);
      if (customerId && (await plexSeatBlocked(admin, customerId))) {
        return jsonResponse({ ok: false, reason: 'plex_disabled' });
      }
    } catch (e) {
      console.error('[plex-provider-token] hub lookup failed:', e);
      return jsonResponse({ ok: false, reason: 'error' });
    }

    // The secret itself must be sound before it goes anywhere. 'unknown'
    // (plex.tv unreachable from here) is not a reason to refuse: the box will
    // find out for itself and repair on a 401.
    const tokenState = await checkProviderToken(token);
    if (tokenState === 'owns' || tokenState === 'dead' || tokenState === 'noserver') {
      return jsonResponse({ ok: false, reason: 'provider_misconfigured', detail: tokenState });
    }

    // Bookkeeping, after the decision: the hub learns the line (or its new
    // expiry). Never a reason to withhold Plex.
    try {
      await ensureHubRecord(admin, host, username, verdict.userInfo, customerId);
    } catch (e) {
      console.warn('[plex-provider-token] hub record update failed:', e instanceof Error ? e.message : String(e));
    }

    return jsonResponse({ ok: true, token });
  } catch (e) {
    console.error('[plex-provider-token] unexpected:', e);
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
