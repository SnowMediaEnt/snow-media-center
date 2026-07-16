// Send Web Push notifications to registered browser/PWA subscribers.
// verify_jwt = false; guarded by INTERNAL_FN_SECRET header for server-to-server callers.
// Body: { title, body, url?, tag?, target_user_id?, internal_secret? }
// Dead endpoints (404/410) are pruned from web_push_subscriptions.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

interface Payload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  target_user_id?: string | null;
  internal_secret?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const jsonOk = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: true, ...extra }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const guard = Deno.env.get('INTERNAL_FN_SECRET');
    const provided = req.headers.get('x-internal-secret') || body.internal_secret || '';
    if (!guard || provided !== guard) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
    if (!publicKey || !privateKey) {
      console.error('[send-push] missing VAPID keys');
      return jsonOk({ skipped: 'no_vapid', sent: 0, pruned: 0 });
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let query = supabase.from('web_push_subscriptions').select('id, endpoint, p256dh, auth');
    if (body.target_user_id) query = query.eq('user_id', body.target_user_id);
    const { data: subs, error } = await query;
    if (error) {
      console.error('[send-push] load subs error:', error.message);
      return jsonOk({ sent: 0, pruned: 0, error: error.message });
    }

    const rows = subs ?? [];
    console.log(`[send-push] loaded ${rows.length} subscriptions`);
    if (rows.length === 0) return jsonOk({ sent: 0, pruned: 0 });

    const payload = JSON.stringify({
      title: body.title || 'Notification',
      body: body.body || '',
      url: body.url || '/',
      tag: body.tag || undefined,
    });

    let sent = 0;
    const deadIds: string[] = [];
    await Promise.all(rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[send-push] failed [${status}] ${row.endpoint.slice(0, 60)}: ${msg}`);
        if (status === 404 || status === 410) deadIds.push(row.id);
      }
    }));

    let pruned = 0;
    if (deadIds.length) {
      const { error: delErr, count } = await supabase
        .from('web_push_subscriptions')
        .delete({ count: 'exact' })
        .in('id', deadIds);
      if (delErr) console.error('[send-push] prune error:', delErr.message);
      else pruned = count ?? deadIds.length;
    }

    console.log(`[send-push] sent=${sent} pruned=${pruned}`);
    return jsonOk({ sent, pruned });
  } catch (e) {
    console.error('[send-push] unhandled:', e instanceof Error ? e.message : String(e));
    return jsonOk({ handled_error: true, sent: 0, pruned: 0 });
  }
});
