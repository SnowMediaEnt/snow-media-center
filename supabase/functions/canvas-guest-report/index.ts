// Anonymous-safe reseller-tenant guest report → creates a ticket in the
// tenant-scoped canvas_support_tickets/canvas_support_messages tables so it
// lands in the reseller panel's inbox. verify_jwt=false in supabase/config.toml.
//
// Guests cannot spoof another user_id: all guest reports are attributed to a
// shared sentinel auth user ("Guest Reports"), with a per-tenant
// canvas_customers row so tenant scoping/RLS stays intact.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SENTINEL_EMAIL = 'guest-reports@snowmediaapps.com';
const SENTINEL_NAME = 'Guest Reports';
const HOUSE_TENANTS = new Set(['snowmedia', 'canvas', 'ask']);

let cachedSentinelId: string | null = null;
let sentinelCustomerEnsured = false;

// Light in-memory IP rate limit (per instance) — 5 req / minute.
const ipHits = new Map<string, number[]>();
function ipAllowed(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const max = 5;
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    ipHits.set(ip, arr);
    return false;
  }
  arr.push(now);
  ipHits.set(ip, arr);
  return true;
}

async function resolveSentinelUserId(admin: ReturnType<typeof createClient>): Promise<string> {
  if (cachedSentinelId) return cachedSentinelId;

  const created = await admin.auth.admin.createUser({
    email: SENTINEL_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { full_name: SENTINEL_NAME },
  });

  let userId: string | null = created.data?.user?.id ?? null;

  if (!userId) {
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((u) => (u.email || '').toLowerCase() === SENTINEL_EMAIL);
      if (match) userId = match.id;
      if (!data.users.length || data.users.length < 200) break;
    }
  }

  if (!userId) throw new Error('Failed to resolve sentinel user');

  await admin.from('profiles').upsert(
    { user_id: userId, email: SENTINEL_EMAIL, full_name: SENTINEL_NAME },
    { onConflict: 'user_id' },
  );

  cachedSentinelId = userId;
  return userId;
}

// Ensure a global canvas_customers row exists whose PK id == sentinelUserId,
// so the reseller panel's id->username map renders "Guest Reports" for guest
// tickets (ticket.user_id === sentinelUserId). canvas_customers.id is the
// global PK, so only ONE such row can exist across all tenants — that's fine,
// the panel only uses this row to resolve the display name.
async function ensureSentinelCustomer(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
  sentinelUserId: string,
): Promise<void> {
  if (sentinelCustomerEnsured) return;

  const { data: existing } = await admin
    .from('canvas_customers')
    .select('id')
    .eq('id', sentinelUserId)
    .maybeSingle();

  if (existing?.id) {
    sentinelCustomerEnsured = true;
    return;
  }

  const { error } = await admin.from('canvas_customers').insert({
    id: sentinelUserId,
    tenant_id: tenantId,
    user_id: sentinelUserId,
    email: SENTINEL_EMAIL,
    username: SENTINEL_NAME,
  });

  if (error && !/duplicate|already exists|unique/i.test(error.message)) {
    console.warn('[canvas-guest-report] ensureSentinelCustomer non-fatal:', error.message);
  }
  sentinelCustomerEnsured = true;
}

function jsonOk(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonOk({ ok: false, reason: 'method_not_allowed' });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return jsonOk({ ok: false, reason: 'server_not_configured' });

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('cf-connecting-ip') ||
      'unknown';
    if (!ipAllowed(ip)) return jsonOk({ ok: false, reason: 'rate_limited' });

    const body = await req.json().catch(() => ({}));
    const tenantCode = typeof body?.tenant_code === 'string' ? body.tenant_code.trim().toLowerCase() : '';
    const kind = body?.kind === 'channel_report' ? 'channel_report' : 'ticket';
    const rawSubject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    const rawContext = typeof body?.context === 'string' ? body.context.trim() : '';

    if (!tenantCode) return jsonOk({ ok: false, reason: 'invalid_tenant' });
    if (HOUSE_TENANTS.has(tenantCode)) return jsonOk({ ok: false, reason: 'invalid_tenant' });
    if (!rawSubject || !rawMessage) return jsonOk({ ok: false, reason: 'missing_fields' });

    const subject = (kind === 'channel_report' ? '[Channel Report] ' : '[Guest] ') + rawSubject.slice(0, 200);
    let message = rawMessage.slice(0, 4000);
    if (rawContext) message += `\n\n---\nContext:\n${rawContext.slice(0, 2000)}`;

    const admin = createClient(url, key, { auth: { persistSession: false } });

    const { data: tenant, error: tErr } = await admin
      .from('tenants')
      .select('id, status')
      .eq('code', tenantCode)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!tenant || tenant.status !== 'active') return jsonOk({ ok: false, reason: 'invalid_tenant' });

    const sentinelId = await resolveSentinelUserId(admin);
    const customerUserId = sentinelId; // canvas_customers.user_id
    await resolveGuestCustomerId(admin, tenant.id, customerUserId);

    const { data: ticket, error: ticketErr } = await admin
      .from('canvas_support_tickets')
      .insert({
        tenant_id: tenant.id,
        user_id: sentinelId,
        subject,
        status: 'open',
        priority: 'normal',
      })
      .select('id')
      .single();
    if (ticketErr) throw ticketErr;

    const { error: msgErr } = await admin.from('canvas_support_messages').insert({
      tenant_id: tenant.id,
      ticket_id: ticket.id,
      user_id: sentinelId,
      sender_type: 'user',
      message,
    });
    if (msgErr) throw msgErr;

    return jsonOk({ ok: true, ticket_id: ticket.id });
  } catch (e) {
    console.error('[canvas-guest-report] error:', e);
    return jsonOk({ ok: false, reason: e instanceof Error ? e.message : String(e) });
  }
});
