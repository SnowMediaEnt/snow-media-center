// Fire-and-forget Telegram notifier for app_alerts lifecycle events.
// Called by Postgres AFTER INSERT/UPDATE/DELETE triggers via pg_net. verify_jwt is off.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface AlertRow {
  id?: string;
  title?: string;
  message?: string;
  severity?: string;
  source?: string;
  app_match?: string;
  active?: boolean;
}

const metaLine = (r: AlertRow): string | null => {
  const meta: string[] = [];
  if (r.source === 'player_server') {
    const target = r.app_match === 'all' ? 'All servers' : r.app_match;
    meta.push(`Server: <i>${esc(target)}</i>`);
  } else if (r.app_match && r.app_match !== 'all') {
    meta.push(`App: <i>${esc(r.app_match)}</i>`);
  }
  if (r.source) meta.push(`Source: <i>${esc(r.source)}</i>`);
  if (r.severity) meta.push(`Severity: <i>${esc(r.severity)}</i>`);
  return meta.length ? meta.join(' · ') : null;
};

const formatCreated = (r: AlertRow): string => {
  const sev = (r.severity || '').toLowerCase();
  const icon = sev === 'critical' ? '🚨' : sev === 'warning' ? '⚠️' : '🔔';
  const lines = [
    `${icon} <b>${esc(r.title || 'Alert')}</b>`,
    esc(r.message || ''),
  ];
  const meta = metaLine(r);
  if (meta) lines.push('', meta);
  return lines.join('\n');
};

const formatResolved = (r: AlertRow): string => {
  const lines = [
    `✅ <b>Resolved: ${esc(r.title || 'Alert')}</b>`,
    'This issue has been fixed.',
  ];
  const meta = metaLine(r);
  if (meta) lines.push('', meta);
  return lines.join('\n');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const okJson = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: true, ...extra }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  try {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
    if (!token || !chatId) {
      console.error('[telegram-notify] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
      return okJson({ skipped: 'missing_secrets' });
    }

    const body = await req.json().catch(() => ({}));
    const event: string = (body?.event ?? 'created') as string;
    const record: AlertRow = body?.record ?? body ?? {};
    if (!record || (!record.title && !record.message)) {
      return okJson({ skipped: 'empty_record' });
    }

    let text: string;
    if (event === 'resolved') {
      text = formatResolved(record);
    } else {
      // created (or unknown): keep legacy behavior
      if (record.active === false) return okJson({ skipped: 'inactive' });
      text = formatCreated(record);
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[telegram-notify] Telegram error', res.status, errText);
      return okJson({ telegram_error: res.status });
    }
    return okJson({ event });
  } catch (e) {
    console.error('[telegram-notify] unhandled error', e);
    return okJson({ handled_error: true });
  }
});
