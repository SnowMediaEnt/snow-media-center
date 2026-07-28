// Admin broadcast — creates one support ticket (with an admin message) for
// every user, so a mass announcement lands in each user's Ticket inbox.
// verify_jwt = false; the caller's JWT is validated in code and the caller
// must hold the 'admin' role.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Payload {
  subject?: string;
  message?: string;
  // Optional: restrict the broadcast to these user ids (defaults to everyone).
  user_ids?: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    // --- auth: must be a signed-in admin ---
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ ok: false, reason: 'missing_token' }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userErr || !caller) return json({ ok: false, reason: 'invalid_token' }, 401);

    const { data: roleRow } = await admin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)
      .eq('role', 'admin')
      .maybeSingle();
    if (!roleRow) return json({ ok: false, reason: 'not_admin' }, 403);

    // --- payload ---
    const body = (await req.json().catch(() => ({}))) as Payload;
    const subject = (body.subject || '').trim().slice(0, 200);
    const message = (body.message || '').trim().slice(0, 5000);
    if (!subject || !message) return json({ ok: false, reason: 'subject_and_message_required' }, 400);

    // --- recipients ---
    let recipients: string[] = [];
    if (Array.isArray(body.user_ids) && body.user_ids.length > 0) {
      recipients = [...new Set(body.user_ids.filter((id) => typeof id === 'string' && id.length > 0))];
    } else {
      const { data: profiles, error: profErr } = await admin
        .from('profiles')
        .select('user_id')
        .limit(10000);
      if (profErr) return json({ ok: false, reason: profErr.message }, 500);
      recipients = [...new Set((profiles || []).map((p) => p.user_id).filter(Boolean))] as string[];
    }

    if (recipients.length === 0) return json({ ok: true, sent: 0 });

    let sent = 0;
    const failed: string[] = [];
    const chunkSize = 200;

    for (let i = 0; i < recipients.length; i += chunkSize) {
      const chunk = recipients.slice(i, i + chunkSize);

      const { data: tickets, error: tErr } = await admin
        .from('support_tickets')
        .insert(
          chunk.map((uid) => ({
            user_id: uid,
            subject,
            status: 'open',
            priority: 'normal',
            user_has_unread: true,
            admin_has_unread: false,
          })),
        )
        .select('id');

      if (tErr || !tickets) {
        console.error('[broadcast-ticket] ticket insert failed:', tErr?.message);
        failed.push(...chunk);
        continue;
      }

      // sender_type 'admin' → the notify trigger stays silent and
      // update_ticket_on_message flags user_has_unread for each recipient.
      const { error: mErr } = await admin.from('support_messages').insert(
        tickets.map((t) => ({
          ticket_id: t.id,
          user_id: caller.id,
          sender_type: 'admin',
          message,
        })),
      );

      if (mErr) {
        console.error('[broadcast-ticket] message insert failed:', mErr.message);
        failed.push(...chunk);
        continue;
      }

      sent += tickets.length;
    }

    console.log(`[broadcast-ticket] sent=${sent} failed=${failed.length}`);
    return json({ ok: true, sent, failed: failed.length });
  } catch (e) {
    console.error('[broadcast-ticket] error:', e);
    return json({ ok: false, reason: (e as Error).message }, 200);
  }
});
