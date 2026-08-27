// Player Login Bridge — signs a user into their Snow Media WEBSITE account
// using their STREAMING (Xtream) credentials, completing the bidirectional
// link: ClaimAccountCard covers app-account -> line; this covers line -> app.
//
// Flow: verify the line SERVER-side against the allowlisted panel, find the
// auth user already linked to that exact line (player_signins.supabase_user_id
// or customer_services -> customers.user_id), then mint a one-time magiclink
// token_hash the client consumes with supabase.auth.verifyOtp(). We never
// return raw credentials, never create accounts here, and never link by
// guessable data — only links established by the existing claim/capture flows
// count.
//
// verify_jwt = false (see supabase/config.toml). Soft failures return
// HTTP 200 with { ok:false, reason } like capture-player-signin.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { hashClientIp } from '../_shared/ai-guard.ts';

const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'strmz.xyz'] as const;
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

const schemeFor = (host: string): 'http' | 'https' =>
  host === 'strmz.xyz' ? 'https' : 'http';

const normalizeHost = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (h === 'dstreams.xyz') h = 'dstreams.xyz:8080';
  return h;
};

async function verifyLine(host: string, username: string, password: string): Promise<
  { kind: 'ok'; userInfo: Record<string, unknown> } | { kind: 'auth_failed' } | { kind: 'unreachable' }
> {
  const url =
    `${schemeFor(host)}://${host}/player_api.php?username=` +
    encodeURIComponent(username) + `&password=` + encodeURIComponent(password);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SnowMediaHub/1.0 (+player-login)' },
    });
    if (res.status === 401 || res.status === 403) return { kind: 'auth_failed' };
    if (!res.ok) return { kind: 'unreachable' };
    let data: unknown;
    try { data = await res.json(); } catch { return { kind: 'unreachable' }; }
    const ui = (data as { user_info?: Record<string, unknown> })?.user_info;
    const auth = ui?.auth;
    const authed = auth === 1 || auth === '1' || auth === true;
    if (!authed) return { kind: 'auth_failed' };
    return { kind: 'ok', userInfo: ui ?? {} };
  } catch {
    return { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
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
