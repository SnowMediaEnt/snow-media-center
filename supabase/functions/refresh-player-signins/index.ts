// Refresh Player Sign-ins — cron/admin-triggered function that re-polls each
// captured Xtream line's panel to keep expiration_date / xtream_status current,
// without users needing to sign in again.
//
// verify_jwt = false at the platform level, but the function itself requires
// either an `x-cron-secret` header matching CRON_REFRESH_SECRET OR a valid
// Supabase JWT of an admin user. Anything else → 401.
//
// v2 additions:
// - Selection: last_seen_at within 180 days, NO expiration-age floor — a
//   long-expired line that renews on the panel must still be picked up. Up to
//   300 rows per invocation, processed in batches of 50, round-robin via
//   last_refreshed_at ascending.
// - Propagation + CRM linking: each successfully refreshed row runs through
//   public.link_player_signin_to_crm (SECURITY DEFINER) — the same single code
//   path capture-player-signin uses — which matches/creates customers, links
//   matched_customer_id, and upserts customer_services (case-insensitive
//   panel_username, panel_host scheme variants, no-regress expiration).
// - Classification + exactly-once digest: renewed / expiring / expired
//   transitions are recorded in public.expiration_notices (ON CONFLICT DO
//   NOTHING); ONLY newly-inserted rows go into a single Discord digest posted
//   to DISCORD_WEBHOOK_URL. Digest failures never 500.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const BATCH_SIZE = 50;
const MAX_ROWS_PER_RUN = 300;
// Wall-clock guard: edge functions have a hard execution limit. Stop the
// refresh pass early if we run long so the notice/digest step always executes.
const MAX_RUNTIME_MS = 100_000;
const REQUEST_TIMEOUT_MS = 10_000;
const INTER_REQUEST_DELAY_MS = 300;
const DIGEST_MAX_LINES = 25;
const DAY_MS = 86_400_000;

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
  expiration_date: string | null;
  matched_customer_id: string | null;
};

type UpdatePatch = {
  last_refreshed_at: string;
  refresh_error: string | null;
  xtream_status?: string | null;
  expiration_date?: string | null;
  max_connections?: number | null;
  is_trial?: boolean | null;
};

type NoticeKind = 'renewed' | 'expiring' | 'expired';

interface ClassifiedRow {
  kind: NoticeKind;
  panel_host: string;
  panel_username: string;
  expiration_date: string; // non-null: every classified row has a fresh date
  daysLeft: number;
  matched_customer_id: string | null;
}

// Classify a successfully refreshed row by comparing old vs new expiration.
// A row is at most one kind; 'renewed' wins.
function classifyExpiration(
  oldExp: string | null,
  newExp: string | null,
  todayUtc: string, // 'YYYY-MM-DD'
): { kind: NoticeKind; daysLeft: number } | null {
  if (!newExp) return null;
  const newMs = Date.parse(`${newExp}T00:00:00Z`);
  const todayMs = Date.parse(`${todayUtc}T00:00:00Z`);
  if (!Number.isFinite(newMs) || !Number.isFinite(todayMs)) return null;
  const daysLeft = Math.round((newMs - todayMs) / DAY_MS);

  // renewed: the new date is strictly later than the old one.
  if (oldExp && newExp > oldExp) return { kind: 'renewed', daysLeft };
  // expiring: 0–7 days left.
  if (daysLeft >= 0 && daysLeft <= 7) return { kind: 'expiring', daysLeft };
  // expired: flipped from future/today to past, or 1–3 days past.
  const oldMs = oldExp ? Date.parse(`${oldExp}T00:00:00Z`) : NaN;
  const oldDaysLeft = Number.isFinite(oldMs) ? Math.round((oldMs - todayMs) / DAY_MS) : null;
  const flippedToPast = oldDaysLeft !== null && oldDaysLeft >= 0 && daysLeft < 0;
  if (flippedToPast || (daysLeft >= -3 && daysLeft <= -1)) return { kind: 'expired', daysLeft };
  return null;
}

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
    if (res.status === 401 || res.status === 403) return { kind: 'auth_failed' };
    if (!res.ok) return { kind: 'unreachable' };
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Some panels return an HTML error page for bad creds instead of JSON.
      if (/login|auth|denied|invalid|forbidden/i.test(text)) return { kind: 'auth_failed' };
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

