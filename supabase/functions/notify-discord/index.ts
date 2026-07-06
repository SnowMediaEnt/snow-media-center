// Signed-in ticket/report notification → Discord webhook.
// Routing by `kind`:
//   - 'channel_report' → DISCORD_WEBHOOK_URL       (channel-reports channel)
//   - 'ticket' (default) → DISCORD_WEBHOOK_URL_TICKETS (general tickets channel)
// If the target webhook env is not set, returns { skipped: true } without posting.
// Leaves verify_jwt at its default (true); only signed-in users can invoke it.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const raw = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!raw) {
      return new Response(
        JSON.stringify({ error: 'content required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const kind: 'channel_report' | 'ticket' =
      body?.kind === 'channel_report' ? 'channel_report' : 'ticket';

    const hook = kind === 'channel_report'
      ? Deno.env.get('DISCORD_WEBHOOK_URL')
      : Deno.env.get('DISCORD_WEBHOOK_URL_TICKETS');

    if (!hook) {
      return new Response(
        JSON.stringify({ skipped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const content = raw.slice(0, 1900);

    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok && res.status !== 204) {
      const details = await res.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: 'Discord webhook rejected', status: res.status, details: details.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
