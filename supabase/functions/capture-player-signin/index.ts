// Player Sign-in Capture — records EVERY Xtream sign-in (including anonymous
// leads not signed into a Snow Media account) into public.player_signins via
// a SECURITY DEFINER function.
//
// verify_jwt = false (see supabase/config.toml). We NEVER 500 on normal cases;
// soft failures return HTTP 200 with { ok:false, reason }.

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

const ALLOWED_HOSTS = ['dstreams.xyz:8080', 'strmz.xyz'] as const;

const LABEL_BY_HOST: Record<string, string> = {
  'dstreams.xyz:8080': 'Dreamstreams',
  'strmz.xyz': 'VibezTV',
};

const MAX_BODY_BYTES = 4096;
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX = 30;

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
    return { allowed: nextCount <= THROTTLE_MAX };
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

    // d. Validate/clamp text + primitive fields.
    const rawUsername = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const username = clampText(rawUsername, 256);
    if (!username) {
      return jsonResponse({ ok: false, reason: 'bad_username' });
    }
    const password = clampText(body.password, 512);
    const status = clampText(body.status, 256);
    const deviceId = clampText(body.device_id, 256);
    const maxConnections = parseIntClamp(body.max_connections, 0, 99);
    const isTrial = toBool(body.is_trial);
    const expirationDate = parseExpirationDate(body.exp_date);
    const reasonRaw = typeof body.reason === 'string' ? body.reason : 'signin';
    const reason = reasonRaw === 'reconcile' ? 'reconcile' : 'signin';
    // Optional tenant tag — RPC validates it against tenants.code and rejects
    // the SMC/canvas/ask reserved codes. Anything invalid becomes null server-side.
    const tenantCodeRaw = clampText(body.tenant_code, 64);
    const tenantCode = tenantCodeRaw ? tenantCodeRaw.trim().toLowerCase() : null;

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