// CRM linking + customer_services propagation live in the SECURITY DEFINER
// public.link_player_signin_to_crm — ONE code path shared with
// capture-player-signin so the two never disagree. Called after the row's
// patch lands, since the linker reads fresh state from player_signins.
async function linkSigninToCrm(
  admin: ReturnType<typeof createClient>,
  row: Row,
): Promise<void> {
  try {
    const { error } = await admin.rpc('link_player_signin_to_crm', {
      p_signin_id: row.id,
    });
    if (error) {
      console.warn(
        `[refresh-player-signins] crm link failed for ${row.panel_host}/${row.panel_username}:`,
        error.message,
      );
    }
  } catch (e) {
    console.warn('[refresh-player-signins] crm link threw:', e);
  }
}

// Post ONE grouped Discord digest for newly-recorded notices. Fire-and-forget:
// every failure is logged, never thrown.
async function postDiscordDigest(
  admin: ReturnType<typeof createClient>,
  fresh: ClassifiedRow[],
  todayUtc: string,
): Promise<void> {
  try {
    const hook = Deno.env.get('DISCORD_WEBHOOK_URL');
    if (!hook) {
      console.log('[refresh-player-signins] DISCORD_WEBHOOK_URL not set — digest skipped');
      return;
    }

    // Enrich EXPIRING lines with customer name/email when matched_customer_id
    // resolves to a customers row.
    const customerById = new Map<string, { name: string | null; email: string | null }>();
    const ids = [...new Set(
      fresh.map((c) => c.matched_customer_id).filter((x): x is string => Boolean(x)),
    )];
    if (ids.length > 0) {
      const { data: custs, error: custErr } = await admin
        .from('customers')
        .select('id, name, email')
        .in('id', ids);
      if (custErr) {
        console.warn('[refresh-player-signins] customers lookup error:', custErr.message);
      }
      for (const c of custs ?? []) {
        const row = c as { id?: string; name?: string | null; email?: string | null };
        if (row.id) customerById.set(row.id, { name: row.name ?? null, email: row.email ?? null });
      }
    }

    const lineFor = (c: ClassifiedRow): string => {
      const who = `${c.panel_username} (${c.panel_host})`;
      if (c.kind === 'renewed') return `• ${who}: now ${c.expiration_date}`;
      if (c.kind === 'expiring') {
        const cust = c.matched_customer_id ? customerById.get(c.matched_customer_id) : undefined;
        const contactStr = cust ? [cust.name, cust.email].filter(Boolean).join(' / ') : '';
        const contact = contactStr ? ` — ${contactStr}` : '';
        return `• ${who}: ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left (${c.expiration_date})${contact}`;
      }
      return `• ${who}: expired ${c.expiration_date}`;
    };

    const groups: Array<[NoticeKind, string]> = [
      ['renewed', '🔄 **RENEWED**'],
      ['expiring', '⚠️ **EXPIRING**'],
      ['expired', '❌ **EXPIRED**'],
    ];

    const lines: string[] = [`📋 **SMC Expiration Digest** — ${todayUtc}`];
    let shown = 0;
    let remaining = 0;
    for (const [kind, header] of groups) {
      const rows = fresh.filter((c) => c.kind === kind);
      if (rows.length === 0) continue;
      const budget = Math.max(0, DIGEST_MAX_LINES - shown);
      const slice = rows.slice(0, budget);
      if (slice.length > 0) {
        lines.push('', header, ...slice.map(lineFor));
        shown += slice.length;
      }
      remaining += rows.length - slice.length;
    }
    if (remaining > 0) lines.push('', `…and ${remaining} more`);

    const content = lines.join('\n').slice(0, 1900);
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    console.log(`[refresh-player-signins] digest discord status: ${res.status} (${fresh.length} new notices)`);
    const details = await res.text().catch(() => '');
    if (!res.ok && res.status !== 204) {
      console.error('[refresh-player-signins] digest discord body:', details.slice(0, 500));
    }
  } catch (e) {
    console.error('[refresh-player-signins] digest threw:', e instanceof Error ? e.message : String(e));
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

  // ---- Select candidates: seen in the last 180 days, NO expiration-age floor
  // (a long-expired line that renews on the panel must get picked up). ----
  const cutoffLastSeen = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error: selErr } = await admin
    .from('player_signins')
    .select('id, panel_host, panel_username, panel_password, expiration_date, matched_customer_id')
    .not('panel_password', 'is', null)
    .gt('last_seen_at', cutoffLastSeen)
    .order('last_refreshed_at', { ascending: true, nullsFirst: true })
    .limit(MAX_ROWS_PER_RUN);

  if (selErr) {
    console.error('[refresh-player-signins] select error:', selErr.message);
    return jsonResponse({ ok: false, reason: 'db_error' }, 200);
  }

  const startedAt = Date.now();
  const candidates = (rows ?? []) as Row[];
  const todayUtc = new Date().toISOString().slice(0, 10);

  let refreshed = 0;
  let authFailed = 0;
  let unreachable = 0;
  const classified: ClassifiedRow[] = [];

  const batches: Row[][] = [];
  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    batches.push(candidates.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    if (Date.now() - startedAt > MAX_RUNTIME_MS) {
      console.warn('[refresh-player-signins] runtime budget reached — stopping refresh pass early');
      break;
    }
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      if (!row.panel_password || !ALLOWED_HOSTS.has(row.panel_host)) {
        continue;
      }

      const nowIso = new Date().toISOString();
      const result = await fetchPanel(row);
      let patch: UpdatePatch;

      if (result.kind === 'ok') {
        const info = result.userInfo;
        const xtreamStatus =
          typeof info.status === 'string' && info.status ? info.status.slice(0, 256) : null;
        const newExp = parseExpirationDate(info.exp_date);
        patch = {
          last_refreshed_at: nowIso,
          refresh_error: null,
          xtream_status: xtreamStatus,
          expiration_date: newExp,
          max_connections: parseIntClamp(info.max_connections, 0, 99),
          is_trial: toBool(info.is_trial),
        };
        refreshed++;

        // Classify BEFORE the patch lands — it compares old vs new state.
        const cls = classifyExpiration(row.expiration_date, newExp, todayUtc);
        if (cls && newExp) {
          classified.push({
            kind: cls.kind,
            panel_host: row.panel_host,
            panel_username: row.panel_username,
            expiration_date: newExp,
            daysLeft: cls.daysLeft,
            matched_customer_id: row.matched_customer_id ?? null,
          });
        }

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
      } else if (result.kind === 'ok') {
        // Link/merge into CRM + propagate fresh panel state to
        // customer_services. Runs AFTER the patch lands because the linker
        // reads player_signins. Single code path shared with capture.
        await linkSigninToCrm(admin, row);
      }

      if (i < batch.length - 1) {
        await sleep(INTER_REQUEST_DELAY_MS);
      }
    }
  }

  // ---- Exactly-once notice ledger + admin digest ----
  const counts: Record<NoticeKind, number> = { renewed: 0, expiring: 0, expired: 0 };
  for (const c of classified) counts[c.kind]++;

  let notified = 0;
  if (classified.length > 0) {
    try {
      const insertRows = classified.map((c) => ({
        panel_host: c.panel_host,
        panel_username: c.panel_username,
        kind: c.kind,
        expiration_date: c.expiration_date,
      }));
      // INSERT ... ON CONFLICT DO NOTHING with return=representation: PostgREST
      // returns ONLY the rows actually inserted. That is the dedupe that
      // guarantees the admin hears about a given (account, kind, date) once.
      const { data: inserted, error: insErr } = await admin
        .from('expiration_notices')
        .upsert(insertRows, {
          onConflict: 'panel_host,panel_username,kind,expiration_date',
          ignoreDuplicates: true,
        })
        .select('panel_host, panel_username, kind, expiration_date');

      if (insErr) {
        console.error('[refresh-player-signins] notice insert error:', insErr.message);
      } else {
        const keyOf = (r: {
          panel_host: string;
          panel_username: string;
          kind: string;
          expiration_date: string | null;
        }) => `${r.panel_host}::${r.panel_username}::${r.kind}::${r.expiration_date}`;
        const freshKeys = new Set((inserted ?? []).map(keyOf));
        const fresh = classified.filter((c) => freshKeys.has(keyOf(c)));
        notified = fresh.length;
        if (fresh.length > 0) {
          await postDiscordDigest(admin, fresh, todayUtc);
        }
      }
    } catch (e) {
      console.error('[refresh-player-signins] notice/digest step threw:', e);
    }
  }

  const summary = {
    ok: true,
    scanned: candidates.length,
    refreshed,
    auth_failed: authFailed,
    unreachable,
    renewed: counts.renewed,
    expiring: counts.expiring,
    expired: counts.expired,
    notified,
  };
  console.log('[refresh-player-signins] summary', JSON.stringify(summary));
  return jsonResponse(summary);
});
