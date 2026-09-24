// Anonymous-safe channel report → creates a ticket in support_tickets so it
// shows up in the admin dashboard. verify_jwt=false in supabase/config.toml.
// Safety: guests can only file reports under a hardcoded sentinel user
// ("Player Reports"); they cannot spoof another user_id.
//
// Every ticket also reaches Discord, the admin inbox and the admins' phones
// (notify-ticket), so reports are limited per IP and in total per hour, and
// every subject carries a guest tag so none can pass for another kind of alert.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { clientIp, hashIp, logIpHeadersOnce, throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENTINEL_EMAIL = 'player-reports@snowmediaapps.com';
const SENTINEL_NAME = 'Player Reports';
let cachedSentinelId: string | null = null;

const PER_IP_PER_HOUR = 6;
const ALL_PER_HOUR = 100;
const HOUR_MS = 60 * 60 * 1000;
// What the app, the Canvas app and the Buffering Guide put in front already.
const GUEST_TAGS = ['[Channel Report]', '[Guest Ticket]', '[Anonymous Report]'];
const tagged = (subject: string) =>
  GUEST_TAGS.some((t) => subject.startsWith(t)) ? subject : `[Guest Report] ${subject}`;

async function resolveSentinelUserId(admin: ReturnType<typeof createClient>): Promise<string> {
  if (cachedSentinelId) return cachedSentinelId;

  // Try create; if already exists, page through users to find it.
  const created = await admin.auth.admin.createUser({
    email: SENTINEL_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { full_name: SENTINEL_NAME },
  });

  let userId: string | null = created.data?.user?.id ?? null;

  if (!userId) {
    // Fall back to lookup — paginate auth users.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const match = data.users.find((u) => (u.email || '').toLowerCase() === SENTINEL_EMAIL);
      if (match) userId = match.id;
      if (!data.users.length || data.users.length < 200) break;
    }
  }

  if (!userId) throw new Error('Failed to resolve sentinel user');

  // Ensure a profiles row exists so the admin dashboard join renders a name/email.
  await admin.from('profiles').upsert(
    { user_id: userId, email: SENTINEL_EMAIL, full_name: SENTINEL_NAME },
    { onConflict: 'user_id' },
  );

  cachedSentinelId = userId;
  return userId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      return new Response(
        JSON.stringify({ error: 'Server not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawSubject = typeof body?.subject === 'string' ? body.subject.trim() : '';
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!rawSubject || !rawMessage) {
      return new Response(
        JSON.stringify({ error: 'subject and message required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const subject = tagged(rawSubject.replace(/\s+/g, ' ')).slice(0, 200);
    const message = rawMessage.slice(0, 2000);

    const admin = createClient(url, key, { auth: { persistSession: false } });
    logIpHeadersOnce('report-channel', req.headers);
    const ipHash = await hashIp(clientIp(req.headers));
    const db = admin as unknown as ThrottleDb;
    if (!(await throttle(db, ipHash && `rc:${ipHash}`, PER_IP_PER_HOUR, HOUR_MS))
        || !(await throttle(db, 'rc:all', ALL_PER_HOUR, HOUR_MS))) {
      return new Response(
        JSON.stringify({ error: 'Too many reports right now. Please try again in an hour.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const sentinelId = await resolveSentinelUserId(admin);

    const { data: ticket, error: ticketErr } = await admin
      .from('support_tickets')
      .insert({
        user_id: sentinelId,
        subject,
        status: 'open',
        priority: 'normal',
        admin_has_unread: true,
      })
      .select('id')
      .single();
    if (ticketErr) throw ticketErr;

    const { error: msgErr } = await admin.from('support_messages').insert({
      ticket_id: ticket.id,
      user_id: sentinelId,
      sender_type: 'user',
      message,
    });
    if (msgErr) throw msgErr;

    // Discord + email notification is now sent server-side by the
    // AFTER INSERT trigger on support_tickets → notify-ticket edge function.


    return new Response(
      JSON.stringify({ success: true, ticketId: ticket.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
