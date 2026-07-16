// Server-side ticket notifier — invoked by an AFTER INSERT trigger on
// public.support_tickets via pg_net (mirrors the app_alerts → telegram-notify
// pattern). verify_jwt = false; guarded like telegram-notify (pg_net posts an
// anon Bearer token; direct callers get 401 from the platform if they omit it).
//
// Posts ONE Discord message and ONE Resend email per ticket insert. Both
// channels are attempted independently; failures never 500.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface Payload {
  ticket_id?: string;
  subject?: string;
  message_preview?: string;
  source?: string; // 'player_report' | 'ticket'
  user_email?: string | null;
  created_at?: string;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const jsonOk = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: true, ...extra }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  let discord_status: number | string = 'skipped';
  let resend_status: number | string = 'skipped';

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const source = body.source === 'player_report' ? 'player_report' : 'ticket';
    const subject = (body.subject || '(no subject)').slice(0, 200);
    const preview = (body.message_preview || '').slice(0, 300);
    const who = body.user_email || 'guest';
    const when = body.created_at || new Date().toISOString();
    const ticketId = body.ticket_id || '';

    // ---------- Discord ----------
    try {
      const ticketHook = Deno.env.get('DISCORD_WEBHOOK_URL_TICKETS');
      const reportHook = Deno.env.get('DISCORD_WEBHOOK_URL');
      const hook = source === 'player_report'
        ? reportHook
        : (ticketHook || reportHook); // fallback to reports channel until tickets webhook is set

      if (!hook) {
        console.log('[notify-ticket] discord status: skipped (no webhook configured)');
        discord_status = 'no_webhook';
      } else {
        const title = source === 'player_report' ? '📺 New Player Report' : '🎫 New Ticket';
        const content =
          `${title}\n**${subject}**\n` +
          `From: ${who} · ${when}\n` +
          (ticketId ? `Ticket ID: \`${ticketId}\`\n` : '') +
          '```\n' + preview.slice(0, 1500) + '\n```';

        const res = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        });
        discord_status = res.status;
        console.log(`[notify-ticket] discord status: ${res.status}`);
        if (!res.ok && res.status !== 204) {
          const details = await res.text().catch(() => '');
          console.error('[notify-ticket] discord body:', details.slice(0, 1000));
        }
      }
    } catch (e) {
      discord_status = 'threw';
      console.error('[notify-ticket] discord threw:', e instanceof Error ? e.message : String(e));
    }

    // ---------- Resend email ----------
    try {
      const apiKey = Deno.env.get('RESEND_API_KEY');
      const to = Deno.env.get('TICKET_NOTIFY_EMAIL');
      if (!apiKey) {
        console.log('[notify-ticket] resend status: skipped (RESEND_API_KEY missing)');
        resend_status = 'no_api_key';
      } else if (!to) {
        console.log('[notify-ticket] resend status: skipped (TICKET_NOTIFY_EMAIL missing)');
        resend_status = 'no_recipient';
      } else {
        const kindLabel = source === 'player_report' ? 'Player Report' : 'Ticket';
        const emailSubject = `New ${kindLabel.toLowerCase()}: ${subject}`;
        const html = `
          <h2>${esc(kindLabel)}: ${esc(subject)}</h2>
          <p><strong>From:</strong> ${esc(who)}<br/>
             <strong>When:</strong> ${esc(when)}<br/>
             ${ticketId ? `<strong>Ticket ID:</strong> <code>${esc(ticketId)}</code>` : ''}
          </p>
          <div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:6px;white-space:pre-wrap;">
            ${esc(preview)}
          </div>
          <p style="margin-top:16px;">Open the Snow Admin Hub → Support Tickets to reply.</p>
        `;

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Snow Media Tickets <onboarding@resend.dev>',
            to: [to],
            subject: emailSubject,
            html,
          }),
        });
        resend_status = res.status;
        console.log(`[notify-ticket] resend status: ${res.status}`);
        if (!res.ok) {
          const details = await res.text().catch(() => '');
          console.error('[notify-ticket] resend body:', details);
        }
      }
    } catch (e) {
      resend_status = 'threw';
      console.error('[notify-ticket] resend threw:', e instanceof Error ? e.message : String(e));
    }

    return jsonOk({ discord_status, resend_status });
  } catch (e) {
    console.error('[notify-ticket] unhandled:', e instanceof Error ? e.message : String(e));
    return jsonOk({ handled_error: true, discord_status, resend_status });
  }
});
