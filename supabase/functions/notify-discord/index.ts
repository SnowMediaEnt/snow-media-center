// Signed-in ticket/report notification → Discord webhook.
// Routing by `kind`:
//   - 'channel_report' → DISCORD_WEBHOOK_URL       (channel-reports channel)
//   - 'ticket' (default) → DISCORD_WEBHOOK_URL_TICKETS (general tickets channel)
// If the target webhook env is not set, returns { skipped: true } without posting.
//
// Nothing in SMC calls this; the Canvas app does, for a signed-in Snow Media
// ticket. verify_jwt (the default) is not enough on its own: the public anon
// key passes it. So the Bearer must be a real signed-in account, each account
// gets a few posts an hour, the post names that account, and no mention in it
// can ping anyone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { throttle, type ThrottleDb } from '../_shared/requestGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const PER_USER_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'Server not configured' }, 500);
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const { data: who } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    const user = who?.user ?? null;
    if (!user) return json({ error: 'sign_in_required' }, 401);

    const body = await req.json().catch(() => ({}));
    const raw = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!raw) return json({ error: 'content required' }, 400);

    const kind: 'channel_report' | 'ticket' =
      body?.kind === 'channel_report' ? 'channel_report' : 'ticket';

    const hook = kind === 'channel_report'
      ? Deno.env.get('DISCORD_WEBHOOK_URL')
      : Deno.env.get('DISCORD_WEBHOOK_URL_TICKETS');

    if (!hook) return json({ skipped: true });

    if (!(await throttle(admin as unknown as ThrottleDb, `nd:${user.id}`, PER_USER_PER_HOUR, HOUR_MS))) {
      return json({ error: 'rate_limited' }, 429);
    }

    // Cut to fit, then close a code block the cut (or the caller) left open,
    // so the account line below always shows as itself.
    let text = raw.slice(0, 1600);
    if ((text.match(/```/g) ?? []).length % 2) text += '\n```';
    const content = `${text}\n-# Sent by account ${(user.email || user.id).slice(0, 200).replace(/[`*_~|<>\\]/g, '\\$&')}`;

    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok && res.status !== 204) {
      const details = await res.text().catch(() => '');
      return json({ error: 'Discord webhook rejected', status: res.status, details: details.slice(0, 500) }, 502);
    }

    return json({ success: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
