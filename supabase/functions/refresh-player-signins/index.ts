// Refresh Player Sign-ins — daily cron/admin-triggered function that re-polls
// each captured Xtream line's panel to keep expiration_date / xtream_status
// current, without users needing to sign in again.
//
// verify_jwt = false at the platform level, but the function itself requires
// either an `x-cron-secret` header matching CRON_REFRESH_SECRET OR a valid
// Supabase JWT of an admin user. Anything else → 401.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const BATCH_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 10_000;
const INTER_REQUEST_DELAY_MS = 300;

const ALLOWED_HOSTS = new Set(['dstreams.xyz:8080', 'strmz.xyz']);

const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const schemeFor = (host: string): 'http' | 'https' =>
  host === 'strmz.xyz' ? 'https' : 'http';

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

const truthyAuth = (raw: unknown): boolean => {
  if (raw === 1 || raw === true) return true;
  if (typeof raw === 'string') return raw === '1' || raw.toLowerCase() === 'true';
  return false;
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

async function isAdminCaller(
  admin: ReturnType<typeof createClient>,
  authHeader: string | null,
): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  const payload = decodeJwtPayload(token);
  if (!payload || payload.role !== 'authenticated') return false;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user?.id) return false;
    const { data: roleData, error: roleErr } = await admin.rpc('has_role', {
      _user_id: data.user.id,
      _role: 'admin',
    });
    if (roleErr) {
      console.warn('[refresh-player-signins] has_role error:', roleErr.message);
      return false;
    }
    return Boolean(roleData);
  } catch (e) {
    console.warn('[refresh-player-signins] admin check threw:', e);
    return false;
  }
}

type Row = {
  id: string;
  panel_host: string;
  panel_username: string;
  panel_password: string;
};

type UpdatePatch = {
  last_refreshed_at: string;
  refresh_error: string | null;
  xtream_status?: string | null;
  expiration_date?: string | null;
  max_connections?: number | null;
  is_trial?: boolean | null;
};

async function fetchPanel(row: Row): Promise<
  | { kind: 'ok'; userInfo: Record<string, unknown> }
  | { kind: 'auth_failed' }
  | { kind: 'bad_response' }
  | { kind: 'unreachable' }
> {
  const host = row.panel_host;
  if (!ALLOWED_HOSTS.has(host)) return { kind: 'unreachable' };
  const scheme = schemeFor(host);
  const url =
    `${scheme}://${host}/player_api.php?username=` +
    encodeURIComponent(row.panel_username) +
    `&password=` +
    encodeURIComponent(row.panel_password);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SnowMediaHub/1.0 (+refresh-player-signins)' },
    });
    if (!res.ok) return { kind: 'unreachable' };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: 'bad_response' };
    }
    const info = (body as { user_info?: Record<string, unknown> } | null)?.user_info;
    if (!info || typeof info !== 'object') return { kind: 'bad_response' };
    if (!truthyAuth((info as Record<string, unknown>).auth)) return { kind: 'auth_failed' };
    return { kind: 'ok', userInfo: info as Record<string, unknown> };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? '';
    if (name === 'AbortError') return { kind: 'unreachable' };
    return { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, reason: 'method_not_allowed' }, 405);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- Auth: cron secret OR admin JWT ----
  const cronSecret = Deno.env.get('CRON_REFRESH_SECRET') ?? '';
  const providedSecret = req.headers.get('x-cron-secret') ?? '';
  const secretOk = cronSecret.length > 0 && providedSecret === cronSecret;

  let authorized = secretOk;
  if (!authorized) {
    authorized = await isAdminCaller(admin, req.headers.get('Authorization'));
  }
  if (!authorized) {
    return jsonResponse({ ok: false, reason: 'unauthorized' }, 401);
  }

  // ---- Select candidates ----
  const cutoffLastSeen = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const cutoffExpiration = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: rows, error: selErr } = await admin
    .from('player_signins')
    .select('id, panel_host, panel_username, panel_password')
    .not('panel_password', 'is', null)
    .gt('last_seen_at', cutoffLastSeen)
    .or(`expiration_date.is.null,expiration_date.gt.${cutoffExpiration}`)
    .order('last_refreshed_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);

  if (selErr) {
    console.error('[refresh-player-signins] select error:', selErr.message);
    return jsonResponse({ ok: false, reason: 'db_error' }, 200);
  }

  const candidates = (rows ?? []) as Row[];
  let refreshed = 0;
  let authFailed = 0;
  let unreachable = 0;

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    if (!row.panel_password || !ALLOWED_HOSTS.has(row.panel_host)) {
      continue;
    }

    const nowIso = new Date().toISOString();
    const result = await fetchPanel(row);
    let patch: UpdatePatch;

    if (result.kind === 'ok') {
      const info = result.userInfo;
      patch = {
        last_refreshed_at: nowIso,
        refresh_error: null,
        xtream_status:
          typeof info.status === 'string' && info.status ? info.status.slice(0, 256) : null,
        expiration_date: parseExpirationDate(info.exp_date),
        max_connections: parseIntClamp(info.max_connections, 0, 99),
        is_trial: toBool(info.is_trial),
      };
      refreshed++;
    } else if (result.kind === 'auth_failed') {
      patch = {
        last_refreshed_at: nowIso,
        refresh_error: 'auth_failed',
        xtream_status: 'Auth Failed',
      };
      authFailed++;
    } else {
      patch = {
        last_refreshed_at: nowIso,
        refresh_error: result.kind === 'bad_response' ? 'bad_response' : 'unreachable',
      };
      unreachable++;
    }

    const { error: updErr } = await admin
      .from('player_signins')
      .update(patch)
      .eq('id', row.id);
    if (updErr) {
      console.warn(
        `[refresh-player-signins] update failed for ${row.panel_host}/${row.panel_username}:`,
        updErr.message,
      );
    }

    if (i < candidates.length - 1) {
      await sleep(INTER_REQUEST_DELAY_MS);
    }
  }

  const summary = {
    ok: true,
    scanned: candidates.length,
    refreshed,
    auth_failed: authFailed,
    unreachable,
  };
  console.log('[refresh-player-signins] summary', JSON.stringify(summary));
  return jsonResponse(summary);
});
