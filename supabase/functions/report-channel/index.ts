// Anonymous-safe channel report → email to support.
// verify_jwt=false in supabase/config.toml — that's the point. Safety comes
// from the HARDCODED recipient (never accepts a caller-supplied `to`).
import { Resend } from 'npm:resend@4.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPPORT_RECIPIENTS = ['support@snowmediaent.com'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('RESEND_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Email service not configured. Missing RESEND_API_KEY.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const subject = typeof body?.subject === 'string' && body.subject.trim()
      ? body.subject.trim().slice(0, 200)
      : '[Channel Report]';
    const html = typeof body?.html === 'string' && body.html.trim()
      ? body.html
      : '<p>(empty report)</p>';

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: 'Snow Media Player <onboarding@resend.dev>',
      to: SUPPORT_RECIPIENTS,
      subject,
      html,
    });

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: error.message }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: data?.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
