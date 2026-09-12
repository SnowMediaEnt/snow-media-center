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
// as player-login), require it to be active, then return PLEX_PROVIDER_TOKEN.
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

// The owner check hits plex.tv once, then remembers the verdict for a while.
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

let ownerVerdict: { at: number; owns: boolean } | null = null;

async function tokenOwnsAServer(token: string): Promise<boolean> {
  if (ownerVerdict && Date.now() - ownerVerdict.at < OWNER_CHECK_TTL_MS) return ownerVerdict.owns;
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
    if (!res.ok) {
      // 401 here means the secret itself is dead; say so loudly (no token).
      if (res.status === 401) console.error('[plex-provider-token] PLEX_PROVIDER_TOKEN rejected by plex.tv (401)');
      return false;
    }
    const list = (await res.json()) as Array<{ provides?: string; owned?: boolean }>;
    const owns = list.some((r) => String(r.provides || '').includes('server') && !!r.owned);
    ownerVerdict = { at: Date.now(), owns };
    if (owns) console.error('[plex-provider-token] PLEX_PROVIDER_TOKEN owns a server — refusing to serve it. Use a viewer account.');
    return owns;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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

    if (await tokenOwnsAServer(token)) return jsonResponse({ ok: false, reason: 'provider_misconfigured' });

    return jsonResponse({ ok: true, token });
  } catch (e) {
    console.error('[plex-provider-token] unexpected:', e);
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
